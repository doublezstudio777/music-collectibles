# 其他系列、資料貢獻者、頁尾聲明與贊助、單則頁留言：本機驗收。
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾> [sponsor]
#   不帶 sponsor：伺服器是「沒設 SPONSOR_URL」的建置，全部項目都跑，並檢查全站沒有「贊助」
#   帶 sponsor：伺服器是「SPONSOR_URL=https://example.com/yz-sponsor」的建置，只跑頁尾贊助那段
# 本機資料不清空：每次重跑自己建新的示範資料（新系列、新留言），用完把暫時改動（停權、未驗證、隱藏）改回來。
import json, re, subprocess, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
MODE = sys.argv[3] if len(sys.argv) > 3 else ""
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
res = []
STAMP = str(int(time.time()))[-6:]


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:300]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:240])


def sql(cmd):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
        cwd=SITE, capture_output=True, text=True, check=True,
    )
    out = json.loads(r.stdout[r.stdout.index("["):])
    return out[-1]["results"]


def cv():
    return sql("SELECT v FROM content_version WHERE id = 1")[0]["v"]


def login(email):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"]}


def H(u, cc="TW"):
    return {"Authorization": f"Bearer {u['tok']}", "x-yz-test-country": cc}


PAGES = ["/", "/artists", "/artist/tide-highway", "/artist/tide-highway/2", "/share/95", "/login", "/search?q=海", "/tag/%E5%B1%B1%E7%B7%9A%E9%9B%BB%E5%8F%B0", "/u/rin"]

# ================= 頁尾贊助（有設 SPONSOR_URL 的建置） =================
if MODE == "sponsor":
    for p in PAGES:
        h = requests.get(B + p).text
        m = re.search(r'<a[^>]*data-testid="sponsor"[^>]*>', h)
        check(f"S1 {p} 頁尾出現贊助連結", "贊助" in h and m and 'href="https://example.com/yz-sponsor"' in m.group(0), m.group(0) if m else "沒找到")
    share = requests.get(B + "/share/95").text
    main = share.split("<main", 1)[1].split("</main>", 1)[0] if "<main" in share else share
    check("S2 單則頁主要內容（main）沒有贊助、咖啡、奶茶按鈕", not re.search("贊助|咖啡|奶茶", main))
    (OUT / "驗收紀錄_贊助.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{sum(r['ok'] for r in res)}/{len(res)}")
    sys.exit(0 if all(r["ok"] for r in res) else 1)

admin = login("admin@demo.yinzang.test")
AH = {"Authorization": f"Bearer {admin['tok']}"}

# ================= 1. 頁尾（沒設 SPONSOR_URL） =================
for p in PAGES:
    h = requests.get(B + p).text
    check(f"1a {p} 找不到「贊助」", "贊助" not in h, "有" if "贊助" in h else "")
    check(f"1b {p} 有版權聲明", "照片著作權屬於上傳者；專輯封面、藝人名稱等屬於原權利人。" in h)
share95 = requests.get(B + "/share/95").text
check("1c 單則頁沒有咖啡、奶茶字樣", not re.search("咖啡|奶茶", share95))

# ================= 2. 這位藝人的其他系列 =================
def other_series(path):
    h = requests.get(B + path).text
    out = {}
    for sec in re.findall(r'<section[^>]*data-testid="other-series"[^>]*data-artist="([^"]+)"[^>]*>(.*?)</section>', h, re.S):
        slug, body = sec
        titles = re.findall(r'class="tile-title">([^<]+)<', body)
        covers = len(re.findall(r'class="cover cover-photo"', body))
        out[slug] = {"titles": titles, "covers": covers}
    return out, h


