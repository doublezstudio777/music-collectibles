# 藝人照片（維基共享資源匯入＋會員投稿＋後台）：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 前提：本機已跑過 node scripts/import-artist-photos.mjs --local（mc-hotdog 有維基照片）
# 可重跑：每次自己建新會員（帳號名帶時間戳）；替換 mc-hotdog 的照片後，最後會把維基那張設回使用中
import io, json, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests

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
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js"]
LOCAL = ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]
WIKI = "mc-hotdog"


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:400]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(W + ["d1", "execute", "DB", *LOCAL, "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def one(cmd):
    r = sql(cmd)
    return list(r[0].values())[0] if r else None


def r2_exists(key):
    r = subprocess.run(W + ["r2", "object", "get", f"yinzang-photos/{key}", *LOCAL, "--pipe"], cwd=SITE, capture_output=True)
    return r.returncode == 0 and len(r.stdout) > 100


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email, "name": j["user"]["name"]}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
admin = login("admin@demo.yinzang.test")
AH = H(admin)
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")


def mkuser(tag, verified=True):
    h = f"ap{tag}{ST}"
    uid = f"u-{h}"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@ap.test', '{iso(NOW)}', '{PW}', '{h}', '照片{tag}{ST}', '{iso(NOW)}', '{iso(NOW)}')")
    u = login(f"{h}@ap.test")
    if not verified:  # 沒驗證的帳號登不進來：先登入再清掉驗證時間，模擬「登入中但 Email 未驗證」
        sql(f"UPDATE users SET email_verified_at = NULL WHERE id = '{uid}'")
    return u


def img_bytes(w, h, color, fmt="WEBP"):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, fmt, quality=80)
    return b.getvalue()


def submit(u, slug, color=(40, 90, 160), own="1", lic="1", occasion="", date=""):
    return requests.post(B + "/api/artist-photos", headers=H(u),
                         files={"image": ("p.webp", img_bytes(1600, 1200, color), "image/webp"), "thumb": ("t.webp", img_bytes(480, 360, color), "image/webp")},
                         data={"artist": slug, "own": own, "license": lic, "occasion": occasion, "date": date})


def act(pid, action, headers=None, note=""):
    return requests.post(B + "/api/admin/artist-photos", headers=headers or AH, json={"id": pid, "action": action, "note": note})


def page(path, **kw):
    return requests.get(B + path, allow_redirects=False, **kw)


def meta(html, prop):
    m = re.search(rf'<meta (?:property|name)="{re.escape(prop)}" content="([^"]*)"', html)
    return m.group(1) if m else None


def figure(html):
    m = re.search(r'<figure class="artist-photo"[\s\S]*?</figure>', html)
    return re.sub(r"<!-- -->", "", m.group(0)) if m else None


cv = lambda: one("SELECT v FROM content_version WHERE id = 1")
r2b = lambda: one("SELECT value FROM counters WHERE key = 'r2_bytes'")
row = lambda pid: sql(f"SELECT * FROM artist_photos WHERE id = {pid}")[0]
logs = lambda: one("SELECT COUNT(*) FROM admin_log WHERE target LIKE 'artist:%'")

# ============================ 1. 維基匯入的照片出現在藝人頁 ============================
wiki = sql(f"SELECT * FROM artist_photos WHERE artist_slug = '{WIKI}' AND source = 'wiki'")
check("1a mc-hotdog 有一張維基匯入的照片", len(wiki) == 1, len(wiki))
W0 = wiki[0]
if W0["status"] != "active":  # 上一輪沒收尾完：先設回使用中
    act(W0["id"], "activate")
h = page(f"/artist/{WIKI}").text
fig = figure(h)
check("1b 藝人頁上方有照片（在 h1 前面）", fig is not None and h.index('class="artist-photo"') < h.index("<h1"), (fig or "")[:120])
check("1c 照片下方標示攝影者、授權、來源連結（維基共享資源檔案頁）",
      fig and f">{W0['author']}<" in fig and f">{W0['license']}<" in fig and W0["source_url"] in fig and "維基共享資源" in fig, (fig or "")[:400])
