# CPU 修正本機驗收：整頁快取命中、登入不擋快取、隱藏立刻失效、讚數換算（總數含自己）。
# 用法：python3 _驗收_快取.py http://127.0.0.1:8791 <網站資料夾>
# 會改本機資料（隱藏一則再恢復、按讚再取消），結束時還原。
import json, subprocess, sys, requests
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), sys.argv[2]
res = []
def check(n, ok, d=""):
    res.append(ok); print(("PASS " if ok else "FAIL ") + n, d)
def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--persist-to", ".wrangler/state", "--config", "wrangler.local.jsonc", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    return json.loads(r.stdout)[-1]["results"]
tok = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
C = {"yz_session": tok}
get = lambda p, **k: requests.get(B + p, allow_redirects=False, **k)

# ---------- 1. 命中與登入 ----------
for p in ["/", "/artists", "/artist/mc-hotdog", "/artist/mc-hotdog/1", "/login"]:
    get(p); a = get(p); b = get(p, cookies=C)
    check(f"快取命中 {p}（訪客、登入者都 HIT）", a.headers.get("x-yz-cache") == "HIT" and b.headers.get("x-yz-cache") == "HIT", f"{a.headers.get('x-yz-cache')}/{b.headers.get('x-yz-cache')}")
    check(f"登入者拿到跟訪客同一份 {p}", a.text == b.text)
check("原本的 Cache-Control 照樣送出（瀏覽器不快取頁面）", get("/").headers.get("cache-control") == "no-store, must-revalidate", get("/").headers.get("cache-control"))
check("不快取的路徑 /me、/share/new 沒有快取標記", "x-yz-cache" not in get("/me", cookies=C).headers and "x-yz-cache" not in get("/share/new").headers)

# ---------- 2. 隱藏立刻失效 ----------
n = sql("SELECT no FROM shares WHERE hidden_at IS NULL AND deleted_at IS NULL ORDER BY no DESC LIMIT 1")[0]["no"]
get(f"/share/{n}"); get("/")
check(f"隱藏前 /share/{n} 已在快取", get(f"/share/{n}").headers.get("x-yz-cache") == "HIT")
onhome = lambda: f'\\"n\\":{n},' in get("/").text  # 首頁收藏牆是 RSC 資料，不是 href
check(f"隱藏前首頁有第 {n} 則", onhome())
v0 = sql("SELECT v FROM content_version")[0]["v"]
requests.post(B + "/api/admin/hide", json={"type": "share", "key": str(n), "hidden": True}, headers=H)
v1 = sql("SELECT v FROM content_version")[0]["v"]
check("隱藏後版本號增加（觸發器）", v1 > v0, f"{v0}→{v1}")
r = get(f"/share/{n}")
check(f"隱藏後 /share/{n} 立刻 404、不是舊副本", r.status_code == 404 and r.headers.get("x-yz-cache") == "MISS", f"{r.status_code} {r.headers.get('x-yz-cache')}")
check(f"隱藏後首頁沒有第 {n} 則", not onhome())
requests.post(B + "/api/admin/hide", json={"type": "share", "key": str(n), "hidden": False}, headers=H)
check(f"恢復後 /share/{n} 200", get(f"/share/{n}").status_code == 200)
# 直接改資料庫（不經程式）也要失效
get("/artist/mc-hotdog"); tl = sql("SELECT tagline FROM artists WHERE slug='mc-hotdog'")[0]["tagline"]
sql("UPDATE artists SET tagline = tagline || '（快取測試）' WHERE slug='mc-hotdog'")
check("手動 SQL 改藝人 → 藝人頁立刻換新", "（快取測試）" in get("/artist/mc-hotdog").text)
sql(f"UPDATE artists SET tagline = '{tl}' WHERE slug='mc-hotdog'")
check("改回後藝人頁恢復", "（快取測試）" not in get("/artist/mc-hotdog").text)

# ---------- 3. 讚數：伺服器給總數，前端換算 ----------
m = sql(f"SELECT count(*) c FROM likes WHERE share_no={n}")[0]["c"]
mine0 = sql(f"SELECT count(*) c FROM likes WHERE share_no={n} AND user_id=(SELECT id FROM users WHERE handle='yzadmin')")[0]["c"]
def shown(ctx):
    pg = ctx.new_page(); errs = []
    pg.on("console", lambda x: x.type == "error" and errs.append(x.text))
    pg.goto(f"{B}/share/{n}", wait_until="networkidle")
    btn = pg.locator("button.like").first
    if ctx is not anon: pg.wait_for_function("document.querySelector('button.like')?.hasAttribute('aria-pressed')")
    return pg, btn, errs
with sync_playwright() as p:
    br = p.chromium.launch()
    anon = br.new_context()
    user = br.new_context(); user.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pa, ba, ea = shown(anon)
    check(f"訪客看到總讚數 {m}", ba.locator(".num").inner_text() == str(m), ba.locator(".num").inner_text())
    pu, bu, eu = shown(user)
    check(f"登入者（{'已' if mine0 else '沒'}按讚）看到同一個總數 {m}", bu.locator(".num").inner_text() == str(m), bu.locator(".num").inner_text())
    bu.click(); pu.wait_for_timeout(1200)
    exp = m - 1 if mine0 else m + 1
    check(f"登入者按一下 → {exp}，馬上變", bu.locator(".num").inner_text() == str(exp), bu.locator(".num").inner_text())
    pu.reload(wait_until="networkidle"); pu.wait_for_function("document.querySelector('button.like')?.hasAttribute('aria-pressed')")
    check(f"重新整理後仍是 {exp}（沒有重複加）", pu.locator("button.like .num").first.inner_text() == str(exp), pu.locator("button.like .num").first.inner_text())
    pa.reload(wait_until="networkidle")
    check(f"訪客重新整理看到 {exp}", pa.locator("button.like .num").first.inner_text() == str(exp))
    pu.locator("button.like").first.click(); pu.wait_for_timeout(1200)
    check(f"再按一下回到 {m}", pu.locator("button.like .num").first.inner_text() == str(m))
    check("console error 0", not ea and not eu, str(ea + eu))
    br.close()
check("讚數資料還原", sql(f"SELECT count(*) c FROM likes WHERE share_no={n}")[0]["c"] == m)
print(f"\n快取驗收 {sum(res)}/{len(res)}")
