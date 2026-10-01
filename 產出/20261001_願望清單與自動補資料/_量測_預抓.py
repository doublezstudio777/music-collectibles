# 預抓（prefetch）請求數量測（2026-10-01）。Chromium iPhone 視窗 390×844，本機建置版。
# 用法：python3 _量測_預抓.py <網址根> <標籤> [session token]
# 兩種情境：
#   A. 開頁＋慢慢捲到底＋停 6 秒（8 頁各開一次）：數打到 Worker 的請求、其中 RSC 預抓幾個
#   B. 手機點擊流程：首頁 → 點第 1 張收藏卡 → 點系列連結 → 點藝人連結 → 點頁首願望清單（站內換頁，不整頁重載），
#      每一步記錄請求數與「按下到網址換好」的時間
import asyncio, json, os, sys, time
from urllib.parse import urlparse
from playwright.async_api import async_playwright

BASE, TAG = sys.argv[1].rstrip("/"), sys.argv[2]
TOKEN = sys.argv[3] if len(sys.argv) > 3 else ""
HERE = os.path.dirname(os.path.abspath(__file__))
HOST = urlparse(BASE).hostname
PAGES = [("首頁", "/"), ("藝人", "/artist/li-ying-hong"), ("系列", "/artist/li-ying-hong/1"), ("收藏頁", "/share/9"),
         ("私訊", "/messages"), ("願望清單", "/me/likes"), ("設定", "/settings"), ("全部藝人", "/artists")]
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

def worker_req(r):
    u = r.url
    if not u.startswith(BASE): return False
    p = u[len(BASE):]
    return not (p.startswith("/_next/static") or p.startswith("/assets/") or p.startswith("/brand/") or p.startswith("/img/")
                or p.endswith((".js", ".css", ".png", ".svg", ".webp", ".woff2", ".ico", ".jpg")))

def is_rsc(r):
    h = r.headers
    return "_rsc" in r.url or h.get("rsc") == "1" or ".rsc" in r.url

async def scroll_slow(pg):
    h = await pg.evaluate("document.documentElement.scrollHeight")
    y = 0
    while y < h:
        y += 500
        await pg.mouse.wheel(0, 500)
        await pg.wait_for_timeout(250)
        h = await pg.evaluate("document.documentElement.scrollHeight")

async def main():
    out = {"tag": TAG, "A": [], "B": []}
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(user_agent=UA, viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        if TOKEN:
            await ctx.add_cookies([{"name": "yz_session", "value": TOKEN, "domain": HOST, "path": "/", "httpOnly": True, "secure": BASE.startswith("https")}])
        # A
        for name, path in PAGES:
            pg = await ctx.new_page()
            reqs = []
            pg.on("request", lambda r, reqs=reqs: reqs.append(r) if worker_req(r) else None)
            await pg.goto(BASE + path, wait_until="load", timeout=60000)
            await pg.wait_for_timeout(1500)
            await scroll_slow(pg)
            await pg.wait_for_timeout(6000)
            rsc = [r for r in reqs if is_rsc(r)]
            out["A"].append({"頁": name, "請求": len(reqs), "RSC預抓": len(rsc), "預抓網址": sorted({r.url[len(BASE):].split("?")[0] for r in rsc})})
            print(f"A {name}: 請求 {len(reqs)}，RSC {len(rsc)}")
            await pg.close()
        # B
        pg = await ctx.new_page()
        reqs = []
        pg.on("request", lambda r: reqs.append(r) if worker_req(r) else None)
        await pg.goto(BASE + "/", wait_until="load", timeout=60000)
        await pg.wait_for_timeout(4000)
        steps = [("首頁→收藏卡", r"^/share/\d+$", "main"), ("收藏頁→系列", r"^/artist/[^/]+/\d+(#.*)?$", "main"),
                 ("系列→藝人", r"^/artist/[^/]+$", ".credits"), ("藝人→願望清單（頁首）", r"^/me/likes$", "header")]
        for label, pat, scope in steps:
            n0 = len(reqs)
            href = await pg.evaluate("([pat, scope]) => [...document.querySelectorAll(scope + ' a[href]')].map(a => a.getAttribute('href')).find(h => new RegExp(pat).test(h))", [pat, scope])
            el = pg.locator(f"{scope} a[href='{href}']").first
            await el.scroll_into_view_if_needed()
            await pg.wait_for_timeout(1500)  # 停一下，讓「進畫面就抓」有機會先抓
            n1 = len(reqs)
            href = await el.get_attribute("href")
            url0 = pg.url
            t = time.time()
            await el.tap()
            try:
                await pg.wait_for_url(lambda u: u != url0, timeout=20000)
                await pg.wait_for_load_state("load")
                await pg.wait_for_function("document.readyState === 'complete'")
            except Exception as e:
                print("等不到換頁", e)
            ms = round((time.time() - t) * 1000)
            await pg.wait_for_timeout(3000)
            out["B"].append({"步驟": label, "連結": href, "捲到時的預抓": n1 - n0, "點下後請求": len(reqs) - n1, "換頁毫秒": ms})
            print(f"B {label} {href}: 捲到時 {n1-n0}，點下後 {len(reqs)-n1}，{ms}ms")
        await b.close()
    out["A合計"] = {"請求": sum(x["請求"] for x in out["A"]), "RSC預抓": sum(x["RSC預抓"] for x in out["A"])}
    json.dump(out, open(os.path.join(HERE, f"量測_預抓_{TAG}.json"), "w"), ensure_ascii=False, indent=1)
    print(json.dumps(out["A合計"], ensure_ascii=False))

asyncio.run(main())