o, h = other_series("/artist/tide-highway/2")
check("2a 共同署名系列（海線對話）每位藝人各一區", set(o) == {"tide-highway", "mountain-radio"}, list(o))
years = {k: [int(t[:4]) if t[:4].isdigit() else 9999 for t in v["titles"]] for k, v in o.items()}
check("2b 各區依發行年由舊到新", all(y == sorted(y) for y in years.values()), years)
check("2c 不列出目前這個系列", all("海線對話" not in t for v in o.values() for t in v["titles"]), o)
check("2d 附封面（有收藏照片的系列用照片，其餘色塊）", sum(v["covers"] for v in o.values()) >= 1, {k: v["covers"] for k, v in o.items()})
mr = o.get("mountain-radio", {"titles": []})["titles"]
visible_mr = sql("SELECT no, name FROM series WHERE artist_slug='mountain-radio' AND status='approved' AND deleted_at IS NULL AND hidden_at IS NULL ORDER BY no")
check("2e 山線電台那區筆數＝可見系列數", len(mr) == len(visible_mr), (len(mr), len(visible_mr)))
# 隱藏一個系列：不再列出；恢復後回來
hide_no = visible_mr[-1]["no"]
r = requests.post(B + "/api/admin/hide", json={"type": "series", "key": f"mountain-radio/{hide_no}", "hidden": True}, headers=AH)
o2, _ = other_series("/artist/tide-highway/2")
check("2f 管理員隱藏系列後不列出", r.ok and len(o2["mountain-radio"]["titles"]) == len(mr) - 1 and visible_mr[-1]["name"] not in o2["mountain-radio"]["titles"], (r.status_code, len(o2["mountain-radio"]["titles"])))
requests.post(B + "/api/admin/hide", json={"type": "series", "key": f"mountain-radio/{hide_no}", "hidden": False}, headers=AH)
o3, _ = other_series("/artist/tide-highway/2")
check("2g 恢復後又列出", len(o3["mountain-radio"]["titles"]) == len(mr), len(o3["mountain-radio"]["titles"]))
o4, _ = other_series("/artist/yeemao/1")
check("2h 只有一個系列的藝人不出現這區", "yeemao" not in o4, list(o4))

# ================= 3. 資料貢獻者 =================
# 新建一個系列（本機示範資料），13 位會員：12 位正常＋1 位停權（貢獻最多）
pool = sql("SELECT id, handle, name FROM users WHERE status='active' AND email_verified_at IS NOT NULL AND email NOT LIKE '%demo.yinzang.test' ORDER BY created_at LIMIT 13")
assert len(pool) == 13, "本機會員不夠 13 位"
no = sql("SELECT COALESCE(MAX(no),0)+1 AS n FROM series WHERE artist_slug='yeemao'")[0]["n"]
skey = f"yeemao/{no}"
stmts = [f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status) VALUES ('yeemao', {no}, '驗收貢獻者{STAMP}', '2025《驗收貢獻者{STAMP}》專輯發行', '專輯發行', '[\"yeemao\"]', '2025', '[\"驗收用\"]', 'approved')"]
counts = {}
for i, u in enumerate(pool[:12]):
    n = 2 * (12 - i)  # 24, 22, …, 2
    counts[u["id"]] = n
    for k in range(n):
        stmts.append(f"INSERT INTO revisions (target, field, content, summary, author_id) VALUES ('series:{skey}', 'body', '[]', '驗收{k}', '{u['id']}')")
sus = pool[12]
for k in range(40):
    stmts.append(f"INSERT INTO revisions (target, field, content, summary, author_id) VALUES ('series:{skey}', 'body', '[]', '驗收停權{k}', '{sus['id']}')")
