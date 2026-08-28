from __future__ import annotations

import contextlib
from dataclasses import dataclass

from app.config import settings
from app.pipeline.tier1 import UA, ParsedPage, parse_html


@dataclass
class Tier2Result:
    ok: bool
    page: ParsedPage | None = None
    reason: str | None = None


_SCROLL_JS = """
async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 700) {
    window.scrollTo(0, y);
    await new Promise(r => setTimeout(r, 200));
  }
  window.scrollTo(0, 0);
  const clickable = [...document.querySelectorAll('button,a,[role=button]')];
  for (const re of [/^show more$|read more|show full description/i,
                    /show all \\d+ amenities|all amenities/i]) {
    const btn = clickable.find(b => re.test((b.textContent || '').trim()));
    if (btn) { btn.click(); await new Promise(r => setTimeout(r, 500)); }
  }
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 400));
}
"""


async def tier2_scrape(url: str) -> Tier2Result:
    if not settings.import_tier2_enabled:
        return Tier2Result(ok=False, reason="Tier 2 disabled by config")
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return Tier2Result(
            ok=False,
            reason="playwright not installed (pip install playwright && playwright install chromium)",
        )

    timeout_ms = max(45_000, settings.import_fetch_timeout_s * 3000)
    try:
        async with async_playwright() as pw:
            browser = await pw.chromium.launch(headless=True)
            try:
                ctx = await browser.new_context(
                    user_agent=UA, locale="en-IN", viewport={"width": 1366, "height": 900}
                )
                page = await ctx.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
                await page.wait_for_timeout(1500)
                await page.evaluate(_SCROLL_JS)
                with contextlib.suppress(Exception):
                    await page.wait_for_function(
                        "/(?:₹|Rs\\.?|\\$|€|£)\\s?\\d[\\d,]{2,}/.test(document.body.innerText)",
                        timeout=6000,
                    )
                await page.wait_for_timeout(500)
                html = await page.content()
                final_url = page.url
                return Tier2Result(ok=True, page=parse_html(html, final_url, 200))
            finally:
                await browser.close()
    except Exception as e:  # noqa: BLE001
        return Tier2Result(ok=False, reason=f"tier2 error: {e}")
