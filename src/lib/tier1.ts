import * as cheerio from "cheerio";
import { env } from "./env";

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
  imageUrls: string[];
  textExcerpt: string;
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

export function parseHtml(html: string, finalUrl: string, status = 200): ParsedPage {
  const $ = cheerio.load(html);

  const jsonLd: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) jsonLd.push(...parsed);
      else jsonLd.push(parsed);
    } catch {
      /* ignore malformed blocks */
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

  let nextData: unknown = null;
  const nd = $("#__NEXT_DATA__").contents().text();
  if (nd) {
    try {
      nextData = JSON.parse(nd);
    } catch {
      /* ignore */
    }
  }

  const imageUrls = new Set<string>();
  const push = (u?: string | null) => {
    if (!u) return;
    if (/^data:/.test(u)) return;
    try {
      const abs = new URL(u, finalUrl).toString();
      if (/\.(jpe?g|png|webp|avif)(\?|$)/i.test(abs) || /image|photo|media/i.test(abs))
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

  $("script, style, noscript, svg").remove();
  const textExcerpt = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);

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
    imageUrls: [...imageUrls],
    textExcerpt,
  };
}
