import type { ParsedPage } from "./tier1";

export type TruncationVerdict = { truncated: boolean; reasons: string[]; score: number };

const BOT_WALL =
  /(enable javascript|please verify you are a human|are you a robot|px-captcha|access denied|unusual traffic|cf-browser-verification|challenge-platform|distil_r_captcha)/i;

const PRICE_HINT = /(₹|\$|€|£|\bper night\b|\bnight\b|price|from\s*[₹$])/i;

/**
 * Decide whether the Tier-1 HTML is complete enough to extract from, or
 * whether we need the headless (Tier-2) renderer.
 */
export function detectTruncation(page: ParsedPage): TruncationVerdict {
  const reasons: string[] = [];
  let score = 0;

  if (page.status >= 400) {
    reasons.push(`HTTP ${page.status}`);
    score += 3;
  }
  if (page.bytes < 20_000) {
    reasons.push(`tiny document (${page.bytes} bytes)`);
    score += 2;
  }
  if (BOT_WALL.test(page.html)) {
    reasons.push("bot-wall / JS-challenge markers present");
    score += 3;
  }
  // Rich structured data (JSON-LD / embedded state) is enough to extract from,
  // even when the rendered HTML around it is sparse — so it short-circuits the
  // remaining "looks thin" heuristics.
  const structured =
    page.jsonLd.some(
      (x) =>
        !!x &&
        typeof x === "object" &&
        /Hotel|Lodging|Product|Place|Accommodation|Apartment|House|Room/i.test(
          String((x as Record<string, unknown>)["@type"] ?? ""),
        ),
    ) || page.nextData != null;

  if (!structured) {
    if (Object.keys(page.openGraph).length < 3) {
      reasons.push("no JSON-LD / __NEXT_DATA__ / rich OpenGraph");
      score += 2;
    }
    if (page.imageUrls.length < 3) {
      reasons.push(`few images found (${page.imageUrls.length})`);
      score += 2;
    }
    if (page.textExcerpt.length < 1500) {
      reasons.push(`sparse visible text (${page.textExcerpt.length} chars)`);
      score += 2;
    }
    if (!PRICE_HINT.test(page.textExcerpt)) {
      reasons.push("no price signal in visible text");
      score += 1;
    }
  }

  return { truncated: score >= 3, reasons, score };
}
