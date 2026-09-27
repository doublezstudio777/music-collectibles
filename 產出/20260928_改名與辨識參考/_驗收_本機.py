# 改名樂迷藏＋辨識參考改管理員標記＋拿掉分享圖＋標題重複＋發文者編輯＋藝人標籤直連＋設定頁回饋：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 本機資料不清空：每次重跑自己建一批新會員（帳號名帶時間戳），只驗這批。
import io, json, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests

# 每個請求都帶逾時，卡住就報錯不無限等（2026-09-28 第一次跑卡在一個 GET 上）
_orig = requests.Session.request
requests.Session.request = lambda self, *a, **kw: _orig(self, *a, **{"timeout": 30, **kw})
from PIL import Image
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
res = []
ST = str(int(time.time()))[-6:]
NOW = datetime.now(timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
TT = "XXXX.DUMMY.TOKEN.XXXX"


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:400]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
        cwd=SITE, capture_output=True, text=True,
    )
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def one(cmd):
    r = sql(cmd)
    return list(r[0].values())[0] if r else None


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email, "name": j["user"]["name"]}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
admin = login("admin@demo.yinzang.test")
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")


def mkuser(tag):
    h = f"rn{tag}{ST}"
    uid = f"u-{h}"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@rn.test', '{iso(NOW)}', '{PW}', '{h}', '改名{tag}{ST}', '{iso(NOW)}', '{iso(NOW)}')")
    return login(f"{h}@rn.test")


def img_bytes(w, h, color, fmt="WEBP"):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, fmt, quality=80)
    return b.getvalue()


def upload(u, color):
    r = requests.post(B + "/api/uploads", headers=H(u), files={"image": ("p.webp", img_bytes(1200, 900, color), "image/webp"),
                      "thumb": ("t.webp", img_bytes(480, 360, color), "image/webp")}, data={"purpose": "share"})
    return r.json()["id"]


def page(path, **kw):
    return requests.get(B + path, allow_redirects=False, **kw)


def meta(html, prop):
    m = re.search(rf'<meta (?:property|name)="{re.escape(prop)}" content="([^"]*)"', html)
    return m.group(1) if m else None


