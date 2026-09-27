# 上線後第一批 本機驗收：照片快取、精選排序、識別碼轉址、匯入結果、受影響頁面 1440／390 溢出與 console error。
# 2026-09-28 防盜版批次：下架與審核移到 /admin/moderation（/admin 改成儀表板），第 85、125 行跟著改
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 本機 D1 會被改到的地方都會還原（隱藏的收藏恢復、改過的識別碼改回來；轉址紀錄只增不刪，保留）。
import json, subprocess, sys, requests
from pathlib import Path
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
IMG = Path(__file__).parent / "img"; IMG.mkdir(exist_ok=True)
res = []
def check(n, ok, d=""):
    res.append((n, ok)); print(("PASS " if ok else "FAIL ") + n, str(d)[:240])

def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True, check=True)
    return json.loads(r.stdout[r.stdout.index("["):])[0]["results"]

tok = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
def admin(path, body): return requests.post(B + path, json=body, headers=H)

# ---------- 1. 照片快取 ----------
# 2026-09-28 起大圖要登入：照片請求一律帶管理員的 Bearer（H）
# 2026-09-28 上線後雜項起：photos 多了 og_key（分享預覽圖），但這裡只實際請求過主圖、縮圖兩個檔，
# purgePhotoCache 只算「真的清掉快取的那幾個」（cache.delete 找不到就不計），og 沒被請求過就不會被快取，
# purgedPhotos 期望值維持 2 不變
row = sql("SELECT p.share_no n, p.r2_key a, p.thumb_key b FROM photos p JOIN shares s ON s.no=p.share_no WHERE s.hidden_at IS NULL AND s.deleted_at IS NULL AND p.deleted_at IS NULL AND p.r2_key != p.thumb_key ORDER BY p.share_no DESC LIMIT 1")[0]
urls = [f"{B}/img/{row['a']}", f"{B}/img/{row['b']}"]
first = [requests.get(u, headers=H) for u in urls]; second = [requests.get(u, headers=H) for u in urls]
check("照片：隱藏前主圖、縮圖 200", all(r.status_code == 200 for r in first + second), [r.status_code for r in first + second])
check("照片：第二次讀取來自快取（cf-cache-status HIT）", all(r.headers.get("cf-cache-status") == "HIT" for r in second), [r.headers.get("cf-cache-status") for r in second])
h = admin("/api/admin/hide", {"type": "share", "key": str(row["n"]), "hidden": True}).json()
check("照片：隱藏 API 清掉主圖＋縮圖快取", h.get("purgedPhotos") == 2, h)
after = [requests.get(u, headers=H) for u in urls] + [requests.get(urls[0] + "?x=1", headers=H)]
check("照片：隱藏後主圖、縮圖、帶查詢字串都 404", all(r.status_code == 404 for r in after), [r.status_code for r in after])
check("照片：隱藏後單則頁 404", requests.get(f"{B}/share/{row['n']}").status_code == 404)
admin("/api/admin/hide", {"type": "share", "key": str(row["n"]), "hidden": False})
check("照片：恢復後 200", all(requests.get(u, headers=H).status_code == 200 for u in urls))
# 照片本身在資料庫標刪除
sql(f"UPDATE photos SET deleted_at = '2026-09-28T00:00:00Z' WHERE share_no = {row['n']}")
check("照片：照片列標刪除後 404", all(requests.get(u, headers=H).status_code == 404 for u in urls))
sql(f"UPDATE photos SET deleted_at = NULL WHERE share_no = {row['n']}")
check("照片：資料庫沒有這張的檔名 404", requests.get(f"{B}/img/p/bME6O68hJ9GxBmf2.webp").status_code == 404)

# ---------- 2. 精選排序（本機示範資料 mountain-radio/1 CD v1） ----------
SK, IT, V = "mountain-radio/1", "cd", "v1"
rows = sql(f"""SELECT s.no, s.ref_photo r, s.sale_state st, s.created_at c, (SELECT count(*) FROM likes l WHERE l.share_no=s.no) k
  FROM shares s WHERE series_key='{SK}' AND item_id='{IT}' AND version_id='{V}' AND hidden_at IS NULL AND deleted_at IS NULL""")