u11 = pool[10]  # 原本 4 次，加收藏、品項、版本各 1 → 7，超過第 10 位（6）
stmts.append(f"INSERT INTO items (series_id, item_id, kind, status, created_by) SELECT id, 'cd', 'CD', 'approved', '{u11['id']}' FROM series WHERE artist_slug='yeemao' AND no={no}")
stmts.append(f"INSERT INTO versions (item_ref, version_id, edition, status, created_by) SELECT i.id, 'v1', '一般版', 'approved', '{u11['id']}' FROM items i JOIN series s ON s.id=i.series_id WHERE s.artist_slug='yeemao' AND s.no={no}")
stmts.append(f"INSERT INTO shares (author_id, what, kind, series_key, item_id, version_id) VALUES ('{u11['id']}', '驗收貢獻者收藏{STAMP}', 'CD', '{skey}', 'cd', 'v1')")
stmts.append(f"UPDATE users SET status='suspended' WHERE id='{sus['id']}'")
sql(";\n".join(stmts))
counts[u11["id"]] += 3
try:
    h = requests.get(f"{B}/artist/{skey}").text
    sec = re.search(r'data-testid="contributors".*?</section>', h, re.S)
    sec = sec.group(0).replace("<!-- -->", "") if sec else ""
    shown = re.findall(r'href="/u/([^"]+)"', sec)
    by_handle = {u["handle"]: counts[u["id"]] for u in pool[:12]}
    expect = sorted(by_handle, key=lambda k: -by_handle[k])[:10]
    check("3a 最多顯示 10 位", len(shown) == 10, len(shown))
    check("3b 依貢獻次數排序（收藏、品項、版本都算）", shown == expect, {"shown": [(x, by_handle.get(x)) for x in shown]})
    check("3c 超過 10 位顯示「等 12 位」", "等 12 位" in sec and ">12<" in sec, re.findall(r"等 \d+ 位", sec))
    check("3d 停權帳號不顯示（他貢獻最多 40 次）", sus["handle"] not in shown and f'/u/{sus["handle"]}"' not in sec, sus["handle"])
    check("3e 第 11 位（被擠出前 10）不顯示", sorted(by_handle, key=lambda k: -by_handle[k])[10] not in shown)
finally:
    sql(f"UPDATE users SET status='active' WHERE id='{sus['id']}'")
h = requests.get(f"{B}/artist/{skey}").text
sec = re.search(r'data-testid="contributors".*?</section>', h, re.S).group(0).replace("<!-- -->", "")
check("3f 停權恢復後重新出現、總數變 13", f'/u/{sus["handle"]}"' in sec and "等 13 位" in sec, re.findall(r"等 \d+ 位", sec))

# ================= 4. 留言 =================
N = 95
owner = sql(f"SELECT u.email FROM shares s JOIN users u ON u.id=s.author_id WHERE s.no={N}")[0]["email"]
P = login(owner)  # 發文者
c1, c2, c3, c4, c5, c6, c7, c8, c9 = [login(f"r{i:02d}@demo.yinzang.test") for i in range(4, 13) if i != 11] + [login("xiaomeng@demo.yinzang.test")]
ov = login("r11@demo.yinzang.test")


def post(u, body, cc="TW"):
    return requests.post(B + "/api/comments", json={"share": N, "body": body}, headers=H(u, cc))


def listc(u=None):
    return requests.get(f"{B}/api/comments?share={N}", headers=H(u) if u else {}).json()["comments"]


# 4a 未登入
r = requests.post(B + "/api/comments", json={"share": N, "body": "未登入"})
check("4a 未登入不能留言（401）", r.status_code == 401, r.status_code)
# 4b 未驗證：拿到 session 後把驗證清掉（正式流程未驗證的帳號登不進來，這裡模擬舊 session）
unv = login("r02@demo.yinzang.test")
sql(f"UPDATE users SET email_verified_at=NULL WHERE id='{unv['id']}'")
try:
    r = post(unv, "未驗證")
    check("4b 未驗證 Email 不能留言（403 NOT_VERIFIED）", r.status_code == 403 and r.json()["error"]["code"] == "NOT_VERIFIED", r.text[:120])
    check("4b2 GET 回 canPost=false", requests.get(f"{B}/api/comments?share={N}", headers=H(unv)).json()["canPost"] is False)
finally:
    sql(f"UPDATE users SET email_verified_at='2026-09-01T00:00:00.000Z' WHERE id='{unv['id']}'")
