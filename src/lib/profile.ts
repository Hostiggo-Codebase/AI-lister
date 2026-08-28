import { tier1Fetch } from "./tier1";
import { tier2Scrape } from "./tier2";
import { detectProvider, type Provider } from "./providers";

export type DiscoveredListing = {
  url: string;
  external_id: string;
  title: string | null;
  thumbnail: string | null;
};

export type ProfileScan = {
  provider: Provider;
  is_profile_url: boolean;
  host_name: string | null;
  listings: DiscoveredListing[];
  tier_used: 1 | 2;
  note: string | null;
};

const LISTING_PATH: Partial<Record<Provider, RegExp>> = {
  airbnb: /\/rooms\/(?:plus\/)?(\d{4,})/g,
  booking: /\/hotel\/[a-z]{2}\/([a-z0-9-]+)\.[a-z-]+\.html/gi,
  agoda: /\/([a-z0-9-]+)\/hotel\/[a-z0-9-]+\.html/gi,
  makemytrip: /hotels\/([a-z0-9_-]+)-details/gi,
  goibibo: /\/hotels\/([a-z0-9-]+-hotel-in-[a-z0-9-]+)\//gi,
};

const PROFILE_HINT =
  /\/users\/show\/|\/users\/\d+|\/host\/|\/hostprofile|profile\.[a-z]+|\/wishlists?\/|\/s\/|search|\/property-owner\//i;

export function isProfileUrl(url: string): boolean {
  return PROFILE_HINT.test(url);
}

/** Discover every listing URL on a host-profile / search / wishlist page. */
export async function scanProfile(rawUrl: string): Promise<ProfileScan> {
  const provider = detectProvider(rawUrl);
  const base: ProfileScan = {
    provider,
    is_profile_url: isProfileUrl(rawUrl),
    host_name: null,
    listings: [],
    tier_used: 1,
    note: null,
  };
  if (provider === "unknown") return { ...base, note: "Unsupported site." };

  let page = await tier1Fetch(rawUrl);
  let tier: 1 | 2 = 1;
  const listingRe = LISTING_PATH[provider];

  const harvest = (html: string): DiscoveredListing[] => {
    if (!listingRe) return [];
    const seen = new Map<string, DiscoveredListing>();
    const origin = (() => {
      try {
        return new URL(rawUrl).origin;
      } catch {
        return "";
      }
    })();
    for (const m of html.matchAll(listingRe)) {
      const external_id = m[1];
      if (!external_id || seen.has(external_id)) continue;
      let path = m[0];
      // airbnb regex captures only the numeric tail via the /rooms/ prefix
      if (provider === "airbnb") path = `/rooms/${external_id}`;
      seen.set(external_id, {
        url: origin + (path.startsWith("/") ? path : `/${path}`),
        external_id,
        title: null,
        thumbnail: null,
      });
    }
    return [...seen.values()];
  };

  let listings = harvest(page.html);

  // Profile pages are JS-heavy — if Tier 1 found nothing, render it.
  if (listings.length === 0) {
    const t2 = await tier2Scrape(rawUrl);
    if (t2.ok) {
      page = t2.page;
      tier = 2;
      listings = harvest(page.html);
    } else {
      base.note = `Tier 2 needed but unavailable: ${t2.reason}`;
    }
  }

  // Attach titles/thumbnails from embedded JSON where possible.
  const blob = JSON.stringify(page.embeddedJson);
  for (const l of listings) {
    const near = blob.indexOf(l.external_id);
    if (near > -1) {
      const window = blob.slice(near, near + 1200);
      l.title =
        window.match(/"(?:name|title|localizedName)"\s*:\s*"([^"]{4,120})"/)?.[1] ?? null;
      l.thumbnail =
        window.match(/"(https?:\/\/[^"]+?\.(?:jpe?g|png|webp)[^"]*)"/)?.[1]?.replace(/\\\//g, "/") ??
        null;
    }
  }

  const hostName =
    page.html.match(/(?:Hosted by|Listings by|)\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)'s (?:listings|home)/)?.[1] ??
    page.openGraph.title ??
    null;

  return {
    ...base,
    host_name: hostName,
    listings: listings.slice(0, 40),
    tier_used: tier,
    note: base.note ?? (listings.length ? null : "No listings found on this page."),
  };
}