check("1d og:image 改用這張藝人照片", (meta(h, "og:image") or "").endswith(f"/img/{W0['r2_key']}"), meta(h, "og:image"))
local = SITE / ".wrangler" / "artist-photos" / f"{WIKI}.jpg"
served = page(f"/img/{W0['r2_key']}").content
check("1e og:image 的檔案就是匯入時縮好的原檔（沒有燒浮水印）", local.exists() and served == local.read_bytes(), f"{len(served)} vs {local.stat().st_size if local.exists() else '-'}")
im = Image.open(io.BytesIO(served))
check("1f 維基照片是長邊 800px 的 JPEG", im.format == "JPEG" and max(im.size) == 800, f"{im.format} {im.size}")
r = page(f"/img/{W0['r2_key']}")
check("1g 使用中的照片訪客不用登入就看得到", r.status_code == 200 and "public" in r.headers.get("cache-control", ""), f"{r.status_code} {r.headers.get('cache-control')}")
no_photo = one("SELECT a.slug FROM artists a WHERE a.slug = 'gordon' AND NOT EXISTS (SELECT 1 FROM artist_photos p WHERE p.artist_slug = a.slug AND p.status = 'active')")
hg = page("/artist/gordon").text
check("1h 沒有照片的藝人頁維持原樣（沒有 figure、header 沒有 has-photo）", no_photo == "gordon" and figure(hg) is None and '<header class="page-head head-split">' in hg, no_photo)

# ============================ 2. 維基授權過濾 ============================
rep = json.loads((SITE / ".wrangler" / "artist-photos" / "import-report-local.json").read_text())
fair = [x for x in rep["清單"]["排除"] if x["原因"] == "合理使用"]
check("2a 匯入報告至少一筆因「合理使用」被排除", len(fair) >= 1, fair[:2])
fs = fair[0]["slug"] if fair else ""
check("2b 被排除的藝人沒有任何藝人照片列", one(f"SELECT COUNT(*) FROM artist_photos WHERE artist_slug = '{fs}'") == 0, fs)
fi = requests.get("https://zh.wikipedia.org/w/api.php", params={"action": "query", "format": "json", "formatversion": "2", "prop": "imageinfo", "iiprop": "extmetadata",
                                                             "titles": f"File:{fair[0]['file']}"}, headers={"User-Agent": "YueMiCang-check/1.0 (doublezstudio777@gmail.com)"}).json()
fp = fi["query"]["pages"][0]
check("2c 那張圖在維基確實是非自由（本地檔案、NonFree）", fp.get("imagerepository") == "local" and str(fp["imageinfo"][0]["extmetadata"].get("NonFree", {}).get("value", "")).lower() == "true",
      f"{fp.get('imagerepository')} {fp['imageinfo'][0]['extmetadata'].get('NonFree')}")
lic = [x["license"] for x in sql("SELECT DISTINCT license FROM artist_photos WHERE source = 'wiki'")]
check("2d 匯入的授權只有 CC0／CC BY／CC BY-SA／公有領域", all(re.fullmatch(r"CC0|公有領域|CC BY(-SA)?( [\d.]+)?", x) for x in lic), lic)
check("2e 匯入的總位元組＝artist_photos 的 bytes 合計", rep["匯入位元組"] == one("SELECT SUM(bytes) FROM artist_photos WHERE source = 'wiki'") or rep["成功匯入"] == 0, rep["匯入位元組"])
rr = subprocess.run(["node", "scripts/import-artist-photos.mjs", "--local", "--dry-run", "--limit", "5"], cwd=SITE, capture_output=True, text=True)
n_wiki = one("SELECT COUNT(*) FROM artist_photos WHERE source = 'wiki'")
check("2f 重跑不重抓：已經有照片的全部跳過", f'"已經有照片跳過": {n_wiki}' in rr.stdout, re.search(r'"已經有照片跳過": \d+', rr.stdout).group(0) if '已經有照片跳過' in rr.stdout else rr.stderr[-200:])