# 從這裡開始量：留言相關的寫入都不能讓內容版本變動（上面 4b 改 users 會觸發，所以放在量之前）
page_v0 = cv()
requests.get(f"{B}/share/{N}")
hit0 = requests.get(f"{B}/share/{N}").headers.get("x-yz-cache")
# 4c 字數
r = post(c3, "字" * 501)
check("4c 501 字被擋（400 TOO_LONG）", r.status_code == 400 and r.json()["error"]["code"] == "TOO_LONG", r.text[:120])
r = post(c3, "字" * 500)
check("4c2 剛好 500 字可以（201）", r.status_code == 201, r.status_code)
r = post(c3, "😀" * 500)
check("4c3 500 個 emoji 以字元算，可以（201）", r.status_code == 201, r.status_code)
# 4d XSS
XSS = f'<script>window.__yzx=1</script><img src=x onerror="window.__yzx=2"> {STAMP}'
r = post(c2, XSS)
xss_id = r.json().get("id")
check("4d 含 HTML 的留言照存（201）", r.status_code == 201, r.status_code)
# 4e 詐騙字眼
SCAM = f"加我賴 abc{STAMP} 私下匯款比較便宜"
r = post(c4, SCAM)
scam_id = r.json().get("id")
check("4e 含站外交易字眼不擋（201），回 warn=true", r.status_code == 201 and r.json().get("warn") is True, r.text[:120])
NORMAL = f"這版本的側標好漂亮 {STAMP}"
r = post(c5, NORMAL)
normal_id = r.json().get("id")
check("4e2 一般留言 warn=false", r.status_code == 201 and r.json().get("warn") is False, r.text[:120])
for t, exp in [("https://line.me/ti/p/xx", True), ("www.shop.tw 看看", True), ("LINE ID: abc", True), ("私下交易", True), ("轉帳給我", True), ("@mystore 私訊", True),
               ("我也有這張 online 買的", False), ("deadline 前寄出", False), ("2018 年首批", False)]:
    # 規則在 TS 檔裡，直接用 API 驗：送出後看 warn（每則之前清掉 c9 的每分鐘計數）
    sql(f"DELETE FROM rate_limits WHERE key='comment-min:{c9['id']}'")
    rr = post(c9, t + f" {STAMP}")
    check(f"4e3 「{t}」提醒={exp}", rr.status_code == 201 and rr.json().get("warn") is exp, rr.text[:100])
