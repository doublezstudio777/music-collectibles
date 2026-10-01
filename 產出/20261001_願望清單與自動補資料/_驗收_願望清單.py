# 願望清單統一驗收（2026-10-01）。WebKit 3x，390／320／1440。
# 用法：python3 _驗收_願望清單.py <網址根> <session token> [img 子資料夾]
#   本機：python3 _驗收_願望清單.py http://127.0.0.1:8799 wishtesttoken0001wishtesttoken0001 本機
# 前提：測試帳號已有 想要 6 筆（其中 3 筆有人在賣）＋按讚 3 則（見 README「本機驗收資料」）
import asyncio, json, re, sys, os
from urllib.parse import urlparse
from playwright.async_api import async_playwright

BASE, TOKEN = sys.argv[1].rstrip("/"), sys.argv[2]
SUB = sys.argv[3] if len(sys.argv) > 3 else "本機"
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "img", SUB)
os.makedirs(IMG, exist_ok=True)
HOST = urlparse(BASE).hostname
SERIES = "/artist/lu1/1"          # 只有一個版本（規格清單）、有人在賣
SERIES_MULTI = "/artist/chen-qi-zhen/8"  # 多個版本（比較表）
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"：{detail}" if detail else ""))

async def settle(pg):
    await pg.wait_for_load_state("load")
    try:
        await pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    await pg.evaluate("document.fonts.ready")

