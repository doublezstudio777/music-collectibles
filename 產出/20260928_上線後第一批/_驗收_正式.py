# 上線後第一批 正式站驗收（只讀，不登入、不寫資料）：匯入統計、抽 5 位藝人頁的維基出處、受影響頁面 1440／390 溢出與 console error、
# 精選排序介面出現（正式站還沒有收藏，只驗系列頁版本區塊的空狀態）、沒內容的藝人頁 404、轉址不存在的舊碼 404。
# 用法：python3 _驗收_正式.py <網站資料夾>（需要 CLOUDFLARE_API_TOKEN 在環境變數）
import json, subprocess, sys, requests
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE = Path(sys.argv[1]); B = "https://yinzang.dblzm.workers.dev"
IMG = Path(__file__).parent / "img"; res = []; RETRY = []
def check(n, ok, d=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + n, str(d)[:240])
def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--remote",
                        "--config", "wrangler.production.jsonc", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True, check=True)
    return json.loads(r.stdout[r.stdout.index("["):])[0]["results"]

c = sql("""SELECT (SELECT count(*) FROM artists) a, (SELECT count(*) FROM artists WHERE display='on') o, (SELECT count(*) FROM artists WHERE wiki_url IS NOT NULL) w,
  (SELECT count(*) FROM series) s, (SELECT count(*) FROM items) i, (SELECT count(*) FROM versions) v, (SELECT count(*) FROM artist_redirects) r""")[0]
print("正式站統計", c)
check("正式站：藝人 233、強制顯示 24、系列 38、品項 41、版本 47", (c["a"], c["o"], c["s"], c["i"], c["v"]) == (233, 24, 38, 41, 47), c)
vis = sql("""SELECT count(*) n FROM artists a WHERE a.display='on' OR EXISTS (SELECT 1 FROM series s WHERE s.artist_slug=a.slug)""")[0]["n"]
print("前台看得到的藝人頁（強制顯示或有系列）", vis)
def get(u):
    for _ in range(9):
        r = requests.get(u, allow_redirects=False)
        if r.status_code != 503: return r
        RETRY.append(u)
    return r
check("正式站：沒內容的一般藝人 404（elephant-gym）", get(f"{B}/artist/elephant-gym").status_code == 404)
check("正式站：不存在的舊識別碼 404", get(f"{B}/artist/no-such-artist-x").status_code == 404)

PICK = ["gordon", "mc-hotdog", "soft-lipa", "zhang-zhen-yue", "mj116"]
PAGES = [f"/artist/{s}" for s in PICK] + ["/artist/gordon/10", "/artist/mc-hotdog/2", "/artist/wan-zhi-xuan", "/artists", "/"]
with sync_playwright() as p:
    br = p.chromium.launch()
    for mobile in (False, True):
        ctx = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}, is_mobile=mobile, has_touch=mobile)
        for path in PAGES:
            pg = ctx.new_page(); errs = []
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160])); pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            # 免費方案 CPU 上限：偶發 exceededCpu 回 503（見 README「已知問題與取捨」），最多重試 8 次，重試次數另外記
            for attempt in range(9):
                errs.clear(); r = pg.goto(B + path, wait_until="load", timeout=60000); pg.wait_for_timeout(1500)
                if r.status != 503: break
                RETRY.append(path); pg.wait_for_timeout(1500)
            pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)
            w = 390 if mobile else 1440
            sw = pg.evaluate("document.documentElement.scrollWidth")
            check(f"正式 {w} {path} 200、無橫向溢出、console error 0", r.status == 200 and sw <= w and not errs, f"{r.status} scrollWidth={sw} {errs}")
            slug = path.split("/")[2] if path.startswith("/artist/") and path.count("/") == 2 else ""
            if slug in PICK and not mobile:
                cred = pg.locator("[data-testid=wiki-credit]")
                t = cred.inner_text() if cred.count() else ""
                href = cred.locator("a").first.get_attribute("href") if cred.count() else ""
                check(f"正式 維基出處 {path}", "維基百科" in t and "CC BY-SA 4.0" in t and "wikipedia.org" in (href or ""), f"{t} {href}")
            if path == "/artist/mc-hotdog/2":
                own = pg.locator("[data-testid=ver-owners]").count(); wall = pg.locator(".ver-block .empty").count()
                check(f"正式 {w} 版本標題「N 人有這個版本」與空狀態", own >= 2 and wall >= 2, f"owners={own} empty={wall}")
            name = "prod_" + (path.strip("/").replace("/", "_") or "home")
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=False)
            pg.close()
        ctx.close()
    br.close()
print(f"\n正式站驗收 {sum(res)}/{len(res)}；因 exceededCpu 503 重試 {len(RETRY)} 次：{RETRY}")
sys.exit(0 if all(res) else 1)