def ctx_for(pw, u, **kw):
    c = pw.chromium.launch().new_context(viewport={"width": 1280, "height": 900}, **kw)
    c.add_cookies([{"name": "yz_session", "value": u["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    return c


def settle(p):
    try:
        p.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass


# ============================ 1. 站名改為樂迷藏 ============================
pages = ["/", "/artists", "/artist/gordon", "/artist/gordon/1", "/terms", "/privacy", "/login", "/share/new", "/tag/%E9%9D%9C%E9%9F%B3"]
bad = {}
for p in pages:
    h = page(p).text
    txt = re.sub(r"<script[\s\S]*?</script>", "", h)
    if "音藏" in txt:
        bad[p] = txt.count("音藏")
check("1a 9 個公開頁的 HTML（去掉 script）沒有「音藏」", not bad, bad)
home = page("/").text
check("1b 首頁 <title> 是「樂迷藏｜樂迷的收藏分享」", "<title>樂迷藏｜樂迷的收藏分享</title>" in home, re.search(r"<title>[^<]*</title>", home).group(0))
ha0 = page("/artist/gordon").text
check("1c og:site_name＝樂迷藏（藝人頁）", meta(ha0, "og:site_name") == "樂迷藏", meta(ha0, "og:site_name"))
check("1d 頁首字標是樂迷藏", re.search(r'class="brand[^"]*"[^>]*>[\s\S]{0,200}樂迷藏', home) is not None or ">樂迷藏<" in home, "")
t, pv = page("/terms").text, page("/privacy").text
check("1e 使用條款、隱私權政策內文用樂迷藏", "樂迷藏" in t and "樂迷藏" in pv and "音藏" not in re.sub(r"<script[\s\S]*?</script>", "", t + pv), "")
check("1f 驗證信寄件人與內文用樂迷藏（程式常數）", "`${SITE_NAME} <noreply@notify.dblzm.com>`" in (SITE / "lib/server/services.ts").read_text() and 'SITE_NAME = "樂迷藏"' in (SITE / "lib/data.ts").read_text(), "")
u0 = mkuser("n")
r = requests.patch(B + "/api/me/profile", headers=H(u0), json={"name": f"樂迷藏小編{ST}"})
check("1g 暱稱含「樂迷藏」被擋（保留字）", r.status_code == 400 and r.json()["error"]["code"] == "NAME_RESERVED", r.text[:120])
r = requests.patch(B + "/api/me/profile", headers=H(u0), json={"name": f"音藏小編{ST}"})
check("1h 舊名「音藏」仍是保留字", r.status_code == 400 and r.json()["error"]["code"] == "NAME_RESERVED", r.text[:120])

# ============================ 4. 標題不重複（系列・品項・版本） ============================
u1 = mkuser("a")
p1 = upload(u1, (30, 120, 200))
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [p1], "about": ["國蛋"], "seriesKey": "gordon/1", "itemId": "cd", "versionId": "v1",
                                                           "story": "第一版", "tags": ["簽名"]})
check("4a 發文 201", r.status_code == 201, r.text[:120])
N1 = r.json()["n"]
w1 = one(f"SELECT what FROM shares WHERE no = {N1}")
check("4b 版本名已含品項：標題＝「BACK Again・2010 CD」（不再是 BACK Again CD 2010 CD）", w1 == "BACK Again・2010 CD", w1)
p2 = upload(u1, (200, 60, 60))
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [p2], "about": ["國蛋"], "seriesKey": "gordon/4", "itemId": "vinyl", "versionId": "v1"})
N2 = r.json()["n"]
w2 = one(f"SELECT what FROM shares WHERE no = {N2}")
check("4c 版本名沒含品項：標題＝「GDN Express・黑膠・限定版」", w2 == "GDN Express・黑膠・限定版", w2)
p3 = upload(u1, (60, 200, 60))
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [p3], "about": ["國蛋"], "seriesKey": "gordon/1", "itemId": "cd"})
w3 = one(f"SELECT what FROM shares WHERE no = {r.json()['n']}")
check("4d 版本不確定：標題＝「BACK Again・CD」", w3 == "BACK Again・CD", w3)
p4 = upload(u1, (90, 90, 90))
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [p4], "about": ["國蛋", "熊仔"], "kind": "T 恤"})
N4 = r.json()["n"]
w4 = one(f"SELECT what FROM shares WHERE no = {N4}")
check("4e 沒連系列：標題＝「國蛋、熊仔・T 恤」", w4 == "國蛋、熊仔・T 恤", w4)
h1 = page(f"/share/{N1}").text
check("4f 單則頁 h1、og:title 都是新標題", f">{w1}<" in h1 and meta(h1, "og:title") == w1, meta(h1, "og:title"))
desc = meta(h1, "og:description")
check("4g og:description（分享文字同一套）沒有「CD・2010 CD」重複", desc == "國蛋・BACK Again・2010 CD", desc)
hc = page("/artist/gordon/1").text
check("4h 系列頁商品卡標題用新標題", w1 in hc and "BACK Again CD 2010 CD" not in hc, "")

# ============================ 3. 拿掉下載分享圖 ============================
with sync_playwright() as pw:
    c = pw.chromium.launch().new_context(viewport={"width": 1280, "height": 900})
    pg = c.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(B + f"/share/{N1}")
    settle(pg)
    check("3a 單則頁只有「分享」按鈕，沒有「下載分享圖」", pg.locator("[data-testid=share-btn]").count() == 1 and pg.locator("[data-testid=share-image-btn]").count() == 0
          and "下載分享圖" not in pg.content(), "")
    pg.click("[data-testid=share-btn]")
    items = pg.locator("[data-testid=share-menu] li").all_inner_texts()
    check("3b 桌機分享選單：複製連結、Facebook、Threads、LINE", [x.strip() for x in items] == ["複製連結", "Facebook", "Threads", "LINE"], items)
    check("3c og:image 仍在（預覽圖保留）", meta(h1, "og:image") is not None, meta(h1, "og:image"))
    check("3d 單則頁 console error 0", not errs, errs[:3])
    c.close()
src = "\n".join(p.read_text() for p in (SITE / "components").glob("*.tsx")) + (SITE / "lib/share-image.ts").read_text()
check("3e 程式裡沒有 drawShareImage／SHARE_IMAGE_SIZE／share-image-btn", not re.search(r"drawShareImage|SHARE_IMAGE_SIZE|share-image-btn", src), "")

