# GA4 本機驗收：把 https://lemibox.com 的請求轉給本機建置版，讓「只在 lemibox.com 載入」的條件成立；
# 送往 Google 的統計請求（/g/collect）全部攔下來記錄後中止，不送進正式資源。另外驗本機網址（127.0.0.1）完全不載入 GA。
# 用法：python3 _驗收_GA4_本機.py <session token>
import asyncio, json, os, sys, urllib.parse
from playwright.async_api import async_playwright
LOCAL = "http://127.0.0.1:8799"; TOKEN = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__)); results = []
def check(n, ok, d=""):
    results.append((n, bool(ok), d)); print(("PASS " if ok else "FAIL ") + n + (f"：{d}" if d else ""))
def parse(req):
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(req.url).query))
    hits = [q]
    if req.post_data:
        for line in req.post_data.split("\n"):
            if line.strip(): hits.append({**q, **dict(urllib.parse.parse_qsl(line))})
        hits = hits[1:]
    return hits
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        # 1. 本機網址：不載入
        ctx = await b.new_context(); pg = await ctx.new_page(); g = []
        pg.on("request", lambda r: g.append(r.url) if "google" in r.url and ("gtag" in r.url or "collect" in r.url) else None)
        await pg.goto(LOCAL + "/", wait_until="load"); await pg.wait_for_timeout(3000)
        check("本機網址不載入 GA", not g, str(g[:2])); await ctx.close()
        # 2. 假裝是 lemibox.com
        ctx = await b.new_context(viewport={"width": 1280, "height": 900})
        await ctx.add_cookies([{"name": "yz_session", "value": TOKEN, "domain": "lemibox.com", "path": "/", "httpOnly": True, "secure": True}])
        async def proxy(route):
            u = route.request.url.replace("https://lemibox.com", LOCAL)
            h = {k: v for k, v in route.request.headers.items() if k.lower() not in ("host",)}
            h["cookie"] = f"yz_session={TOKEN}"
            if "origin" in h: h["origin"] = LOCAL
            r = await route.fetch(url=u, headers=h)
            await route.fulfill(response=r)
        await ctx.route("https://lemibox.com/**", proxy)
        hits = []
        async def ga(route):
            hits.extend(parse(route.request)); await route.fulfill(status=204, body="")
        await ctx.route("**/g/collect**", ga)
        pg = await ctx.new_page()
        await pg.goto("https://lemibox.com/search?q=cheer&token=abc123&email=a%40b.c&reset_code=999", wait_until="load"); await pg.wait_for_timeout(4000)
        await pg.goto("https://lemibox.com/u/lmbwishtest", wait_until="load"); await pg.wait_for_timeout(4000)
        await pg.goto("https://lemibox.com/artist/chen-qi-zhen/8", wait_until="load"); await pg.wait_for_timeout(4000)
        btn = await pg.locator(".compare [data-testid=wish-btn][aria-pressed=false]").first.element_handle()
        await btn.click(); await pg.wait_for_timeout(1500); await btn.click(); await pg.wait_for_timeout(1500)
        await pg.goto("https://lemibox.com/share/8", wait_until="load"); await pg.wait_for_timeout(3000)
        like = await pg.locator("button.like[aria-pressed=false]").first.element_handle(timeout=10000)
        if like:
            await like.click(); await pg.wait_for_timeout(1500); await like.click(); await pg.wait_for_timeout(3000)
        await pg.goto("https://lemibox.com/", wait_until="load"); await pg.wait_for_timeout(3000)
        await ctx.close(); await b.close()
    evs = [(h.get("en"), {k: v for k, v in h.items() if k.startswith(("ep.", "dl", "dt", "dp"))}) for h in hits]
    for e in evs: print(e)
    pv = [e for e in evs if e[0] == "page_view"]
    check("有送 page_view", len(pv) >= 4, str(len(pv)))
    login = [e for e in evs if "/search" in e[1].get("dl", "")]
    print("login:", login)
    check("網址裡的 token、email 參數拿掉、其他參數留著", login and "token" not in login[0][1]["dl"] and "email" not in login[0][1]["dl"] and "q=cheer" in login[0][1]["dl"] and "reset_code" not in login[0][1]["dl"], login[0][1].get("dl") if login else "")
    up = [e for e in pv if "/u/" in e[1].get("dl", "")]
    check("個人頁標題換成通用字", up and up[0][1].get("dt") == "會員個人頁", up[0][1].get("dt") if up else "")
    wl = [e[1].get("ep.type") for e in evs if e[0] == "wishlist_add"]
    check("wishlist_add 版本／收藏各一次", sorted(wl) == ["收藏", "版本"], str(wl))
    blob = json.dumps([h for h in hits if h.get("en") != "page_view" or True], ensure_ascii=False)
    check("所有事件的標題都沒有暱稱（含 GA 自動事件）", not any("願望測試" in (h.get("dt") or "") for h in hits))
    check("沒有送出 Email、暱稱", "example.invalid" not in blob and "願望測試" not in blob and "@" not in urllib.parse.unquote(blob))
    print(f"\n{sum(r[1] for r in results)}/{len(results)}")
    json.dump({"結果": [{"項目": n, "通過": o, "說明": d} for n, o, d in results], "送出的事件": evs}, open(os.path.join(HERE, "驗收結果_GA4_本機.json"), "w"), ensure_ascii=False, indent=1)
asyncio.run(main())
