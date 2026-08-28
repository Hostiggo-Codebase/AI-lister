import * as cheerio from "cheerio";
import { env } from "./env";

export type PageHints = {
  priceCandidates: { amount: number; currency: string; context: string }[];
  personCapacity: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
  amenityNames: string[];
  lat: number | null;
  lng: number | null;
  city: string | null;
};

export type ParsedPage = {
  html: string;
  bytes: number;
  finalUrl: string;
  status: number;
  title: string | null;
  jsonLd: unknown[];
  openGraph: Record<string, string>;
  meta: Record<string, string>;
  nextData: unknown | null;
  embeddedJson: unknown[];
  imageUrls: string[];
  textExcerpt: string;
  hints: PageHints;
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function tier1Fetch(url: string): Promise<ParsedPage> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), env.fetchTimeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-IN,en;q=0.9",
      },
    });
    const html = await res.text();
    return parseHtml(html, res.url || url, res.status);
  } finally {
    clearTimeout(t);
  }
}

/** Junk that the <img> / JSON scrapers pick up but which is never a listing photo. */
const JUNK_IMAGE =
  /(platform-assets|platformassets|search-bar-icons|userprofile|user_|profile_|avatar|[/-]icons?[/-]|sprite|[/-]logo|maps\.googleapis|pinimg|fbcdn|analytics)/i;

function collectImagesFromString(s: string, sink: Set<string>) {
  const re = /https?:\\?\/\\?\/[^\s"'<>()]+?\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>()]*)?/gi;
  for (const m of s.matchAll(re)) sink.add(m[0].replace(/\\\//g, "/"));
}

function walk(node: unknown, visit: (key: string, value: unknown) => void, depth = 0) {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const v of node) walk(v, visit, depth + 1);
  } else if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      visit(k, v);
      walk(v, visit, depth + 1);
    }
  }
}

function extractHints(sources: unknown[], text: string): PageHints {
  const h: PageHints = {
    priceCandidates: [],
    personCapacity: null,
    bedrooms: null,
    beds: null,
    bathrooms: null,
    amenityNames: [],
    lat: null,
    lng: null,
    city: null,
  };
  const amenities = new Set<string>();
  const seenPrice = new Set<string>();

  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  for (const src of sources) {
    walk(src, (key, value) => {
      const k = key.toLowerCase();
      if (/personcapacity|maxguest|max_occupancy|guestcount|sleeps/.test(k)) {
        const n = num(value);
        if (n && n >= 1 && n <= 60) h.personCapacity ??= n;
      } else if (/^bedrooms?$|bedroomcount|numberofrooms/.test(k)) {
        const n = num(value);
        if (n != null && n <= 30) h.bedrooms ??= n;
      } else if (/^beds?$|bedcount/.test(k)) {
        const n = num(value);
        if (n != null && n <= 60) h.beds ??= n;
      } else if (/bathroom|bathcount/.test(k)) {
        const n = num(value);
        if (n != null && n > 0 && n <= 30) h.bathrooms ??= n;
      } else if (/latitude|^lat$/.test(k)) {
        const n = num(value);
        if (n != null && n >= -90 && n <= 90) h.lat ??= n;
      } else if (/longitude|^lng$|^lon$/.test(k)) {
        const n = num(value);
        if (n != null && n >= -180 && n <= 180) h.lng ??= n;
      } else if (/(^city$|addresslocality|cityname|localizedcity)/.test(k) && typeof value === "string") {
        if (value.length < 60) h.city ??= value;
      } else if (
        (k === "name" || k === "title") &&
        typeof value === "string" &&
        value.length < 50
      ) {
        // amenity objects on Airbnb look like { name: "Wifi", available: true }
      } else if (/amenit/i.test(k) && Array.isArray(value)) {
        for (const a of value) {
          if (typeof a === "string") amenities.add(a);
          else if (a && typeof a === "object") {
            const nm = (a as Record<string, unknown>).name ?? (a as Record<string, unknown>).title;
            if (typeof nm === "string") amenities.add(nm);
          }
        }
      } else if (
        typeof value === "string" &&
        /(₹|Rs\.?|INR|\$|USD|EUR|€|£)\s?[\d,]{2,}/i.test(value) &&
        /(price|rate|night|total|amount|display)/i.test(k)
      ) {
        const m = value.match(/(₹|Rs\.?|INR|\$|USD|EUR|€|£)\s?([\d,]{2,})/i);
        if (m) {
          const amount = Number(m[2].replace(/,/g, ""));
          const currency = /₹|rs|inr/i.test(m[1]) ? "INR" : /\$|usd/i.test(m[1]) ? "USD" : /€|eur/i.test(m[1]) ? "EUR" : "GBP";
          const sig = `${amount}-${currency}`;
          if (amount >= 100 && !seenPrice.has(sig)) {
            seenPrice.add(sig);
            h.priceCandidates.push({ amount, currency, context: key });
          }
        }
      }
    });
  }

  // Fallback: scan visible text for "₹6,500 night".
  for (const m of text.matchAll(/(₹|Rs\.?|INR)\s?([\d,]{3,})/gi)) {
    const amount = Number(m[2].replace(/,/g, ""));
    const sig = `${amount}-INR`;
    if (amount >= 300 && !seenPrice.has(sig)) {
      seenPrice.add(sig);
      h.priceCandidates.push({ amount, currency: "INR", context: "visible-text" });
    }
  }

  h.amenityNames = [...amenities].slice(0, 80);
  return h;
}