# ============================ 3. 會員投稿 ============================
u1 = mkuser("a")
r = requests.post(B + "/api/artist-photos", files={"image": ("p.webp", img_bytes(100, 100, (1, 2, 3)), "image/webp")}, data={"artist": WIKI})
check("3a 沒登入投稿 401", r.status_code == 401, r.status_code)
r = submit(u1, WIKI, own="0")
check("3b 沒勾「本人拍攝」400", r.status_code == 400 and r.json()["error"]["code"] == "AGREE_REQUIRED", r.text[:100])
r = submit(u1, WIKI, lic="0")
check("3c 沒勾授權 400", r.status_code == 400 and r.json()["error"]["code"] == "AGREE_REQUIRED", r.text[:100])
uv = mkuser("v", verified=False)
r = submit(uv, WIKI)
check("3d Email 沒驗證 403", r.status_code == 403, r.text[:100])
r = submit(u1, "no-such-artist-xyz")
check("3e 不存在的藝人 404", r.status_code == 404, r.status_code)
v0, b0 = cv(), r2b()
r = submit(u1, WIKI, color=(200, 40, 40), occasion="大港開唱", date="2026-03-28")
check("3f 投稿成功 201、狀態 pending", r.status_code == 201 and r.json()["status"] == "pending", r.text[:120])
P1 = r.json()["id"]
p1 = row(P1)
check("3g 存了主圖＋縮圖、拍攝場合、授權 CC BY-SA 4.0", p1["r2_key"].startswith("r/") and p1["thumb_key"] != p1["r2_key"] and p1["occasion"] == "大港開唱" and p1["occasion_date"] == "2026-03-28" and p1["license"] == "CC BY-SA 4.0" and p1["agreed_at"],
      {k: p1[k] for k in ("r2_key", "thumb_key", "occasion", "license")})
check("3h 容量計數加上主圖＋縮圖的位元組", r2b() - b0 == p1["bytes"], f"{r2b() - b0} vs {p1['bytes']}")
check("3i 投稿不讓整頁快取作廢（content_version 不變）", cv() == v0, f"{v0} → {cv()}")
check("3j 投稿不公開：訪客看照片 404", page(f"/img/{p1['r2_key']}").status_code == 404 and page(f"/img/{p1['thumb_key']}").status_code == 404, "")
check("3k 投稿者本人、管理員看得到", page(f"/img/{p1['r2_key']}", headers=H(u1)).status_code == 200 and page(f"/img/{p1['r2_key']}", headers=AH).status_code == 200, "")
u2 = mkuser("b")
check("3l 別的會員看不到待審投稿", page(f"/img/{p1['r2_key']}", headers=H(u2)).status_code == 404, "")
h = page(f"/artist/{WIKI}").text
check("3m 藝人頁仍是維基那張", W0["r2_key"] in (figure(h) or "") and p1["r2_key"] not in h, "")

# 每日上限
codes = [submit(u2, WIKI, color=(10 * i, 100, 100)).status_code for i in range(6)]
check("3n 每人每日 5 張：第 6 張 429", codes == [201] * 5 + [429], codes)
b6 = r2b()
r = submit(u2, WIKI)
check("3o 被上限擋下的那張不佔容量", r.status_code == 429 and r2b() == b6, r.status_code)

# ============================ 4. 權限 ============================
check("4a 非管理員讀後台清單 403", requests.get(B + "/api/admin/artist-photos", headers=H(u1)).status_code == 403, "")
check("4b 非管理員設為使用中 403", act(P1, "activate", headers=H(u1)).status_code == 403, "")
check("4c 非管理員撤下 403", act(W0["id"], "remove", headers=H(u1)).status_code == 403 and row(W0["id"])["status"] == "active", "")
check("4d 沒登入打後台 API 401", requests.get(B + "/api/admin/artist-photos").status_code == 401, "")
lst = requests.get(B + "/api/admin/artist-photos", headers=AH).json()
check("4e 管理員清單有待審投稿（含拍攝場合、投稿者）", any(x["id"] == P1 and x["submitter"]["handle"] == u1["handle"] and x["occasion"] == "大港開唱" for x in lst["pending"]), len(lst["pending"]))
pend = one("SELECT COUNT(*) FROM artist_photos WHERE status = 'pending'")
q = requests.get(B + "/api/admin/stats", headers=AH).json()["queue"]
check("4f 儀表板待處理佇列顯示投稿數", q.get("artistPhotos") == pend, f"{q.get('artistPhotos')} vs {pend}")