status = sql(f"SELECT v.data_status d FROM versions v JOIN items i ON i.id=v.item_ref JOIN series s ON s.id=i.series_id WHERE s.artist_slug||'/'||s.no='{SK}' AND i.item_id='{IT}' AND v.version_id='{V}'")[0]["d"]
owners = sql(f"SELECT count(*) n FROM holdings WHERE kind='owned' AND target_key='{SK}#{IT}-{V}'")[0]["n"]
conf = status == "已確認"
new = [x["no"] for x in sorted(rows, key=lambda x: x["c"], reverse=True)]
likes = [x["no"] for x in sorted(sorted(rows, key=lambda x: x["c"], reverse=True), key=lambda x: -x["k"])]
feat = [x["no"] for x in sorted(sorted(sorted(rows, key=lambda x: x["c"], reverse=True), key=lambda x: -x["k"]), key=lambda x: -(1 if conf and x["r"] else 0))]
selling = [x["no"] for x in sorted(rows, key=lambda x: x["c"], reverse=True) if x["st"] in ("sale", "offer")]
print("預期 精選", feat, "最新", new, "最多讚", likes, "在賣", selling)

ORDER_JS = """(id) => [...document.querySelectorAll('#' + CSS.escape(id) + ' [data-testid=version-wall] .card-title a')].map(a => +a.getAttribute('href').split('/').pop())"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900}); errs = []
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160])); pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.goto(f"{B}/artist/{SK}", wait_until="networkidle"); pg.wait_for_timeout(500)
    vid = f"{IT}-{V}"
    got = pg.evaluate(ORDER_JS, vid)
    check("精選：預設排序與前 6 則", got == feat[:6], got)
    more = pg.locator(f"#{vid} [data-testid=version-more]")
    check("精選：「看全部 N 則」按鈕", more.count() == 1 and more.inner_text().strip() == f"看全部 {len(rows)} 則", more.inner_text() if more.count() else "無")
    more.click(); pg.wait_for_timeout(200)
    check("精選：展開後全部", pg.evaluate(ORDER_JS, vid) == feat, pg.evaluate(ORDER_JS, vid))
    for label, want in (("最新", new), ("最多讚", likes), ("在賣的", selling)):
        pg.locator(f"#{vid} [data-testid=version-wall] button.filter", has_text=label).click(); pg.wait_for_timeout(200)
        got = pg.evaluate(ORDER_JS, vid)
        # 在賣的會排除被鎖定的收藏，所以只要求是預期的子序列
        ok = got == want or (label == "在賣的" and all(n in want for n in got) and got == [n for n in want if n in got])
        check(f"排序：{label}", ok, got)
    oc = pg.locator(f"#{vid} [data-testid=ver-owners]").inner_text()
    check("版本標題：N 人有這個版本（持有數）", oc.replace(" ", "") == f"{owners}人有這個版本", oc)
    check("系列頁 console error 0", not errs, errs)
    br.close()

# ---------- 3. 識別碼轉址 ----------
OLD, NEW = "guts", "guts-rename-test"
nseries = sql(f"SELECT count(*) n FROM series WHERE artist_slug='{OLD}'")[0]["n"]
requests.post(B + "/api/me/follows", json={"artist": OLD, "on": True}, headers=H)
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page(); pg.goto(f"{B}/admin/moderation", wait_until="networkidle")
    pg.select_option("#td-type", "artist"); pg.fill("#td-key", OLD); pg.fill("#td-slug-to", NEW)
    pg.locator("[data-testid=rename-artist]").click(); pg.wait_for_timeout(1500)
    err = pg.locator("[data-testid=admin-error]")
    check("轉址：後台「改識別碼」按鈕", err.count() == 0, err.inner_text() if err.count() else "")
    pg.screenshot(path=str(IMG / "admin_rename_1440.jpg"), type="jpeg", quality=80, full_page=False)
    br.close()
for path, want in ((f"/artist/{OLD}", f"/artist/{NEW}"), (f"/artist/{OLD}/1", f"/artist/{NEW}/1"), (f"/artist/{OLD}/1/history", f"/artist/{NEW}/1/history"), (f"/artist/{OLD}/history?x=1", f"/artist/{NEW}/history?x=1")):
    r = requests.get(B + path, allow_redirects=False)
    loc = r.headers.get("location", "")
    check(f"轉址：{path} → 301 {want}", r.status_code == 301 and loc.endswith(want), f"{r.status_code} {loc}")
check("轉址：新網址 200", requests.get(f"{B}/artist/{NEW}").status_code == 200)
check("轉址：系列跟著改", sql(f"SELECT count(*) n FROM series WHERE artist_slug='{NEW}'")[0]["n"] == nseries and nseries > 0, nseries)
me = requests.get(B + "/api/me", headers=H).json()
check("轉址：追蹤跟著改", NEW in me["state"]["follows"] and OLD not in me["state"]["follows"], me["state"]["follows"])
check("轉址：轉址紀錄", sql(f"SELECT new_slug s FROM artist_redirects WHERE old_slug='{OLD}'") == [{"s": NEW}])
# 改回原本的：轉址紀錄只留 新 → 舊
r = admin("/api/admin/rename-artist", {"from": NEW, "to": OLD})
check("轉址：改回原識別碼", r.status_code == 200, r.text)
check("轉址：改回後舊網址 200、測試網址 301 回原本", requests.get(f"{B}/artist/{OLD}").status_code == 200 and requests.get(f"{B}/artist/{NEW}", allow_redirects=False).status_code == 301)
check("轉址：改回後沒有自己轉自己", sql(f"SELECT count(*) n FROM artist_redirects WHERE old_slug='{OLD}'")[0]["n"] == 0)
requests.post(B + "/api/me/follows", json={"artist": OLD, "on": False}, headers=H)
r = admin("/api/admin/rename-artist", {"from": OLD, "to": "Bad Slug"})
check("轉址：不合規則的識別碼擋下", r.status_code == 400, r.text)
r = admin("/api/admin/rename-artist", {"from": OLD, "to": "gordon"})
check("轉址：撞到既有識別碼擋下", r.status_code == 409, r.text)

# ---------- 4. 匯入結果 ----------
c = sql("""SELECT (SELECT count(*) FROM artists WHERE source LIKE '%顏社本色%' OR source LIKE '%金曲金音%') a,
  (SELECT count(*) FROM artists WHERE display='on') o, (SELECT count(*) FROM series WHERE body LIKE '%資料來源%') s,
  (SELECT count(*) FROM items i JOIN series s ON s.id=i.series_id WHERE s.body LIKE '%資料來源%') i,
  (SELECT count(*) FROM versions v JOIN items i ON i.id=v.item_ref JOIN series s ON s.id=i.series_id WHERE s.body LIKE '%資料來源%') v""")[0]
check("匯入：藝人 233、強制顯示 24、系列 38、品項 41、版本 47", (c["a"], c["o"], c["s"], c["i"], c["v"]) == (233, 24, 38, 41, 47), c)
aw = sql("SELECT awards FROM artists WHERE slug='mc-hotdog'")[0]["awards"]
check("匯入：重疊藝人的獎項合併（mc-hotdog）", len(json.loads(aw)) > 0, aw[:120])
check("匯入：沒內容的一般藝人不顯示（elephant-gym 404）", requests.get(f"{B}/artist/elephant-gym").status_code == 404)
check("匯入：沒內容但強制顯示的顏社藝人顯示（wan-zhi-xuan 200）", requests.get(f"{B}/artist/wan-zhi-xuan").status_code == 200)

# ---------- 5. 抽 5 位藝人頁看維基出處＋受影響頁面 1440／390 ----------
PICK = ["gordon", "mc-hotdog", "soft-lipa", "zhang-zhen-yue", "mj116"]
PAGES = [f"/artist/{s}" for s in PICK] + ["/artist/mountain-radio/1", "/artist/gordon/10", "/artist/mc-hotdog/2", "/artist/wan-zhi-xuan", "/artists", "/", "/admin", "/admin/moderation"]
with sync_playwright() as p:
    br = p.chromium.launch()
    for mobile in (False, True):
        ctx = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}, is_mobile=mobile, has_touch=mobile)
        ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        for path in PAGES:
            pg = ctx.new_page(); errs = []
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160])); pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            pg.goto(B + path, wait_until="networkidle"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)
            w = 390 if mobile else 1440
            sw = pg.evaluate("document.documentElement.scrollWidth")
            check(f"{w} {path} 無橫向溢出、console error 0", sw <= w and not errs, f"scrollWidth={sw} {errs}")
            if path.startswith("/artist/") and path.count("/") == 2 and path.split("/")[2] in PICK and not mobile:
                cred = pg.locator("[data-testid=wiki-credit]")
                t = cred.inner_text() if cred.count() else ""
                href = cred.locator("a").first.get_attribute("href") if cred.count() else ""
                check(f"維基出處 {path}", "維基百科" in t and "CC BY-SA 4.0" in t and "wikipedia.org" in (href or ""), t)
            name = path.strip("/").replace("/", "_") or "home"
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=True)
            pg.close()
        ctx.close()
    br.close()

ok = sum(1 for _, o in res if o)
print(f"\n本機驗收 {ok}/{len(res)}")
sys.exit(0 if ok == len(res) else 1)
