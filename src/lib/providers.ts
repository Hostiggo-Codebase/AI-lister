export type Provider =
  | "airbnb"
  | "booking"
  | "agoda"
  | "makemytrip"
  | "goibibo"
  | "unknown";

const RULES: { provider: Exclude<Provider, "unknown">; hosts: RegExp }[] = [
  { provider: "airbnb", hosts: /(^|\.)airbnb\.[a-z.]+$/i },
  { provider: "booking", hosts: /(^|\.)booking\.com$/i },
  { provider: "agoda", hosts: /(^|\.)agoda\.com$/i },
  { provider: "makemytrip", hosts: /(^|\.)makemytrip\.(com|co\.in)$/i },
  { provider: "goibibo", hosts: /(^|\.)goibibo\.com$/i },
];

export function detectProvider(rawUrl: string): Provider {
  try {
    const host = new URL(rawUrl).hostname;
    return RULES.find((r) => r.hosts.test(host))?.provider ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Only the host's own listing on a supported OTA is importable. */
export function validateImportUrl(rawUrl: string): {
  ok: boolean;
  provider: Provider;
  url?: string;
  error?: string;
} {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return { ok: false, provider: "unknown", error: "Not a valid URL" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, provider: "unknown", error: "URL must be http(s)" };
  }
  const provider = detectProvider(u.toString());
  if (provider === "unknown") {
    return {
      ok: false,
      provider,
      error:
        "Unsupported site. Supported: Airbnb, Booking.com, Agoda, MakeMyTrip, Goibibo.",
    };
  }
  // Strip tracking noise but keep the listing identifier.
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|_|source|ref|adults|children|checkin|checkout|guests)/i.test(k))
      u.searchParams.delete(k);
  }
  return { ok: true, provider, url: u.toString() };
}