# ============================ 5. 設為使用中（取代維基那張）＋分數 ============================
l0, v0 = logs(), cv()
r = act(P1, "activate", note="驗收")
check("5a 設為使用中 200", r.ok and r.json()["status"] == "active", r.text[:120])
check("5b 原本的維基照片改成 retired（檔案保留）", row(W0["id"])["status"] == "retired" and r2_exists(W0["r2_key"]), row(W0["id"])["status"])
check("5c 整頁快取作廢（content_version 加 1 以上）", cv() > v0, f"{v0} → {cv()}")
h = page(f"/artist/{WIKI}").text
fig = figure(h) or ""
check("5d 藝人頁出現投稿照片，標示「攝影：@帳號」與 CC BY-SA 4.0", p1["r2_key"] in fig and f">@{u1['handle']}<" in fig and ">CC BY-SA 4.0<" in fig and "維基共享資源" not in fig, fig[:300])
check("5e og:image 換成投稿照片（沒有燒浮水印，就是原檔）", (meta(h, "og:image") or "").endswith(p1["r2_key"]) and page(f"/img/{p1['r2_key']}").content == page(f"/img/{p1['r2_key']}", headers=H(u1)).content, meta(h, "og:image"))
check("5f 使用中之後訪客看得到", page(f"/img/{p1['r2_key']}").status_code == 200, "")
check("5g 被替換下來的維基照片不公開了", page(f"/img/{W0['r2_key']}").status_code == 404 and page(f"/img/{W0['r2_key']}", headers=AH).status_code == 200, "")
check("5h 寫了操作紀錄", logs() == l0 + 1 and one("SELECT action FROM admin_log ORDER BY id DESC LIMIT 1") == "藝人照片設為使用中", logs() - l0)
requests.post(B + "/api/admin/scores", json={}, headers=AH)
ev = sql(f"SELECT points, state, reason FROM score_events WHERE source = 'aphoto:{P1}'")
check("5i 投稿被設為使用中 +15（比照新增並經核准）", len(ev) == 1 and ev[0]["points"] == 15 and ev[0]["state"] == "credited", ev)
check("5j 已經是使用中的不能再設一次（409）", act(P1, "activate").status_code == 409, "")

# ============================ 6. 退回、刪除 ============================
p2id = sql(f"SELECT id FROM artist_photos WHERE submitter_id = '{u2['id']}' AND status = 'pending' ORDER BY id LIMIT 2")
P2, P3 = p2id[0]["id"], p2id[1]["id"]
p2 = row(P2)
page(f"/img/{p2['r2_key']}", headers=AH)
b0, l0, v0 = r2b(), logs(), cv()
r = act(P2, "reject", note="不是公開演出")
check("6a 退回 200、狀態 rejected", r.ok and row(P2)["status"] == "rejected", r.text[:100])
check("6b 退回後 R2 主圖、縮圖都刪了", not r2_exists(p2["r2_key"]) and not r2_exists(p2["thumb_key"]), "")
check("6c 退回後容量扣回", b0 - r2b() == p2["bytes"], f"{b0 - r2b()} vs {p2['bytes']}")
check("6d 退回後管理員也看不到（404）", page(f"/img/{p2['r2_key']}", headers=AH).status_code == 404, "")
check("6e 退回不讓整頁快取作廢", cv() == v0, f"{v0} → {cv()}")
check("6f 退回寫操作紀錄（含備註）", logs() == l0 + 1 and "不是公開演出" in one("SELECT detail FROM admin_log ORDER BY id DESC LIMIT 1"), "")
p3 = row(P3)
b0 = r2b()
r = act(P3, "delete")
check("6g 刪除待審投稿：狀態 deleted、R2 刪檔、容量扣回", r.ok and row(P3)["status"] == "deleted" and not r2_exists(p3["r2_key"]) and b0 - r2b() == p3["bytes"], r.text[:100])
check("6h 使用中的不能直接刪除（要用撤下）", act(P1, "delete").status_code == 409, "")

