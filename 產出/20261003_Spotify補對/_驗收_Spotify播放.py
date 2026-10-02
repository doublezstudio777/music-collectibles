# iPhone WebKit（390、3x、觸控）下藝人頁 Spotify 嵌入播放器能不能播：等 iframe 載入，點播放鍵，看按鈕變成暫停、進度有在走
import asyncio, os, sys
from playwright.async_api import async_playwright
BASE = sys.argv[1].rstrip("/"); SLUG = sys.argv[2] if len(sys.argv) > 2 else "gordon"
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img", "正式站_改後")
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=UA)
        pg = await ctx.new_page()
        await pg.goto(f"{BASE}/artist/{SLUG}", wait_until="load")
        sp = pg.locator("iframe.artist-sp"); await sp.scroll_into_view_if_needed(); await pg.wait_for_timeout(6000)
        fr = next((f for f in pg.frames if "open.spotify.com/embed/artist" in f.url), None)
        print("iframe:", fr.url if fr else None)
        btn = fr.locator("button[data-testid='play-pause-button'], button[aria-label*='Play'], button[aria-label*='播放']").first
        print("播放鍵：", await btn.count(), await btn.get_attribute("aria-label") if await btn.count() else "")
        rows = await fr.locator("[data-testid='tracklist-row'], li[role='row'], div[role='row']").count()
        print("曲目列：", rows)
        await pg.locator(".artist-sp").screenshot(path=os.path.join(IMG, f"390_Spotify_{SLUG}_播放前.jpg"), type="jpeg", quality=80)
        await btn.tap(); await pg.wait_for_timeout(5000)
        print("點了之後：", await btn.get_attribute("aria-label"))
        await pg.locator(".artist-sp").screenshot(path=os.path.join(IMG, f"390_Spotify_{SLUG}_播放後.jpg"), type="jpeg", quality=80)
        await b.close()
asyncio.run(main())