export function parseHtml(html: string, finalUrl: string, status = 200): ParsedPage {
  const $ = cheerio.load(html);

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).contents().text());
      if (Array.isArray(parsed)) jsonLd.push(...parsed);
      else jsonLd.push(parsed);
    } catch {
      /* ignore malformed blocks */
    }
  });

  // Embedded state blobs: Next.js, Airbnb/Booking deferred state, generic JSON.
  const embeddedJson: unknown[] = [];
  let nextData: unknown = null;
  $(
    'script[type="application/json"], script[id*="deferred-state"], script[id*="__NEXT_DATA__"], script[data-state], script#data-state',
  ).each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || raw.length > 4_000_000) return;
    try {
      const parsed = JSON.parse(raw);
      embeddedJson.push(parsed);
      if ($(el).attr("id") === "__NEXT_DATA__") nextData = parsed;
    } catch {
      /* ignore */
    }
  });

  const openGraph: Record<string, string> = {};
  const meta: Record<string, string> = {};
  $("meta").each((_, el) => {
    const p = $(el).attr("property");
    const n = $(el).attr("name");
    const c = $(el).attr("content");
    if (!c) return;
    if (p?.startsWith("og:")) openGraph[p.slice(3)] = c;
    if (n) meta[n] = c;
  });

  const imageUrls = new Set<string>();
  const push = (u?: string | null) => {
    if (!u || /^data:/.test(u)) return;
    try {
      const abs = new URL(u, finalUrl).toString();
      if (JUNK_IMAGE.test(abs)) return;
      if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(abs) || /image|photo|media|muscache/i.test(abs))
        imageUrls.add(abs);
    } catch {
      /* ignore */
    }
  };
  $("img").each((_, el) => {
    push($(el).attr("src"));
    push($(el).attr("data-src"));
    const ss = $(el).attr("srcset") || $(el).attr("data-srcset");
    if (ss) push(ss.split(",").pop()?.trim().split(/\s+/)[0]);
  });
  $('meta[property="og:image"]').each((_, el) => push($(el).attr("content")));
  if (openGraph.image) push(openGraph.image);
  // Photos frequently live only inside the embedded JSON / raw HTML.
  const jsonImgs = new Set<string>();
  for (const blob of embeddedJson) collectImagesFromString(JSON.stringify(blob), jsonImgs);
  collectImagesFromString(html, jsonImgs);
  for (const u of jsonImgs) push(u);

  const bodyText = $("body").clone();
  bodyText.find("script, style, noscript, svg").remove();
  const textExcerpt = bodyText.text().replace(/\s+/g, " ").trim().slice(0, 16000);

  const hints = extractHints([...jsonLd, ...embeddedJson], textExcerpt);
  if (hints.lat == null && openGraph["latitude"]) hints.lat = Number(openGraph["latitude"]);
  if (hints.lng == null && openGraph["longitude"]) hints.lng = Number(openGraph["longitude"]);

  return {
    html,
    bytes: Buffer.byteLength(html, "utf8"),
    finalUrl,
    status,
    title: $("title").first().text().trim() || openGraph.title || null,
    jsonLd,
    openGraph,
    meta,
    nextData,
    embeddedJson,
    imageUrls: [...imageUrls],
    textExcerpt,
    hints,
  };
}
