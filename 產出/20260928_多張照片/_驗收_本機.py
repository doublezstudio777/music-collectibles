# 炫收藏多張照片：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 本機資料不清空：每次重跑自己建一批新會員（帳號名帶時間戳），只驗這批。
import io, json, re, sqlite3, subprocess, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image, ImageDraw
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
TMP = Path(tempfile.mkdtemp(prefix="yz_multi_"))


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


def r2_objects():
    """本機 R2（Miniflare）所有物件：{key: size}"""
    d = SITE / ".wrangler/state/v3/r2/miniflare-R2BucketObject"
    out = {}
    for f in d.glob("*.sqlite"):
        if f.name == "metadata.sqlite":
            continue
        con = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
        try:
            for k, s in con.execute("SELECT key, size FROM _mf_objects"):
                out[k] = s
        finally:
            con.close()
    return out


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
r2b = lambda: one("SELECT value FROM counters WHERE key = 'r2_bytes'") or 0

admin = login("admin@demo.yinzang.test")
AH = H(admin)
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")
sql("DELETE FROM rate_limits WHERE key LIKE 'register:%'") if one("SELECT name FROM sqlite_master WHERE name = 'rate_limits'") else None


def mkuser(tag):
    h = f"mp{tag}{ST}"
    uid = f"u-{h}"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@mp.test', '{iso(NOW)}', '{PW}', '{h}', '多圖{tag}{ST}', '{iso(NOW)}', '{iso(NOW)}')")
    return login(f"{h}@mp.test")


def img_bytes(w, h, color, fmt="WEBP", text=""):
    im = Image.new("RGB", (w, h), color)
    if text:
        ImageDraw.Draw(im).text((20, 20), text, fill=(255, 255, 255))
    b = io.BytesIO()
    im.save(b, fmt, quality=80)
    return b.getvalue()


def upload(u, color):
    main, thumb = img_bytes(1200, 900, color), img_bytes(480, 360, color)
    return requests.post(B + "/api/uploads", headers=H(u), files={"image": ("p.webp", main, "image/webp"), "thumb": ("t.webp", thumb, "image/webp")}, data={"purpose": "share"})


def og_upload(u, pid, color=(10, 10, 10)):
    return requests.post(B + "/api/uploads/og", headers=H(u), files={"og": ("og.jpg", img_bytes(1200, 630, color, "JPEG"), "image/jpeg")}, data={"photoId": pid})


def photos_of(no):
    return sql(f"SELECT id, r2_key AS a, thumb_key AS b, og_key AS c, bytes, sort, deleted_at AS d FROM photos WHERE share_no = {no} ORDER BY sort")


def consistent(tag):
    objs = r2_objects()
    c = r2b()
    check(f"{tag} R2 容量計數＝實際檔案大小加總", c == sum(objs.values()), f"counter={c} r2={sum(objs.values())} 檔數={len(objs)}")
    return objs


def share_consistent(tag, no):
    objs = r2_objects()
    rows = [r for r in photos_of(no) if not r["d"]]
    miss = [k for r in rows for k in (r["a"], r["b"], r["c"]) if k and k not in objs]
    diff = [(r["id"], r["bytes"], sum(objs.get(k, 0) for k in (r["a"], r["b"], r["c"]) if k)) for r in rows]
    check(f"{tag} 每張 photos.bytes＝R2 上主圖＋縮圖＋預覽圖大小", not miss and all(a == b for _, a, b in diff), f"缺檔 {miss[:3]} 不一致 {[d for d in diff if d[1] != d[2]][:3]}")


ARTIST = one("SELECT name FROM artists WHERE status = 'approved' AND hidden_at IS NULL AND deleted_at IS NULL ORDER BY rowid LIMIT 1")

