import { parseHtml, type ParsedPage } from "./tier1";
import { env } from "./env";

type PlaywrightPage = {
  goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>;
  evaluate(fn: () => unknown): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  url(): string;
};
type PlaywrightBrowser = {
  newContext(opts: Record<string, unknown>): Promise<{
    newPage(): Promise<PlaywrightPage>;
  }>;
  close(): Promise<void>;
};

export type Tier2Result =
  | { ok: true; page: ParsedPage }
  | { ok: false; reason: string };

/**
 * Headless-browser fallback. Playwright is an optional dependency: if it
 * (or its browser binaries) isn't installed, we degrade gracefully and the
 * pipeline keeps the Tier-1 page.
 */
export async function tier2Scrape(url: string): Promise<Tier2Result> {
  if (!env.tier2Enabled) return { ok: false, reason: "Tier 2 disabled by config" };

  // Optional dependency — resolved at runtime so the build never requires it.
  let chromium: {
    launch(opts: { headless: boolean }): Promise<PlaywrightBrowser>;
  };
  try {
    const spec = "playwright";
    ({ chromium } = (await import(/* webpackIgnore: true */ spec)) as {
      chromium: typeof chromium;
    });
  } catch {
    return {
      ok: false,
      reason:
        "playwright not installed (run: npm i -D playwright && npx playwright install chromium)",
    };
  }

  let browser: PlaywrightBrowser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-IN",
      viewport: { width: 1366, height: 900 },
    });
    const pw = await ctx.newPage();
    await pw.goto(url, { waitUntil: "networkidle", timeout: env.fetchTimeoutMs * 2 });
    // Trigger lazy-loaded galleries.
    await pw.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 150));
      }
      window.scrollTo(0, 0);
    });
    await pw.waitForTimeout(800);
    const html = await pw.content();
    const finalUrl = pw.url();
    return { ok: true, page: parseHtml(html, finalUrl, 200) };
  } catch (e) {
    return { ok: false, reason: `tier2 error: ${(e as Error).message}` };
  } finally {
    await browser?.close().catch(() => {});
  }
}