# ============================ 7. 藝人名稱標籤直連藝人頁 ============================
check("7a 單則頁「國蛋」標籤 href＝/artist/gordon", 'href="/artist/gordon" class="tag tag-about"' in h1, "")
check("7b 自由標籤「簽名」照舊連 /tag/簽名", 'href="/tag/%E7%B0%BD%E5%90%8D"' in h1, "")
r = page("/tag/%E5%9C%8B%E8%9B%8B")
check("7c /tag/國蛋 回 301 到 /artist/gordon", r.status_code == 301 and r.headers.get("location", "").endswith("/artist/gordon"), (r.status_code, r.headers.get("location")))
r = page("/tag/%E7%B0%BD%E5%90%8D")
check("7d /tag/簽名（自由標籤）200 不轉", r.status_code == 200, r.status_code)
card = page("/artist/gordon/1").text
check("7e 系列頁商品卡的國蛋標籤也連藝人頁", 'href="/artist/gordon" class="tag tag-about"' in card, "")
# 被隱藏的藝人：不轉址、標籤照舊連 /tag/
hid = f"藏{ST}"
sql(f"INSERT INTO artists (slug, name, aliases, kind, status, display, created_at, updated_at) VALUES ('hid-{ST}', '{hid}', '[]', '藝人', 'approved', 'off', '{iso(NOW)}', '{iso(NOW)}')")
p5 = upload(u1, (10, 10, 10))
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [p5], "about": [hid], "kind": "CD"})
N5 = r.json()["n"]
r = page("/tag/" + requests.utils.quote(hid))
check("7f 藝人頁關閉（display=off）：/tag/{名} 不轉址 200", r.status_code == 200, r.status_code)
check("7g 同一則的標籤照舊連 /tag/", f'href="/tag/{requests.utils.quote(hid)}"' in page(f"/share/{N5}").text, "")
ha = page("/artist/gordon").text
check("7h 藝人頁「相關收藏」列全部、沒有連回 /tag/國蛋", "/tag/%E5%9C%8B%E8%9B%8B" not in ha and 'data-testid="related-count"' in ha, "")

# ============================ 2. 辨識參考改管理員標記 ============================
nf = page("/share/new").text
check("2a 發文表單沒有「照片可當辨識參考」勾選", "辨識參考" not in re.sub(r"<script[\s\S]*?</script>", "", nf), "")
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [upload(u1, (1, 2, 3))], "about": ["國蛋"], "kind": "CD", "refPhoto": True})
check("2b API 帶 refPhoto:true 也不會寫進 ref_photo", r.status_code == 201 and one(f"SELECT ref_photo FROM shares WHERE no = {r.json()['n']}") == 0, "")
thumb1 = one(f"SELECT thumb_key FROM photos WHERE share_no = {N1}")
r = requests.post(B + "/api/admin/ref-photo", headers=H(u1), json={"share": N1, "key": f"/img/{thumb1}", "on": True})
check("2c 一般會員打標記 API 403", r.status_code == 403, r.status_code)
before_ref = one("SELECT COUNT(*) FROM score_events WHERE kind = 'ref'")
logs0 = one("SELECT COUNT(*) FROM admin_log WHERE action LIKE '%辨識參考%'")
with sync_playwright() as pw:
    c = ctx_for(pw, admin)
    pg = c.new_page()
    pg.goto(B + f"/share/{N1}")
    settle(pg)
    pg.wait_for_selector("[data-testid=ref-admin]", timeout=10000)
    check("2d 管理員在單則頁看到每張照片的「標為辨識參考」", pg.locator("[data-testid=ref-toggle]").first.inner_text() == "標為辨識參考", "")
    pg.click("[data-testid=ref-toggle]")
    pg.wait_for_selector("[data-testid=ref-admin] [role=status]", timeout=5000)
    check("2e 按下後顯示「已標為辨識參考」並變成「取消」", "已標為辨識參考" in pg.locator("[data-testid=ref-admin] [role=status]").inner_text()
          and pg.locator("[data-testid=ref-toggle]").first.inner_text() == "取消", "")
    pg.screenshot(path=str(IMG / "2_管理員標辨識參考.jpg"), type="jpeg", quality=80)
    c.close()
    c = pw.chromium.launch().new_context(viewport={"width": 1280, "height": 900})
    pg = c.new_page()
    pg.goto(B + f"/share/{N1}")
    settle(pg)
    check("2f 未登入看不到管理員操作", pg.locator("[data-testid=ref-admin]").count() == 0, "")
    c.close()