# ============================ 1. API：發文 10 張、第 11 張被擋 ============================
objs0 = consistent("1a 開始前")
u1 = mkuser("a")
ups = [upload(u1, (20 * i, 100, 200 - 15 * i)) for i in range(11)]
check("1b 上傳 11 張都成功（每張各一個 id）", all(r.status_code == 201 for r in ups), [r.status_code for r in ups])
ids = [r.json()["id"] for r in ups]
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": ids, "about": [ARTIST], "kind": "CD"})
check("1c 11 張發文被擋 400 TOO_MANY_PHOTOS", r.status_code == 400 and r.json()["error"]["code"] == "TOO_MANY_PHOTOS", r.text[:120])
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": [], "about": [ARTIST], "kind": "CD"})
check("1d 0 張發文被擋，訊息「至少放一張照片」", r.status_code == 400 and "至少放一張照片" in r.text, r.text[:120])
og_upload(u1, ids[0])
r = requests.post(B + "/api/shares", headers=H(u1), json={"photoIds": ids[:10], "about": [ARTIST], "kind": "CD"})
check("1e 10 張發文 201", r.status_code == 201, r.text[:120])
N1 = r.json()["n"]
rows = photos_of(N1)
check("1f D1 掛上 10 張，sort 0～9 照送出順序", [x["id"] for x in rows] == ids[:10] and [x["sort"] for x in rows] == list(range(10)), [x["sort"] for x in rows])
check("1g 預覽圖只有封面有", bool(rows[0]["c"]) and not any(x["c"] for x in rows[1:]), [bool(x["c"]) for x in rows])
r = requests.delete(B + f"/api/uploads?id={ids[10]}", headers=H(u1))
check("1h 第 11 張（沒掛上）可以刪，R2 檔一起刪", r.status_code == 200 and not any(k.startswith(f"p/{ids[10]}") for k in r2_objects()), r.status_code)
r = requests.delete(B + f"/api/uploads?id={ids[1]}", headers=H(u1))
check("1i 已掛上收藏的照片不能用這支刪（404）", r.status_code == 404, r.status_code)
consistent("1j 發文後")
share_consistent("1k", N1)

# ============================ 2. 每日 30 張以張數計 ============================
u2 = mkuser("b")
codes = [upload(u2, (5 * i, 5 * i, 90)).status_code for i in range(31)]
check("2a 同一人一天第 1～30 張 201、第 31 張 429", codes[:30] == [201] * 30 and codes[30] == 429, codes[-3:])
r = og_upload(u2, requests.get(B + "/api/me", headers=H(u2)).json() and one(f"SELECT id FROM photos WHERE owner_id = '{u2['id']}' AND deleted_at IS NULL LIMIT 1"))
check("2b 預覽圖不算張數：額度用完仍可替封面補預覽圖", r.status_code == 201, r.status_code)
consistent("2c 30 張後")

# ============================ 3. 照片分級：未登入拿不到任何一張大圖 ============================
u3 = mkuser("c")
page = requests.get(B + f"/share/{N1}").text
check("3a 單則頁 HTML 帶這則的 10 張縮圖", all(x["b"] in page for x in rows), sum(x["b"] in page for x in rows))
anon_main = [requests.get(B + f"/img/{x['a']}").status_code for x in rows]
anon_thumb = [requests.get(B + f"/img/{x['b']}").status_code for x in rows]
check("3b 未登入：10 張主圖全 401", anon_main == [401] * 10, anon_main)
check("3c 未登入：10 張縮圖全 200", anon_thumb == [200] * 10, anon_thumb)
auth_main = [requests.get(B + f"/img/{x['a']}", headers=H(u3)).status_code for x in rows]
check("3d 登入：10 張主圖全 200", auth_main == [200] * 10, auth_main)
ogm = re.search(r'<meta property="og:image" content="([^"]+)"', page)
check("3e og:image 用封面預覽圖", ogm and ogm.group(1).endswith(rows[0]["c"]), ogm.group(1) if ogm else None)
home = requests.get(B + "/").text
check("3f 首頁卡片只用封面縮圖（其他 9 張連網址都不在 HTML）", rows[0]["b"] in home and not any(x["b"] in home for x in rows[1:]), sum(x["b"] in home for x in rows[1:]))