# 4f 頻率：每分鐘 3 則
codes = [post(c6, f"連發{i} {STAMP}").status_code for i in range(4)]
check("4f 每分鐘第 4 則被擋（201,201,201,429）", codes == [201, 201, 201, 429], codes)
# 4f2 每天 50 則：把當天計數調到 50
sql(f"INSERT INTO rate_limits (key, count, reset_at) VALUES ('comment-day:{c7['id']}', 50, '2099-01-01T00:00:00.000Z') ON CONFLICT(key) DO UPDATE SET count=50, reset_at='2099-01-01T00:00:00.000Z'")
r = post(c7, "今天第 51 則")
check("4f2 每天第 51 則被擋（429）", r.status_code == 429 and "今天" in r.json()["error"]["message"], r.text[:120])
sql(f"DELETE FROM rate_limits WHERE key='comment-day:{c7['id']}'")
# 4g 海外帳號可以留言
r = post(ov, f"海外留言 {STAMP}", cc="US")
check("4g 海外連線（US）可以留言（201）", r.status_code == 201, r.status_code)
# 4h 刪除權限
r = post(c8, f"給刪除測試 {STAMP}")
del_id = r.json()["id"]
r = requests.delete(f"{B}/api/comments/{del_id}", headers=H(c1))
check("4h 非發文者、非留言者不能刪（403）", r.status_code == 403, r.status_code)
r = requests.delete(f"{B}/api/comments/{del_id}", headers=H(P))
check("4h2 發文者能刪別人的留言（200）", r.status_code == 200 and all(c["id"] != del_id for c in listc()), r.status_code)
r = post(c8, f"自己刪 {STAMP}")
own_id = r.json()["id"]
check("4h3 留言者能刪自己的（200）", requests.delete(f"{B}/api/comments/{own_id}", headers=H(c8)).status_code == 200)
r = post(c1, f"管理員刪 {STAMP}")
adm_id = r.json()["id"]
check("4h4 管理員能刪任何留言（200）", requests.delete(f"{B}/api/comments/{adm_id}", headers=AH).status_code == 200)
lst = {c["id"]: c for c in listc(P)}
check("4h5 發文者看到每則都有刪除權", all(c["canDelete"] for c in lst.values()), len(lst))
lst1 = {c["id"]: c for c in listc(c1)}
check("4h6 一般會員只有自己的留言能刪", all(c["canDelete"] == c["mine"] for c in lst1.values()))
# 4i 檢舉達門檻自動隱藏（預設 3）
th = requests.get(B + "/api/admin", headers=AH).json()["comments"]["threshold"]
rep = [c1, c7, c8, c9, c3][:th]
out = [requests.post(B + "/api/reports", json={"target": f"comment:{normal_id}", "reason": "abuse"}, headers=H(u)).json() for u in rep]
check(f"4i 第 {th} 人檢舉後自動隱藏", out[-1].get("hidden") is True and all(not o.get("hidden") for o in out[:-1]), out)
check("4i2 隱藏後公開列表看不到", all(c["id"] != normal_id for c in listc()))
r = requests.post(B + "/api/reports", json={"target": f"comment:{normal_id}", "reason": "abuse"}, headers=H(rep[0]))
check("4i3 同一人不能重複檢舉（409）", r.status_code == 409, r.status_code)
r = requests.post(B + "/api/reports", json={"target": f"comment:{scam_id}", "reason": "scam"}, headers=H(c4))
check("4i4 不能檢舉自己的留言（403）", r.status_code == 403, r.status_code)
ov_ = requests.get(B + "/api/admin", headers=AH).json()["comments"]["list"]
row = next((x for x in ov_ if x["id"] == normal_id), None)
check("4j 後台待處理有這則、標已隱藏、人數正確", row and row["hidden"] and row["reports"] == th, row)
q = requests.get(B + "/api/admin/stats?fresh=1", headers=AH).json()
check("4j2 儀表板佇列有被檢舉的留言數", q["queue"]["comments"] >= 1 and q["queue"]["commentsHidden"] >= 1 and q["stats"]["comments"]["total"] >= 1, (q["queue"], q["stats"]["comments"]))
r = requests.post(B + "/api/admin/comments", json={"id": normal_id, "action": "restore"}, headers=AH)
check("4j3 管理員恢復後重新出現", r.ok and any(c["id"] == normal_id for c in listc()))
r = requests.post(B + "/api/reports", json={"target": f"comment:{normal_id}", "reason": "other", "note": "再檢舉"}, headers=H(c3))
check("4j4 恢復過的（保留）再被檢舉不會再自動隱藏", r.status_code == 201 and r.json()["hidden"] is False, r.text[:100])
# 4l 內容版本不變、整頁快取沒有失效
page_v1 = cv()
check("4l 留言、刪除、檢舉、自動隱藏、恢復前後 content_version 不變", page_v0 == page_v1, (page_v0, page_v1))
hit1 = requests.get(f"{B}/share/{N}")
check("4l2 單則頁整頁快取仍命中（HIT），HTML 裡沒有留言內文", hit0 == "HIT" and hit1.headers.get("x-yz-cache") == "HIT" and STAMP not in hit1.text, (hit0, hit1.headers.get("x-yz-cache")))

# 停權的留言者：留言不顯示
sql(f"UPDATE users SET status='suspended' WHERE id='{c5['id']}'")
try:
    check("4k 留言者停權後留言不顯示", all(c["author"]["handle"] != c5["handle"] for c in listc()))
finally:
    sql(f"UPDATE users SET status='active' WHERE id='{c5['id']}'")