check("2g D1 photos.ref_at 有值、ref_by＝管理員", one(f"SELECT ref_by FROM photos WHERE share_no = {N1}") == admin["id"], "")
hs = page("/artist/gordon/1").text
check("2h 系列頁版本區塊「辨識參考照片」列出這張", 'data-testid="ref-photo"' in hs and thumb1 in hs.split('data-testid="ref-photo"')[1][:400], "")
r = requests.post(B + "/api/admin/ref-photo", headers=H(admin), json={"share": N1, "key": f"/img/{thumb1}", "on": False})
check("2i 取消 200", r.status_code == 200, r.text[:100])
hs = page("/artist/gordon/1").text
check("2j 取消後版本區塊不再列這張", thumb1 not in "".join(x[:400] for x in hs.split('data-testid="ref-photo"')[1:]), "")
check("2k 操作紀錄寫了 2 筆（標記＋取消）", one("SELECT COUNT(*) FROM admin_log WHERE action LIKE '%辨識參考%'") - logs0 == 2, "")
r = requests.post(B + "/api/admin/scores", headers=H(admin), json={"action": "recompute"})
check("2l 重算分數後沒有新的 ref 事件（+5 規則拿掉）", one("SELECT COUNT(*) FROM score_events WHERE kind = 'ref'") == before_ref, before_ref)
check("2m 舊 ref 事件全部作廢不計分", one("SELECT COUNT(*) FROM score_events WHERE kind = 'ref' AND state != 'void'") == 0, one("SELECT COUNT(*) FROM score_events WHERE kind = 'ref'"))

# ============================ 5. 發文者編輯已發布的內容 ============================
u2 = mkuser("b")
se0 = one(f"SELECT COUNT(*) FROM score_events WHERE user_id = '{u1['id']}'")
share_ev0 = one(f"SELECT COUNT(*) FROM score_events WHERE source = 'share:{N1}'")
r = requests.put(B + f"/api/shares/{N1}", headers=H(u2), json={"about": ["國蛋"], "kind": "CD", "story": "亂改"})
check("5a 非發文者打編輯 API 403", r.status_code == 403, r.status_code)
r = requests.put(B + f"/api/shares/{N1}", json={"about": ["國蛋"], "kind": "CD"})
check("5b 沒登入打編輯 API 401", r.status_code == 401, r.status_code)
v0 = one("SELECT v FROM content_version WHERE id = 1")
page(f"/share/{N1}")  # 先讓整頁快取存一份
body = {"about": ["國蛋"], "seriesKey": "gordon/4", "itemId": "vinyl", "versionId": "v1", "story": f"改過的說明{ST}", "tags": ["簽名", f"新標籤{ST}"],
        "sale": {"state": "sale", "price": 1200}}
r = requests.put(B + f"/api/shares/{N1}", headers=H(u1), json=body)
check("5c 發文者改說明、標籤、版本、價格 200，回傳新標題", r.status_code == 200 and r.json()["what"] == "GDN Express・黑膠・限定版", r.text[:160])
row = sql(f"SELECT what, story, tags, series_key, item_id, version_id, sale_state, price, edited_at FROM shares WHERE no = {N1}")[0]
check("5d D1 各欄位都更新了", row["story"] == f"改過的說明{ST}" and f"新標籤{ST}" in row["tags"] and row["series_key"] == "gordon/4" and row["item_id"] == "vinyl"
      and row["sale_state"] == "sale" and row["price"] == 1200 and row["edited_at"], row)