# ============================ 4. API 編輯：補、刪、換封面、排序 ============================
c_before = r2b()
new = upload(u1, (250, 250, 0)).json()["id"]
old = [x["id"] for x in rows]
removed = [rows[3], rows[7]]
order = [old[5], old[0], old[1], old[2], old[4], old[6], old[8], old[9], new]  # 換封面、刪 3 與 7、補 1 張
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u3), json={"photoIds": order})
check("4a 別人不能改照片 403", r.status_code == 403, r.status_code)
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u1), json={"photoIds": order + [old[3], old[7]]})
check("4b 超過 10 張 400", r.status_code == 400, r.text[:100])
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u1), json={"photoIds": ["nope"] + order[1:]})
check("4c 不認識的照片 id 400", r.status_code == 400, r.text[:100])
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u1), json={"photoIds": order})
j = r.json()
check("4d 作者存檔 200，回報封面換了、要補預覽圖", r.status_code == 200 and j["coverChanged"] and j["needOg"] and j["removed"] == 2, j)
rows2 = photos_of(N1)
live = [x for x in rows2 if not x["d"]]
check("4e 新順序寫進 sort", [x["id"] for x in live] == order, [x["id"][:4] for x in live])
objs = r2_objects()
check("4f 刪掉的 2 張 R2 主圖、縮圖都不在了", not any(k in objs for x in removed for k in (x["a"], x["b"])), "")
check("4g 刪掉的照片 /img/ 回 404（登入）", all(requests.get(B + f"/img/{x['a']}", headers=H(u3)).status_code == 404 for x in removed), "")
check("4h 舊封面的預覽圖拿掉了（D1 與 R2）", not any(x["c"] for x in live) and rows[0]["c"] not in objs, [bool(x["c"]) for x in live])
r = og_upload(u1, order[0])
check("4i 替新封面補預覽圖 201", r.status_code == 201, r.text[:100])
page = requests.get(B + f"/share/{N1}").text
ogm = re.search(r'<meta property="og:image" content="([^"]+)"', page)
newc = photos_of(N1)[0]
check("4j og:image 換成新封面的預覽圖", ogm and newc["c"] and ogm.group(1).endswith(newc["c"]), ogm.group(1) if ogm else None)
check("4k 單則頁帶 9 張縮圖、第一張是新封面", all(x["b"] in page for x in live) and page.find(newc["b"]) < page.find(live[1]["b"]), sum(x["b"] in page for x in live))
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u1), json={"photoIds": [order[0], order[2], order[1]] + order[3:]})
check("4l 只調順序、封面沒換：不重畫預覽圖、預覽圖保留", r.status_code == 200 and not r.json()["coverChanged"] and not r.json()["needOg"] and photos_of(N1)[0]["c"] == newc["c"], r.text[:120])
consistent("4m 編輯後")
share_consistent("4n", N1)

# ============================ 5. 隱藏：每一張都 404 ============================
allkeys = [k for x in photos_of(N1) if not x["d"] for k in (x["a"], x["b"], x["c"]) if k]
for k in allkeys:
    requests.get(B + f"/img/{k}", headers=H(u3))  # 先讓快取有東西
r = requests.post(B + "/api/admin/hide", headers=AH, json={"type": "share", "key": f"share/{N1}", "hidden": True})
check("5a 管理員隱藏 200，清掉快取的檔數 > 0", r.status_code == 200 and r.json().get("purgedPhotos", 0) > 0, r.text[:120])
codes = [requests.get(B + f"/img/{k}", headers=H(u3)).status_code for k in allkeys]
check(f"5b 隱藏後 {len(allkeys)} 個檔（主圖／縮圖／預覽圖）全 404", codes == [404] * len(allkeys), codes)
codes = [requests.get(B + f"/img/{k}").status_code for k in allkeys]
check("5c 未登入也全 404", codes == [404] * len(allkeys), codes)
r = requests.put(B + f"/api/shares/{N1}/photos", headers=H(u1), json={"photoIds": order})
check("5d 隱藏的收藏不能編輯照片 404", r.status_code == 404, r.status_code)