# ============================ 7. 撤下（一鍵移除） ============================
first = page(f"/img/{p1['r2_key']}")
second = page(f"/img/{p1['r2_key']}")
b0, l0, v0 = r2b(), logs(), cv()
r = act(P1, "remove", note="經紀公司要求撤下")
check("7a 撤下 200、狀態 removed", r.ok and row(P1)["status"] == "removed", r.text[:120])
check("7b 撤下時清了照片快取（先前已被快取的主圖）", r.json().get("purged", 0) >= 1, r.json())
check("7c 撤下後 R2 主圖、縮圖都刪了", not r2_exists(p1["r2_key"]) and not r2_exists(p1["thumb_key"]), "")
check("7d 撤下後容量扣回", b0 - r2b() == p1["bytes"], f"{b0 - r2b()} vs {p1['bytes']}")
check("7e 撤下後照片網址 404", page(f"/img/{p1['r2_key']}").status_code == 404, "")
h = page(f"/artist/{WIKI}").text
check("7f 撤下後藝人頁沒有照片、整頁快取已換新", figure(h) is None and cv() > v0 and p1["r2_key"] not in h, f"{v0} → {cv()}")
check("7g 撤下寫操作紀錄", logs() == l0 + 1 and one("SELECT action FROM admin_log ORDER BY id DESC LIMIT 1") == "撤下藝人照片", "")
requests.post(B + "/api/admin/scores", json={}, headers=AH)
ev = sql(f"SELECT state, reason FROM score_events WHERE source = 'aphoto:{P1}'")
check("7h 被撤下的投稿分數作廢", ev and ev[0]["state"] == "void" and ev[0]["reason"] == "deleted", ev)