check("5e 內容版本號前進（整頁快取換版）", one("SELECT v FROM content_version WHERE id = 1") > v0, "")
h = page(f"/share/{N1}").text
check("5f 單則頁立刻顯示新標題、說明、價格、最後編輯於", ">GDN Express・黑膠・限定版<" in h and f"改過的說明{ST}" in h and "1,200" in h and 'data-testid="edited-at"' in h, "")
h41 = page("/artist/gordon/1").text
h44 = page("/artist/gordon/4").text
check("5g 系列頁跟著換：舊版本（gordon/1）不再列、新版本（gordon/4）列出", f"/share/{N1}\"" not in h41 and f"/share/{N1}\"" in h44, "")
check("5h 發文事件仍只有 1 筆（改版本不重複加分）", one(f"SELECT COUNT(*) FROM score_events WHERE source = 'share:{N1}'") == share_ev0 == 1, share_ev0)
requests.post(B + "/api/admin/scores", headers=H(admin), json={"action": "recompute"})
check("5i 重算後發文者的事件數沒多（沒有重複加分）", one(f"SELECT COUNT(*) FROM score_events WHERE user_id = '{u1['id']}'") == se0, se0)
r = requests.put(B + f"/api/shares/{N1}", headers=H(u1), json={"about": ["國蛋"], "seriesKey": "gordon/1", "itemId": "cd", "story": "版本不確定"})
check("5j 版本可以改成「不確定」：標題「BACK Again・CD」", r.status_code == 200 and r.json()["what"] == "BACK Again・CD", r.text[:120])
# 有人出價中改價格：照現有交易規則，改價並在每條對話插一行系統訊息通知出價者
requests.put(B + f"/api/shares/{N1}", headers=H(u1), json={"about": ["國蛋"], "kind": "CD", "sale": {"state": "offer"}})
r = requests.post(B + f"/api/shares/{N1}/offers", headers=H(u2), json={"kind": "offer", "price": 800})
check("5k 別人出價 800 成功", r.status_code in (200, 201), r.text[:120])
r = requests.put(B + f"/api/shares/{N1}", headers=H(u1), json={"about": ["國蛋"], "kind": "CD", "sale": {"state": "sale", "price": 1500}})
msgs = sql(f"SELECT m.text FROM messages m JOIN threads t ON t.id = m.thread_id WHERE t.share_no = {N1} AND m.from_id IS NULL ORDER BY m.id DESC LIMIT 1")
check("5l 出價中改價：允許，對話裡插系統訊息通知出價者", r.status_code == 200 and msgs and "定價出售" in msgs[0]["text"] and "1,500" in msgs[0]["text"], msgs)
# 鎖定中不能改
sql(f"INSERT INTO target_decisions (target, decision, decided_by, decided_at) VALUES ('share:{N2}', 'kept', '{admin['id']}', '{iso(NOW)}')")
r = requests.put(B + f"/api/shares/{N2}", headers=H(u1), json={"about": ["國蛋"], "kind": "CD", "story": "鎖定中改"})
check("5m 鎖定中不能改（423）", r.status_code == 423, r.text[:120])
# 已成交：出售狀態與價格不能改，內容可以改
sql(f"UPDATE shares SET sale_state = 'sold', price = 900, sold_price = 900, sold_at = '{iso(NOW)}' WHERE no = {N4}")
r = requests.put(B + f"/api/shares/{N4}", headers=H(u1), json={"about": ["國蛋", "熊仔"], "kind": "T 恤", "sale": {"state": "sale", "price": 2000}})
check("5n 已成交改價格 409", r.status_code == 409 and "已成交" in r.json()["error"]["message"], r.text[:120])
r = requests.put(B + f"/api/shares/{N4}", headers=H(u1), json={"about": ["國蛋", "熊仔"], "kind": "T 恤", "story": "成交後補說明"})
check("5o 已成交仍可改說明（不送出售欄位）", r.status_code == 200 and one(f"SELECT sale_state FROM shares WHERE no = {N4}") == "sold", r.text[:120])
# 被隱藏的不能改
sql(f"UPDATE shares SET hidden_at = '{iso(NOW)}' WHERE no = {N5}")
r = requests.put(B + f"/api/shares/{N5}", headers=H(u1), json={"about": [hid], "kind": "CD", "story": "隱藏中改"})
check("5p 被隱藏的不能改（404）", r.status_code == 404, r.status_code)
# 管理員可以改（內容），寫操作紀錄
r = requests.put(B + f"/api/shares/{N1}", headers=H(admin), json={"about": ["國蛋"], "kind": "CD", "story": "管理員修正"})
check("5q 管理員可以改別人的內容，寫操作紀錄", r.status_code == 200 and one(f"SELECT COUNT(*) FROM admin_log WHERE action = '編輯別人的炫收藏' AND target = 'share:{N1}'") >= 1, r.text[:100])
# UI：發文者看得到「編輯」，表單帶入原值，改說明存檔
with sync_playwright() as pw:
    c = ctx_for(pw, u1)
    pg = c.new_page()
    pg.goto(B + f"/share/{N1}")
    settle(pg)
    pg.wait_for_selector("[data-testid=share-edit-open]", timeout=10000)
    check("5r 發文者看得到「編輯」與「編輯照片」", pg.locator("[data-testid=share-edit-open]").count() == 1 and pg.locator("[data-testid=photo-edit-open]").count() == 1, "")
    pg.click("[data-testid=share-edit-open]")
    pg.wait_for_selector("[data-testid=share-edit-form]", timeout=10000)
    settle(pg)
    check("5s 編輯表單帶入原本的說明", pg.input_value("#share-form-story") == "管理員修正", pg.input_value("#share-form-story"))
    pg.fill("#share-form-story", f"從畫面改{ST}")
    pg.fill("#share-form-tags", f"畫面標籤{ST}")
    pg.click("[data-testid=share-submit]")
    pg.wait_for_url(re.compile(rf"/share/{N1}$"), timeout=10000)
    pg.wait_for_selector(f"text=從畫面改{ST}", timeout=10000)
    check("5t 存檔後回到單則頁，新說明與標籤立刻看得到", pg.locator(f"text=畫面標籤{ST}").count() >= 1, "")
    pg.screenshot(path=str(IMG / "5_編輯後單則頁.jpg"), type="jpeg", quality=80)
    c.close()
    c = ctx_for(pw, u2)
    pg = c.new_page()
    pg.goto(B + f"/share/{N1}")
    settle(pg)
    check("5u 別人看不到「編輯」", pg.locator("[data-testid=share-edit-open]").count() == 0, "")
    pg.goto(B + f"/share/{N1}/edit")
    settle(pg)
    check("5v 別人直接開編輯頁：只顯示「只有發文者可以編輯這則」", pg.locator("[data-testid=edit-denied]").count() == 1 and pg.locator("[data-testid=share-edit-form]").count() == 0, "")
    c.close()

    # ============================ 8. 設定頁回饋 ============================
    u3 = mkuser("s")
    c = ctx_for(pw, u3)
    pg = c.new_page()
    pg.goto(B + "/settings")
    settle(pg)
    pg.wait_for_selector("[data-testid=name-box] input", timeout=10000)
    new_name = f"新暱稱{ST}"
    pg.fill("#set-name", new_name)
    t0 = time.time()
    pg.click("[data-testid=name-save]")
    pg.wait_for_selector("[data-testid=name-msg]", timeout=3000)
    dt = time.time() - t0
    check("8a 改暱稱後 1 秒內出現「已儲存」（role=status）", dt < 1 and pg.locator("[data-testid=name-msg]").inner_text() == "已儲存"
          and pg.locator("[data-testid=name-msg]").get_attribute("role") == "status", f"{dt:.2f}s")
    check("8b 頁首頭像的暱稱同步更新（不重新載入）", new_name in (pg.locator("[data-testid=me-avatar]").get_attribute("title") or ""), pg.locator("[data-testid=me-avatar]").get_attribute("title"))
    pg.screenshot(path=str(IMG / "8_改暱稱已儲存.jpg"), type="jpeg", quality=80)
    time.sleep(3.3)
    check("8c 「已儲存」約 3 秒後消失", pg.locator("[data-testid=name-msg]").count() == 0, "")
    check("8d 改過之後輸入框鎖住並寫下次可改日期", pg.locator("#set-name").is_disabled() and "以後可以再改" in pg.locator("[data-testid=name-rule]").inner_text(), pg.locator("[data-testid=name-rule]").inner_text())
    c.close()
    u4 = mkuser("t")
    c = ctx_for(pw, u4)
    pg = c.new_page()
    pg.goto(B + "/settings")
    settle(pg)
    pg.wait_for_selector("#set-name", timeout=10000)
    pg.fill("#set-name", new_name)
    pg.click("[data-testid=name-save]")
    pg.wait_for_selector("[data-testid=name-msg-error]", timeout=3000)
    check("8e 暱稱撞名顯示原因", "有人用了" in pg.locator("[data-testid=name-msg-error]").inner_text(), pg.locator("[data-testid=name-msg-error]").inner_text())
    pg.fill("#set-cur", "wrong-password")
    pg.fill("#set-new", "abcdefgh1234")
    pg.click("[data-testid=password-save]")
    pg.wait_for_selector("[data-testid=password-msg-error]", timeout=3000)
    check("8f 改密碼失敗顯示原因", len(pg.locator("[data-testid=password-msg-error]").inner_text()) > 2, pg.locator("[data-testid=password-msg-error]").inner_text())
    pg.screenshot(path=str(IMG / "8_錯誤原因.jpg"), type="jpeg", quality=80)
    c.close()
# 30 天內再改：API 回的原因帶日期
r = requests.patch(B + "/api/me/profile", headers=H(u3), json={"name": f"再改{ST}"})
check("8g 30 天內再改：原因帶下次可改日期", r.status_code == 429 and "以後可以再改" in r.json()["error"]["message"], r.text[:120])

ok = sum(x["ok"] for x in res)
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"passed": ok, "total": len(res), "results": res}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n本機驗收 {ok}/{len(res)}")