# ============================ 6. 畫面（Playwright） ============================
files = []
for i in range(12):
    p = TMP / f"photo_{i + 1:02d}.jpg"
    Image.new("RGB", (2400, 1800), ((i * 37) % 255, (i * 91) % 255, (i * 53) % 255)).save(p, "JPEG", quality=85)
    files.append(str(p))

u4 = mkuser("d")


def ctx_for(br, u=None, **kw):
    c = br.new_context(**kw)
    if u:
        c.add_cookies([{"name": "yz_session", "value": u["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    return c


def settle(pg):
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")


def tile_ids(pg):
    return pg.eval_on_selector_all("[data-testid=pp-tile]", "els => els.map(e => e.dataset.id)")


def shot(pg, name):
    pg.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=False)


errors = []
with sync_playwright() as p:
    br = p.chromium.launch()
    c = ctx_for(br, u4, viewport={"width": 1280, "height": 900})
    pg = c.new_page()
    # 故意斷線的那一次上傳會記一筆 ERR_FAILED，不算
    pg.on("console", lambda m: m.type == "error" and "ERR_FAILED" not in m.text and errors.append(m.text))
    # 第 3 個上傳請求故意斷線，驗單張重試
    posts = {"n": 0}

    def flaky(route):
        if route.request.method == "POST":
            posts["n"] += 1
            if posts["n"] == 3:
                return route.abort()
        return route.continue_()

    pg.route("**/api/uploads", flaky)
    pg.goto(B + "/share/new")
    settle(pg)
    pg.set_input_files("[data-testid=pp-input]", files[:8])
    pg.wait_for_function("document.querySelectorAll('[data-testid=pp-tile][data-status=queued],[data-testid=pp-tile][data-status=uploading]').length === 0", timeout=60000)
    st = pg.eval_on_selector_all("[data-testid=pp-tile]", "els => els.map(e => e.dataset.status)")
    check("6a 一次選 8 張：7 張完成、斷線那 1 張顯示失敗", st.count("done") == 7 and st.count("error") == 1, st)
    shot(pg, "6a_一張失敗")
    pg.click("[data-testid=pp-tile][data-status=error] [data-testid=pp-retry]")
    pg.wait_for_function("document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 8", timeout=30000)
    check("6b 失敗那張按重試就成功，其他張沒重傳", posts["n"] == 9, f"POST 次數 {posts['n']}")
    pg.set_input_files("[data-testid=pp-input]", files[8:11])
    pg.wait_for_function("document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 10", timeout=60000)
    note = pg.inner_text("[data-testid=pp-progress]")
    check("6c 分次再加 3 張：只收到 10 張，第 11 張被擋並說明", pg.locator("[data-testid=pp-tile]").count() == 10 and "1 張沒加進來" in note, note)
    check("6d 滿 10 張後選檔按鈕收起來", pg.locator("[data-testid=pp-input]").count() == 0 and pg.locator("[data-testid=pp-full]").count() == 1, "")
    before = tile_ids(pg)
    # 滑鼠拖曳：第 4 張拖到第 1 格
    a = pg.locator("[data-testid=pp-tile]").nth(3).bounding_box()
    b = pg.locator("[data-testid=pp-tile]").nth(0).bounding_box()
    pg.mouse.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 3)
    pg.mouse.down()
    pg.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 3, steps=12)
    shot(pg, "6e_拖曳中")
    pg.mouse.up()
    after = tile_ids(pg)
    badge = pg.eval_on_selector("[data-testid=pp-cover-badge]", "e => e.closest('[data-testid=pp-tile]').dataset.id")
    check("6e 滑鼠拖第 4 張到第 1 格，順序變了、封面標在它身上", after[0] == before[3] and badge == before[3] and sorted(after) == sorted(before), f"{before[:4]} → {after[:4]}")
    # 按鈕：第 2 張往前＝變封面；第 1 張往後
    pg.locator("[data-testid=pp-tile]").nth(1).locator("[data-testid=pp-left]").click()
    a2 = tile_ids(pg)
    check("6f 上移按鈕：第 2 張往前變封面", a2[0] == after[1] and a2[1] == after[0], "")
    pg.locator("[data-testid=pp-tile]").nth(5).locator("[data-testid=pp-cover]").click()
    a3 = tile_ids(pg)
    check("6g 設為封面按鈕", a3[0] == a2[5], "")
    gone = a3[9]
    pg.locator("[data-testid=pp-tile]").nth(9).locator("[data-testid=pp-remove]").click()
    time.sleep(1)
    check("6h 刪掉單張：剩 9 張，那張的 R2 檔一起刪", pg.locator("[data-testid=pp-tile]").count() == 9 and not any(k.startswith(f"p/{gone}") for k in r2_objects()), gone)
    final = tile_ids(pg)
    pg.locator("[data-testid=pick-artist] button").first.click()
    pg.locator("[data-testid=pick-kind] button").first.click()
    pg.click("form button[type=submit]")
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
    N2 = int(pg.url.rsplit("/", 1)[1])
    rows = photos_of(N2)
    check("6i 送出後 D1 順序＝畫面順序，封面正確", [x["id"] for x in rows] == final, "")
    check("6j 預覽圖只替封面畫（1200×630 JPEG）", bool(rows[0]["c"]) and not any(x["c"] for x in rows[1:]), "")
    if rows[0]["c"]:
        ogb = requests.get(B + f"/img/{rows[0]['c']}").content
        im = Image.open(io.BytesIO(ogb))
        check("6k 預覽圖 1200×630 JPEG", im.size == (1200, 630) and im.format == "JPEG", (im.size, im.format))
    mains = [Image.open(io.BytesIO(requests.get(B + f"/img/{x['a']}", headers=H(u4)).content)).size for x in rows]
    tms = [Image.open(io.BytesIO(requests.get(B + f"/img/{x['b']}").content)).size for x in rows]
    check("6l 每張都在瀏覽器壓縮：主圖長邊 1600、縮圖長邊 480", all(max(s) == 1600 for s in mains) and all(max(s) == 480 for s in tms), (mains[:2], tms[:2]))
    share_consistent("6m", N2)
    consistent("6n UI 發文後")
    settle(pg)
    check("6o 單則頁：大圖區 9 張、縮圖列 9 張", pg.locator(".gallery-slide").count() == 9 and pg.locator("[data-testid=gallery-strip] button").count() == 9, "")
    pg.locator("[data-testid=gallery-strip] button").nth(4).click()
    pg.wait_for_function("document.querySelector('[data-testid=gallery]').dataset.current === '4'")
    time.sleep(0.6)
    shot(pg, "6p_單則頁_第5張")
    vis = pg.evaluate("(() => { const t = document.querySelector('[data-testid=gallery-track]'); return Math.round(t.scrollLeft / t.clientWidth) })()")
    check("6p 點縮圖列第 5 張，大圖區切到第 5 張", vis == 4, vis)
    pg.locator(".gallery-slide").nth(4).locator("[data-testid=photo-open]").click()
    pg.wait_for_selector("[data-testid=lightbox-img]")
    src1 = pg.get_attribute("[data-testid=lightbox-img]", "data-src")
    pg.click("[data-testid=lightbox-next]")
    pg.wait_for_function(f"(document.querySelector('[data-testid=lightbox-img]')||{{}}).dataset?.src && document.querySelector('[data-testid=lightbox-img]').dataset.src !== '{src1}'")
    src2 = pg.get_attribute("[data-testid=lightbox-img]", "data-src")
    check("6q 登入：大圖檢視器開 1600px 主圖，下一張切到第 6 張", src1 == f"/img/{rows[4]['a']}" and src2 == f"/img/{rows[5]['a']}", (src1, src2))
    shot(pg, "6q_大圖檢視器")
    pg.keyboard.press("Escape")

    # 編輯（畫面）：補 1 張、刪 1 張、換封面
    pg.click("[data-testid=photo-edit-open]")
    pg.wait_for_selector("[data-testid=photo-edit] [data-testid=pp-tile]")
    pg.set_input_files("[data-testid=photo-edit] [data-testid=pp-input]", files[11:12])
    pg.wait_for_function("document.querySelectorAll('[data-testid=photo-edit] [data-testid=pp-tile][data-status=done]').length === 10", timeout=30000)
    ed = tile_ids(pg)
    pg.locator("[data-testid=pp-tile]").nth(2).locator("[data-testid=pp-remove]").click()
    pg.locator("[data-testid=pp-tile]").nth(8).locator("[data-testid=pp-cover]").click()  # 剛補的那張當封面
    want = tile_ids(pg)
    shot(pg, "6r_編輯照片")
    old_og = rows[0]["c"]
    pg.click("[data-testid=pe-save]")
    pg.wait_for_selector("[data-testid=photo-edit]", state="detached", timeout=30000)
    time.sleep(1.5)
    rows3 = [x for x in photos_of(N2) if not x["d"]]
    check("6r 畫面編輯存檔：補 1 刪 1 換封面，D1 順序＝畫面", [x["id"] for x in rows3] == want and want[0] == ed[9] and ed[2] not in want, "")
    check("6s 換封面：新封面有預覽圖、舊封面預覽圖從 R2 刪掉", bool(rows3[0]["c"]) and old_og not in r2_objects() and not any(x["c"] for x in rows3[1:]), "")
    check("6t 刪掉那張的主圖 404", requests.get(B + f"/img/{[x for x in rows if x['id'] == ed[2]][0]['a']}", headers=H(u4)).status_code == 404, "")
    pg.reload()
    settle(pg)
    first_thumb = pg.eval_on_selector(".gallery-slide img", "e => e.getAttribute('src')")
    check("6u 重新整理後單則頁封面＝新封面", first_thumb == f"/img/{rows3[0]['b']}", first_thumb)
    share_consistent("6v", N2)
    consistent("6w 畫面編輯後")

    # 未登入：只拿得到縮圖
    ca = ctx_for(br, None, viewport={"width": 1280, "height": 900})
    pa = ca.new_page()
    got = []
    pa.on("response", lambda r: "/img/" in r.url and got.append((r.url.split("/img/")[1], r.status)))
    pa.goto(B + f"/share/{N2}")
    settle(pa)
    pa.locator(".gallery-slide").first.locator("[data-testid=photo-open]").click()
    time.sleep(0.8)
    check("6x 未登入點照片跳登入框、沒有開大圖", pa.locator("[data-testid=auth-panel]").count() == 1 and pa.locator("[data-testid=lightbox]").count() == 0, "")
    check("6y 未登入整頁只載入縮圖，沒有任何主圖請求成功", got and all(k.split("?")[0].endswith("_t.webp") or s != 200 for k, s in got), got[:4])
    ca.close()

    # 手機 390：滑動單則頁、長按拖曳排序、不溢出
    cm = ctx_for(br, u4, viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pm = cm.new_page()
    pm.goto(B + f"/share/{N2}")
    settle(pm)
    cdp = cm.new_cdp_session(pm)
    box = pm.locator("[data-testid=gallery-track]").bounding_box()
    y = box["y"] + box["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": box["x"] + 300, "y": y}]})
    for i in range(1, 11):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": box["x"] + 300 - 22 * i, "y": y}]})
        time.sleep(0.016)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    pm.wait_for_function("document.querySelector('[data-testid=gallery]').dataset.current === '1'", timeout=5000)
    check("6z 手機手指左滑，換到第 2 張", pm.get_attribute("[data-testid=gallery]", "data-current") == "1", "")
    shot(pm, "6z_手機_單則頁第2張")
    ow = pm.evaluate("document.documentElement.scrollWidth")
    check("6za 手機單則頁不水平溢出", ow <= 390, ow)
    pm.click("[data-testid=photo-edit-open]")
    pm.wait_for_selector("[data-testid=photo-edit] [data-testid=pp-tile]")
    pm.locator("[data-testid=photo-edit]").scroll_into_view_if_needed()
    time.sleep(0.4)
    m0 = tile_ids(pm)
    a = pm.locator("[data-testid=pp-tile]").nth(4).bounding_box()
    b = pm.locator("[data-testid=pp-tile]").nth(0).bounding_box()
    ax, ay = a["x"] + a["width"] / 2, a["y"] + a["height"] / 3
    bx, by = b["x"] + b["width"] / 2, b["y"] + b["height"] / 3
    sy0 = pm.evaluate("scrollY")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": ax, "y": ay}]})
    time.sleep(0.6)  # 長按
    for i in range(1, 16):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": ax + (bx - ax) * i / 15, "y": ay + (by - ay) * i / 15}]})
        time.sleep(0.02)
    shot(pm, "6zb_手機_長按拖曳中")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    time.sleep(0.3)
    m1 = tile_ids(pm)
    badge = pm.eval_on_selector("[data-testid=pp-cover-badge]", "e => e.closest('[data-testid=pp-tile]').dataset.id")
    check("6zb 手機長按拖曳：第 5 張拖到第 1 格變封面，頁面沒跟著捲", m1[0] == m0[4] and badge == m0[4] and pm.evaluate("scrollY") == sy0, f"{m0[:5]} → {m1[:5]}")
    # 沒長按直接滑＝捲動頁面，不會換位置
    a = pm.locator("[data-testid=pp-tile]").nth(3).bounding_box()
    cx, cy = a["x"] + a["width"] / 2, a["y"] + a["height"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy}]})
    for i in range(1, 8):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx, "y": cy - 20 * i}]})
        time.sleep(0.016)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    time.sleep(0.3)
    check("6zc 手機沒長按直接滑：順序不變（當成捲動）", tile_ids(pm) == m1, "")
    pm.locator("[data-testid=pp-tile]").nth(1).locator("[data-testid=pp-right]").tap()
    m2 = tile_ids(pm)
    check("6zd 手機下移按鈕可以點", m2[2] == m1[1], "")
    pm.locator("[data-testid=photo-edit]").scroll_into_view_if_needed()
    shot(pm, "6zd_手機_編輯照片")
    ow = pm.evaluate("document.documentElement.scrollWidth")
    tb = pm.locator("[data-testid=pp-tile]").first.locator("[data-testid=pp-bar] button, .pp-bar button").first.bounding_box()
    check("6ze 手機編輯區不溢出、按鈕高度 ≥ 32px", ow <= 390 and tb["height"] >= 32, (ow, tb["height"]))
    pm.click("[data-testid=pe-save]")
    pm.wait_for_selector("[data-testid=photo-edit]", state="detached", timeout=30000)
    time.sleep(1)
    check("6zf 手機存檔後 D1 順序＝畫面", [x["id"] for x in photos_of(N2) if not x["d"]] == m2, "")
    # 手機發文表單
    pm.goto(B + "/share/new")
    settle(pm)
    pm.set_input_files("[data-testid=pp-input]", files[:4])
    pm.wait_for_function("document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 4", timeout=60000)
    shot(pm, "6zg_手機_發文表單")
    ow = pm.evaluate("document.documentElement.scrollWidth")
    check("6zg 手機發文表單 4 張不溢出", ow <= 390, ow)
    for t in pm.eval_on_selector_all("[data-testid=pp-tile]", "els => els.map(e => e.dataset.id)"):
        requests.delete(B + f"/api/uploads?id={t}", headers=H(u4))
    cm.close()
    c.close()
    br.close()

check("7a 瀏覽器 console error 0", not errors, errors[:3])
consistent("7b 全部結束")

ok = sum(1 for r in res if r["ok"])
print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"at": iso(datetime.now(timezone.utc)), "pass": ok, "total": len(res), "results": res}, ensure_ascii=False, indent=1), encoding="utf-8")
sys.exit(0 if ok == len(res) else 1)