# ============================ 8. 瀏覽器：投稿表單、後台頁 ============================
with sync_playwright() as pw:
    br = pw.chromium.launch()
    c = br.new_context(viewport={"width": 1280, "height": 900})
    p = c.new_page()
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.goto(B + "/artist/gordon", wait_until="networkidle")
    p.get_by_test_id("artist-photo-entry").click()
    p.wait_for_timeout(400)
    check("8a 訪客按投稿入口 → 跳出登入面板", p.get_by_text("登入後才能投稿").count() > 0, "")
    c.close()

    u3 = mkuser("c")
    c = br.new_context(viewport={"width": 1280, "height": 900})
    c.add_cookies([{"name": "yz_session", "value": u3["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    p = c.new_page()
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.goto(B + "/artist/gordon", wait_until="networkidle")
    p.get_by_test_id("artist-photo-entry").click()
    big = io.BytesIO()
    Image.new("RGB", (3000, 2000), (230, 120, 20)).save(big, "JPEG", quality=95)
    p.get_by_test_id("artist-photo-file").set_input_files({"name": "live.jpg", "mimeType": "image/jpeg", "buffer": big.getvalue()})
    p.get_by_test_id("artist-photo-send").click()
    p.wait_for_timeout(300)
    check("8b 沒勾兩項不能送出（提示兩項都要勾）", "兩項都要勾" in (p.get_by_test_id("artist-photo-error").text_content() or ""), "")
    p.get_by_test_id("artist-photo-own").check()
    p.get_by_test_id("artist-photo-license").check()
    p.get_by_test_id("artist-photo-occasion").fill("簡單生活節")
    p.get_by_test_id("artist-photo-date").fill("2025-12-06")
    p.screenshot(path=str(IMG / "投稿表單.jpg"), type="jpeg", quality=80)
    p.get_by_test_id("artist-photo-send").click()
    p.get_by_test_id("artist-photo-done").wait_for(timeout=15000)
    check("8c 瀏覽器投稿送出成功", True, "")
    q3 = sql(f"SELECT * FROM artist_photos WHERE submitter_id = '{u3['id']}'")
    check("8d 瀏覽器端壓縮：主圖長邊 1600、WebP，縮圖另存", len(q3) == 1 and max(q3[0]["width"], q3[0]["height"]) == 1600 and q3[0]["content_type"] == "image/webp" and q3[0]["occasion"] == "簡單生活節",
          {k: q3[0][k] for k in ("width", "height", "content_type", "occasion", "occasion_date")} if q3 else q3)
    c.close()

    c = br.new_context(viewport={"width": 1280, "height": 900})
    c.add_cookies([{"name": "yz_session", "value": admin["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    p = c.new_page()
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.goto(B + "/admin", wait_until="networkidle")
    qa = p.get_by_test_id("queue-artist-photos")
    check("8e 儀表板有「藝人照片投稿」佇列", qa.count() == 1 and int(qa.locator("b").text_content()) == one("SELECT COUNT(*) FROM artist_photos WHERE status = 'pending'"), qa.text_content() if qa.count() else "")
    p.goto(B + "/admin/artist-photos", wait_until="networkidle")
    item = p.locator(f'[data-photo="{q3[0]["id"]}"]')
    check("8f 後台藝人照片頁列出投稿（縮圖看得到）", item.count() == 1 and item.locator("img").evaluate("i => i.naturalWidth") > 0, "")
    p.screenshot(path=str(IMG / "後台藝人照片.jpg"), type="jpeg", quality=80, full_page=False)
    item.get_by_test_id("ap-activate").click()
    p.wait_for_selector(f'[data-photo="{q3[0]["id"]}"][data-status="active"]', timeout=10000)
    check("8g 後台按「設為使用中」生效", row(q3[0]["id"])["status"] == "active", "")
    p.goto(B + "/artist/gordon", wait_until="networkidle")
    p.wait_for_function("() => { const i = document.querySelector('.artist-photo img'); return i && i.complete && i.naturalWidth > 0 }", timeout=10000)
    cap = p.get_by_test_id("artist-photo-credit").text_content()
    check("8h 藝人頁顯示投稿照片與「攝影：@帳號・CC BY-SA 4.0」", f"@{u3['handle']}" in cap and "CC BY-SA 4.0" in cap, cap)
    p.screenshot(path=str(IMG / "藝人頁_投稿照片.jpg"), type="jpeg", quality=80)
    # 收尾：撤下這張，gordon 回到沒有照片（下次重跑 1h 才成立）
    p.once("dialog", lambda d: d.accept())
    p.goto(B + "/admin/artist-photos", wait_until="networkidle")
    p.locator(f'[data-photo="{q3[0]["id"]}"]').get_by_test_id("ap-remove").click()
    p.wait_for_selector(f'[data-photo="{q3[0]["id"]}"][data-status="removed"]', timeout=10000)
    check("8i 後台按「撤下」（確認框）生效", row(q3[0]["id"])["status"] == "removed", "")
    # 把 mc-hotdog 的維基照片設回使用中
    p.locator(f'[data-photo="{W0["id"]}"]').get_by_test_id("ap-activate").click()
    p.wait_for_selector(f'[data-photo="{W0["id"]}"][data-status="active"]', timeout=10000)
    check("8j 被替換下來的維基照片可以再設回使用中", row(W0["id"])["status"] == "active", "")
    c.close()

    for name, vw in (("藝人頁_維基照片_桌機", {"width": 1280, "height": 900}), ("藝人頁_維基照片_手機", {"width": 390, "height": 844})):
        c = br.new_context(viewport=vw)
        p = c.new_page()
        p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        p.goto(B + f"/artist/{WIKI}", wait_until="networkidle")
        p.wait_for_function("() => { const i = document.querySelector('.artist-photo img'); return i && i.complete && i.naturalWidth > 0 }", timeout=10000)
        over = p.evaluate("() => document.documentElement.scrollWidth - innerWidth")
        check(f"8k {name}：照片載入、沒有水平溢出", over <= 0, over)
        p.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80)
        c.close()
    br.close()
check("8l 瀏覽器 console 沒有錯誤", not errs, errs[:3])

# ============================ 9. 使用條款 ============================
t = page("/terms").text
sec = re.search(r'id="artist-photos"[\s\S]*?</ul>', t)
s = re.sub(r"<[^>]+>|<!-- -->", "", sec.group(0)) if sec else ""
check("9a 使用條款有藝人照片一段：本人拍攝、授權、只收公開演出、肖像權與撤下申請", all(k in s for k in ("本人拍攝", "CC BY-SA 4.0", "公開演出", "肖像權", "撤下")), s[:200])
check("9b 使用條款維持草稿標示", 'data-testid="legal-draft"' in t and "草稿" in t, "")

ok = sum(r["ok"] for r in res)
print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps(res, ensure_ascii=False, indent=1))