async def overflow(pg):
    return await pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        for w, h in [(390, 844), (320, 640), (1440, 900)]:
            ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=3 if w < 1000 else 1)
            await ctx.add_cookies([{"name": "yz_session", "value": TOKEN, "domain": HOST, "path": "/", "httpOnly": True, "secure": BASE.startswith("https")}])
            errors = []
            pg = await ctx.new_page()
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errors.append(str(e)))
            # 4xx 的網址另外記：本機還原的備份沒有 R2 照片（/img/ 404 是缺檔，不是程式問題），其他 4xx 一律算錯
            bad4xx = []
            pg.on("response", lambda r: bad4xx.append(r.url) if r.status >= 400 else None)

            # 1. 願望清單：想要的專輯／版本
            await pg.goto(BASE + "/me/likes", wait_until="load")
            await pg.wait_for_selector("[data-testid=wish-versions]", timeout=20000)
            await settle(pg)
            rows = await pg.locator(".wish-row").count()
            sale = await pg.locator("[data-testid=wish-sale]").all_inner_texts()
            first = await pg.locator(".wish-row").first.get_attribute("data-key")
            check(f"{w} 版本分頁有 6 列", rows == 6, str(rows))
            check(f"{w} 有人在賣的標「有 N 件出售中」3 筆", len(sale) == 3 and all(re.match(r"有\s*\d+\s*件出售中", t) for t in sale), str(sale))
            check(f"{w} 有人在賣的排最前面", first in ("a-tt4v/1#cd-v1", "hyukoh/1#cd-v3", "lu1/1#cd-v1"), first)
            href = await pg.locator("[data-testid=wish-sale]").first.get_attribute("href")
            check(f"{w} 出售中連到那則收藏", bool(re.match(r"^/share/\d+$", href or "")), href)
            meta = await pg.locator("[data-testid=wish-meta]").inner_text()
            check(f"{w} 頁頭寫幾個有人在賣", "3 個有人在賣" in meta.replace("\n", ""), meta)
            check(f"{w} 版本分頁無橫向溢出", await overflow(pg) <= 0, str(await overflow(pg)))
            # 列內元素不超出列（標題、版本、出售中、愛心）
            bad = await pg.evaluate("""() => [...document.querySelectorAll('.wish-row')].flatMap(r => {
                const R = r.getBoundingClientRect();
                return [...r.querySelectorAll('a,button,span')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.left < R.left - .5 || b.right > R.right + .5); }).map(e => e.textContent.slice(0, 20));
            })""")
            check(f"{w} 列內元素不超出", not bad, str(bad[:3]))
            await pg.screenshot(path=os.path.join(IMG, f"{w}_願望清單_版本.jpg"), type="jpeg", quality=80, full_page=True)

            # 2. 喜歡的收藏分頁（不換頁，網址同步）
            # 卡片的讚數另外打 /api/counts：等它回來再往下（還在飛的時候換頁，WebKit 會記成「access control checks」錯誤）
            async with pg.expect_response(lambda r: "/api/counts" in r.url, timeout=15000):
                await pg.click("[data-testid=wish-tab-shares]")
            await pg.wait_for_selector(".wall .card, .wall article, .wall a", timeout=10000)
            await settle(pg)
            cards = await pg.locator(".wall > *").count()
            check(f"{w} 喜歡的收藏 3 則", cards == 3, str(cards))
            check(f"{w} 切分頁網址變 ?tab=shares", pg.url.endswith("/me/likes?tab=shares"), pg.url)
            check(f"{w} 收藏分頁無橫向溢出", await overflow(pg) <= 0)
            await pg.screenshot(path=os.path.join(IMG, f"{w}_願望清單_收藏.jpg"), type="jpeg", quality=80, full_page=True)

            # 3. 直接開 ?tab=shares
            await pg.goto(BASE + "/me/likes?tab=shares", wait_until="load")
            await pg.wait_for_selector("[data-testid=wish-tab-shares][aria-pressed=true]", timeout=15000)
            check(f"{w} 直接開 ?tab=shares 在收藏分頁", True)
            await settle(pg)  # 讚數的 /api/counts 回來再換頁（還在飛就換頁，WebKit 記成 access control checks 錯誤）

            # 4. 系列頁：版本上的愛心＋N 人放進願望清單
            await pg.goto(BASE + SERIES, wait_until="load")
            await settle(pg)
            meta = (await pg.locator(".work-head .page-meta").inner_text()).replace("\n", "")
            check(f"{w} 系列頁頭「N 人放進願望清單」", re.search(r"\d+\s*人放進願望清單", meta) is not None and "想要" not in meta, meta)
            intro = await pg.locator("[data-testid=series-intro]").inner_text()
            check(f"{w} 自動介紹句沒有「想要」", "想要" not in intro, intro[-40:])
            btn = pg.locator("[data-testid=wish-btn]").first
            await pg.wait_for_function("document.querySelector('[data-testid=wish-btn]')?.getAttribute('aria-pressed') !== null", timeout=15000)
            txt = await btn.inner_text()
            check(f"{w} 版本按鈕是愛心＋已在願望清單（測試帳號想要這版）", "已在願望清單" in txt and await btn.locator("svg.heart").count() == 1, txt)
            ov = await overflow(pg)
            check(f"{w} 系列頁（單一版本）無橫向溢出", ov <= 0, str(ov))
            el = pg.locator(".spec").first
            await el.scroll_into_view_if_needed()
            await el.screenshot(path=os.path.join(IMG, f"{w}_系列頁_版本按鈕.jpg"), type="jpeg", quality=80)
            await pg.locator(".work-head").screenshot(path=os.path.join(IMG, f"{w}_系列頁_頁頭.jpg"), type="jpeg", quality=80)

            # 5. 多版本比較表的愛心（點一下加入、再點拿掉，清單跟著變）
            await pg.goto(BASE + SERIES_MULTI, wait_until="load")
            await settle(pg)
            await pg.wait_for_function("document.querySelector('[data-testid=wish-btn]')?.getAttribute('aria-pressed') !== null", timeout=15000)
            btns = pg.locator(".compare [data-testid=wish-btn]")
            n = await btns.count()
            check(f"{w} 比較表每個版本都有愛心", n >= 2, str(n))
            if n:
                tgt = btns.nth(n - 1)
                before = await tgt.get_attribute("aria-pressed")
                await tgt.click()
                await pg.wait_for_timeout(1500)
                after = await tgt.get_attribute("aria-pressed")
                check(f"{w} 點愛心切換", before != after, f"{before}→{after}")
                cmp = pg.locator(".compare-scroll-wrap").first
                await cmp.scroll_into_view_if_needed()
                await cmp.screenshot(path=os.path.join(IMG, f"{w}_系列頁_比較表愛心.jpg"), type="jpeg", quality=80)
                await tgt.click()
                await pg.wait_for_timeout(1500)
                check(f"{w} 再點一次復原", await tgt.get_attribute("aria-pressed") == before)
            check(f"{w} 系列頁（比較表）無橫向溢出", await overflow(pg) <= 0, str(await overflow(pg)))

            # 6. 個人頁：「願望清單」區塊
            await pg.goto(BASE + "/u/" + os.environ.get("HANDLE", "lmbwishtest"), wait_until="load")
            await settle(pg)
            title = (await pg.locator("#wanted .block-title").inner_text()).replace("\n", " ")
            check(f"{w} 個人頁區塊叫願望清單", title.startswith("願望清單"), title)

            real = [e for e in errors if "Failed to load resource" not in e] + [u for u in bad4xx if "/img/" not in u]
            check(f"{w} console error 0", not real, str(real[:3]))
            await ctx.close()

        # 7. 訪客按愛心：登入面板寫「登入後才能加入願望清單」
        ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3)
        pg = await ctx.new_page()
        await pg.goto(BASE + SERIES, wait_until="load")
        await settle(pg)
        await pg.wait_for_function("document.querySelector('[data-testid=wish-btn]')?.getAttribute('aria-pressed') !== null", timeout=15000)
        t = await pg.locator("[data-testid=wish-btn]").first.inner_text()
        check("訪客看到「加入願望清單」", "加入願望清單" in t, t)
        await pg.locator("[data-testid=wish-btn]").first.click()
        await pg.wait_for_timeout(800)
        body = await pg.locator("body").inner_text()
        check("訪客點愛心跳登入面板（登入後才能加入願望清單）", "登入後才能加入願望清單" in body)
        await pg.screenshot(path=os.path.join(IMG, "390_訪客_登入面板.jpg"), type="jpeg", quality=80)
        await ctx.close()
        await b.close()
    ok = sum(1 for r in results if r[1])
    print(f"\n{ok}/{len(results)}")
    json.dump([{"項目": n, "通過": o, "說明": d} for n, o, d in results], open(os.path.join(HERE, f"驗收結果_願望清單_{SUB}.json"), "w"), ensure_ascii=False, indent=1)

asyncio.run(main())
