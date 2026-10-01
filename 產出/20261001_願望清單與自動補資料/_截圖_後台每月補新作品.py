# 後台「待確認的新增」上方的每月補新作品區塊截圖。用法：python3 _截圖_後台每月補新作品.py <網址根> <管理員 token> <img 子資料夾>
import asyncio, os, sys
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE, TOKEN, SUB = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img", SUB); os.makedirs(IMG, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900})
        await ctx.add_cookies([{"name": "yz_session", "value": TOKEN, "domain": urlparse(BASE).hostname, "path": "/", "httpOnly": True, "secure": BASE.startswith("https")}])
        pg = await ctx.new_page()
        await pg.goto(BASE + "/admin/additions", wait_until="load")
        await pg.wait_for_selector("[data-testid=release-scan]", timeout=30000)
        for d in await pg.locator("[data-testid=release-scan] details").all(): await d.evaluate("e => e.open = true")
        await pg.locator("[data-testid=release-scan]").screenshot(path=os.path.join(IMG, "1440_後台_每月補新作品.jpg"), type="jpeg", quality=80)
        item = pg.locator("[data-testid=add-item]").first
        await item.screenshot(path=os.path.join(IMG, "1440_後台_待確認第一筆.jpg"), type="jpeg", quality=80)
        print(await item.inner_text())
        await b.close()
asyncio.run(main())