# ================= 5. 畫面：XSS、提醒、登入狀態、溢出 =================
views = [
    ("series_other", "/artist/tide-highway/2", None, "[data-testid=other-series]"),
    ("series_contrib", f"/artist/{skey}", None, "[data-testid=contributors]"),
    ("share_anon", f"/share/{N}", None, "#comments"),
    ("share_member", f"/share/{N}", c2, "#comments"),
    ("share_owner", f"/share/{N}", P, "#comments"),
    ("admin_comments", "/admin/moderation", admin, "#comments"),
    ("admin_dash", "/admin", admin, "[data-testid=queue]"),
]
with sync_playwright() as p:
    br = p.chromium.launch()
    for w in (1440, 390):
        for name, path, u, sel in views:
            ctx = br.new_context(viewport={"width": w, "height": 900})
            if u:
                ctx.add_cookies([{"name": "yz_session", "value": u["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text[:160]) if m.type == "error" else None)
            pg.on("dialog", lambda d: d.accept())
            pg.goto(B + path)
            pg.wait_for_load_state("networkidle")
            pg.evaluate("document.fonts.ready")
            if path.startswith("/share/"):
                pg.wait_for_selector("[data-testid=comment-list]", timeout=15000)
            if sel.startswith("#comments") and path.startswith("/admin"):
                pg.wait_for_selector("[data-testid=comment-table], #comments .empty", timeout=15000)
            ov_w = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            check(f"5a {name} {w} 無橫向溢出、console error 0", ov_w <= 0 and not errs, (ov_w, errs))
            el = pg.locator(sel).first
            try:
                el.scroll_into_view_if_needed(timeout=5000)
            except Exception:
                pass
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=False)
            if name == "share_member" and w == 1440:
                li = pg.locator(f'[data-comment="{xss_id}"] .comment-body')
                txt = li.inner_text()
                check("5b XSS：留言照原文顯示成文字", txt.strip() == XSS.strip(), txt[:120])
                check("5b2 XSS：留言裡沒有被插入 img／script 元素、腳本沒執行", pg.locator(f'[data-comment="{xss_id}"] img, [data-comment="{xss_id}"] script').count() == 0 and pg.evaluate("window.__yzx === undefined"))
                check("5c 詐騙字眼那則顯示「小心站外交易詐騙」", pg.locator(f'[data-comment="{scam_id}"] [data-testid=comment-warn]').inner_text() == "小心站外交易詐騙")
                check("5c2 一般留言沒有提醒", pg.locator(f'[data-comment="{normal_id}"] [data-testid=comment-warn]').count() == 0)
                pg.fill("#comment-text", "我們私下匯款就好")
                check("5c3 輸入時出現提醒但送出鈕可按", pg.locator("[data-testid=compose-warn]").is_visible() and pg.locator("[data-testid=comment-submit]").is_enabled())
                pg.fill("#comment-text", "字" * 501)
                check("5d 超過 500 字：計數變色、送出鈕停用", pg.locator(".comment-count.over").count() == 1 and not pg.locator("[data-testid=comment-submit]").is_enabled())
                pg.fill("#comment-text", f"畫面送出 {STAMP}")
                pg.click("[data-testid=comment-submit]")
                pg.wait_for_function(f"() => [...document.querySelectorAll('.comment-body')].some(e => e.textContent.includes('畫面送出 {STAMP}'))", timeout=15000)
                check("5e 畫面送出留言後出現在列表", True)
                check("5e2 別人的留言沒有刪除鈕", pg.locator(f'[data-comment="{scam_id}"] [data-testid=comment-delete]').count() == 0)
            if name == "share_anon" and w == 1440:
                check("5f 未登入沒有輸入框，顯示「登入後留言」", pg.locator("#comment-text").count() == 0 and pg.get_by_role("button", name="登入後留言").count() == 1)
            if name == "share_owner" and w == 1440:
                check("5g 發文者每則都有刪除鈕", pg.locator("[data-testid=comment-delete]").count() == pg.locator(".comment").count())
            ctx.close()
    br.close()

(OUT / "驗收紀錄_本機.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n{sum(r['ok'] for r in res)}/{len(res)}")
sys.exit(0 if all(r["ok"] for r in res) else 1)
