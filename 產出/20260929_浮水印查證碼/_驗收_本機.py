"""浮水印查證碼：本機驗收（build 版 8791）。用法：python3 _驗收_本機.py
會建一個測試會員 vc{時間}（SQL 直接建，密碼借 admin）、發兩則收藏（第一則兩張照片走網頁表單，第二則 API），
驗查證碼發號、上傳、單則頁顯示、/verify 各種情況、限流。資料留在本機，不清。"""
import json, re, subprocess, sys, time, datetime
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

B = "http://127.0.0.1:8791"
SITE = "/home/dz/AboutAI/專案/music-collectibles/網站"
PHOTOS = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad/wm"
IMG = Path(__file__).parent / "img" / "本機"
IMG.mkdir(parents=True, exist_ok=True)
STAMP = str(int(time.time()))[-6:]
CODE_RE = re.compile(r"^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$")
res = []


def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def check(n, ok, d=""):
    res.append((n, ok))
    print(("PASS " if ok else "FAIL ") + n, str(d)[:300])


def iso():
    dt = datetime.datetime.now(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


PW = sql("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")[0]["password_hash"]


def mkuser(tag):
    uid, handle, email = f"u-{tag}{STAMP}", f"{tag}{STAMP}", f"{tag}{STAMP}@vctest.test"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES ('{uid}', '{email}', '{iso()}', '{PW}', '{handle}', '查證{tag}{STAMP}', '{iso()}', '{iso()}')")
    sql("DELETE FROM rate_limits WHERE key LIKE 'register:%' OR key LIKE 'login:%'")
    tok = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]
    return uid, handle, tok


uid, handle, tok = mkuser("vc")
uid2, handle2, tok2 = mkuser("vd")
H = {"Authorization": f"Bearer {tok}", "x-yz-test-country": "TW"}
H2 = {"Authorization": f"Bearer {tok2}", "x-yz-test-country": "TW"}
tiny = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc9000b080001000101011100ffcc000601001101ffda0008010100003f00d2cf20ffd9")
F = lambda: {"image": ("p.jpg", tiny, "image/jpeg"), "thumb": ("t.jpg", tiny, "image/jpeg"), "orig": ("o.jpg", tiny, "image/jpeg")}

# ---------- A. 發號與上傳 API ----------
r = requests.post(B + "/api/uploads", headers=H, files=F(), data={"purpose": "share"})
check("A1 沒帶查證碼的收藏照片上傳被擋 400 RELOAD", r.status_code == 400 and "RELOAD" in r.text, r.status_code)
c1 = requests.post(B + "/api/uploads/code", headers=H)
code1 = c1.json().get("code", "")
check("A2 發號 201、5 碼、不含 0 O 1 I L", c1.status_code == 201 and bool(CODE_RE.match(code1)), c1.text)
r = requests.post(B + "/api/uploads", headers=H2, files=F(), data={"purpose": "share", "code": code1})
check("A3 別人的查證碼不能用 409", r.status_code == 409, r.status_code)
r = requests.post(B + "/api/uploads", headers=H, files=F(), data={"purpose": "share", "code": code1})
check("A4 自己的碼上傳成功，回傳同一組碼", r.status_code == 201 and r.json().get("code") == code1, r.text[:200])
tiny_pid = r.json()["id"]
r = requests.post(B + "/api/uploads", headers=H, files=F(), data={"purpose": "share", "code": code1})
check("A5 同一組碼第二次用 409", r.status_code == 409, r.status_code)
row = sql(f"SELECT verify_code FROM photos WHERE id = '{tiny_pid}'")[0]
pc = sql(f"SELECT owner_id, photo_id FROM photo_codes WHERE code = '{code1}'")[0]
check("A6 D1 photos.verify_code 與 photo_codes 對得上", row["verify_code"] == code1 and pc["photo_id"] == tiny_pid and pc["owner_id"] == uid, (row, pc))
r = requests.post(B + "/api/uploads", headers=H, files=F(), data={"purpose": "share", "code": "ABCDE"})
check("A7 沒發過的碼 409", r.status_code == 409, r.status_code)
requests.delete(B + f"/api/uploads?id={tiny_pid}", headers=H)
codes = [requests.post(B + "/api/uploads/code", headers=H).json()["code"] for _ in range(20)]
check("A8 連發 20 組都不重複、都符合格式", len(set(codes)) == 20 and all(CODE_RE.match(c) for c in codes), codes[:5])

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    def ctx(w, h, token=tok, mobile=False):
        c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        if token:
            c.add_cookies([{"name": "yz_session", "value": token, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        # 測試表頭只加在本站請求上（加到 Google Fonts 會被 CORS 擋，字型載不到）
        c.route(re.compile(r"^http://127\.0\.0\.1:8791/"), lambda route: route.continue_(headers={**route.request.headers, "x-yz-test-country": "TW"}))
        p = c.new_page()
        p.on("console", lambda m, u=w: m.type == "error" and errs.append(f"{u}: {m.text[:200]}"))
        return c, p

    # ---------- B. 網頁表單發一則兩張照片的收藏 ----------
    c, pg = ctx(1440, 900)
    pg.goto(B + "/share/new", wait_until="networkidle")
    ups = []
    pg.on("response", lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST" and ups.append(x))
    pg.locator("input[type=file]").first.set_input_files([f"{PHOTOS}/record.jpg", f"{PHOTOS}/record_p.jpg"])
    pg.wait_for_function("() => document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 2", timeout=90000)
    bodies = [u.json() for u in ups]
    check("B1 兩張都上傳成功、各帶一組碼", len(bodies) == 2 and all(CODE_RE.match(b.get("code", "")) for b in bodies) and bodies[0]["code"] != bodies[1]["code"], bodies)
    pg.locator("[data-testid=artist-search]").fill("山線")
    pg.locator("[data-testid=artist-opt]", has_text="山線電台").first.click()
    pg.locator("[data-testid=pick-kind] button:text-is('CD')").click()
    pg.locator("[data-testid=where-search]").fill("夜行採集")
    pg.locator("[data-testid=where-opt]", has_text="夜行採集").first.click()
    if pg.locator("[data-testid=pick-item] button").count():
        pg.locator("[data-testid=pick-item] button").first.click()
    if pg.locator("[data-testid=bar-version-change]").count():
        pg.locator("[data-testid=bar-version-change]").click()
    pg.locator("[data-testid=pick-version] button").first.click()
    pg.locator("#share-form-story").fill(f"驗收 {STAMP}：浮水印查證碼")
    pg.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    pg.locator("[data-testid=share-submit]").click()
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
    N = int(pg.url.rsplit("/", 1)[1])
    c.close()
    rows = sql(f"SELECT id, r2_key, thumb_key, og_key, verify_code, sort FROM photos WHERE share_no = {N} ORDER BY sort")
    by_id = {b["id"]: b["code"] for b in bodies}
    check("B2 D1 兩張照片的 verify_code 跟上傳回傳的相同", len(rows) == 2 and all(by_id.get(r["id"]) == r["verify_code"] for r in rows), rows)
    cover = rows[0]
    CODE = cover["verify_code"]
    check("B3 封面有分享預覽圖", bool(cover["og_key"]), cover["og_key"])

    # 公開網址直接開（不登入）：縮圖、預覽圖；主圖要登入
    c, pg = ctx(1000, 800, token=None)
    for key, name in [(cover["thumb_key"], "直接開縮圖網址_沒登入"), (cover["og_key"], "直接開預覽圖網址_沒登入")]:
        resp = pg.goto(f"{B}/img/{key}")
        check(f"B4 {name} 200", resp.status == 200, resp.status)
        pg.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80)
    c.close()
    c, pg = ctx(1700, 1700)
    resp = pg.goto(f"{B}/img/{cover['r2_key']}")
    check("B4 主圖（登入）200", resp.status == 200, resp.status)
    pg.screenshot(path=str(IMG / "直接開主圖網址_登入.jpg"), type="jpeg", quality=80)
    c.close()

    # ---------- C. 單則頁照片下方的查證碼 ----------
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = ctx(w, h, token=None, mobile=mob)
        pg.goto(f"{B}/share/{N}", wait_until="networkidle")
        t = pg.locator("[data-testid=photo-code]").inner_text()
        check(f"C1 單則頁 {w} 照片下方顯示封面查證碼", t.replace(" ", "") == f"查證碼#{CODE}", t)
        href = pg.locator("[data-testid=photo-code] a").get_attribute("href")
        check(f"C2 單則頁 {w} 查證碼連到 /verify?c=", href == f"/verify?c={CODE}", href)
        ov = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"C3 單則頁 {w} 無水平溢出", ov <= 0, ov)
        if w == 1440:
            pg.locator("[data-testid=gallery-strip] li button").nth(1).click()
            pg.wait_for_function(f"() => document.querySelector('[data-testid=photo-code]').textContent.includes('{rows[1]['verify_code']}')", timeout=5000)
            check("C4 切到第 2 張，查證碼換成第 2 張的", True)
            pg.locator("[data-testid=gallery-strip] li button").nth(0).click()
            pg.wait_for_timeout(600)
        foot = pg.locator("footer a", has_text="照片查證")
        check(f"C5 頁尾有「照片查證」 {w}", foot.count() == 1 and foot.get_attribute("href") == "/verify")
        pg.locator("[data-testid=photo-code]").scroll_into_view_if_needed()
        pg.screenshot(path=str(IMG / f"單則頁_{w}.jpg"), type="jpeg", quality=80, full_page=False)
        c.close()

    # ---------- D. /verify ----------
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")

    def vpage(w, h, mob, url, shot=None):
        c, pg = ctx(w, h, token=None, mobile=mob)
        pg.goto(B + url, wait_until="networkidle")
        if shot:
            pg.screenshot(path=str(IMG / f"{shot}.jpg"), type="jpeg", quality=80, full_page=True)
        return c, pg

    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = vpage(w, h, mob, f"/verify?c={CODE}", f"verify_查到_{w}")
        found = pg.locator("[data-testid=verify-found]")
        check(f"D1 /verify?c= {w} 查到", found.count() == 1)
        check(f"D2 {w} 收藏連結正確", pg.locator("[data-testid=verify-share]").get_attribute("href") == f"/share/{N}")
        check(f"D3 {w} 發文者連個人頁、顯示 @帳號", pg.locator("[data-testid=verify-author]").get_attribute("href") == f"/u/{handle}" and f"@{handle}" in pg.locator("[data-testid=verify-author]").inner_text())
        txt = found.inner_text()
        check(f"D4 {w} 有查證碼與發布日期", f"#{CODE}" in txt and re.search(r"\d{4}/\d{2}/\d{2}", txt) is not None, txt)
        ov = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        cut = pg.evaluate("() => [...document.querySelectorAll('.verify-card *, .verify-form *')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible').length")
        check(f"D5 {w} 無水平溢出、無截斷", ov <= 0 and cut == 0, (ov, cut))
        c.close()
    # 輸入框：小寫、前面帶 # 也查得到
    c, pg = vpage(1440, 900, False, "/verify", "verify_空白_1440")
    pg.locator("[data-testid=verify-input]").fill(f"#{CODE.lower()}")
    pg.locator("[data-testid=verify-submit]").click()
    pg.wait_for_load_state("networkidle")
    check("D6 輸入框打小寫加 # 也查得到", pg.locator("[data-testid=verify-found]").count() == 1, pg.url)
    c.close()
    # 查無
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = vpage(w, h, mob, "/verify?c=ZZZZZ", f"verify_查無_{w}")
        check(f"D7 查無 {w}", pg.locator("[data-testid=verify-none]").inner_text() == "查無此查證碼")
        c.close()
    c, pg = vpage(1440, 900, False, "/verify?c=hello")
    check("D8 格式不對也只顯示查無", pg.locator("[data-testid=verify-none]").inner_text() == "查無此查證碼")
    c.close()
    # 已隱藏
    sql(f"UPDATE shares SET hidden_at = '{iso()}' WHERE no = {N}")
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = vpage(w, h, mob, f"/verify?c={CODE}", f"verify_已下架_{w}")
        t = pg.locator("[data-testid=verify-gone]").inner_text() if pg.locator("[data-testid=verify-gone]").count() else ""
        check(f"D9 收藏隱藏 {w}：只說會員與已下架", t == f"這張照片來自樂迷藏會員 @{handle}，收藏已下架" and pg.locator("[data-testid=verify-found]").count() == 0, t)
        c.close()
    sql(f"UPDATE shares SET hidden_at = NULL WHERE no = {N}")
    c, pg = vpage(1440, 900, False, f"/verify?c={CODE}")
    check("D10 取消隱藏後又查得到", pg.locator("[data-testid=verify-found]").count() == 1)
    c.close()
    # 刪掉的照片（同一則的第 2 張）：照片已下架
    code2 = rows[1]["verify_code"]
    sql(f"UPDATE photos SET deleted_at = '{iso()}' WHERE id = '{rows[1]['id']}'")
    c, pg = vpage(1440, 900, False, f"/verify?c={code2}")
    t = pg.locator("[data-testid=verify-gone]").inner_text() if pg.locator("[data-testid=verify-gone]").count() else ""
    check("D11 照片被刪：只說會員與照片已下架", t == f"這張照片來自樂迷藏會員 @{handle}，照片已下架", t)
    c.close()
    sql(f"UPDATE photos SET deleted_at = NULL WHERE id = '{rows[1]['id']}'")

    # 第二位會員發一則（API），再模擬刪帳號
    cc = requests.post(B + "/api/uploads/code", headers=H2).json()["code"]
    up = requests.post(B + "/api/uploads", headers=H2, files=F(), data={"purpose": "share", "code": cc}).json()
    sr = requests.post(B + "/api/shares", headers=H2, json={"photoIds": [up["id"]], "about": ["山線電台"], "story": "", "tags": [], "sale": {"state": "share"}, "kind": "CD"})
    N2 = sr.json().get("n")
    check("D12 第二位會員發文成功", bool(N2), sr.text[:200])
    sql(f"UPDATE users SET status = 'deleted', handle = 'del-vc{STAMP}x', name = '已刪除的會員' WHERE id = '{uid2}'")
    c, pg = vpage(1440, 900, False, f"/verify?c={cc}", "verify_已刪會員_收藏還在_1440")
    txt = pg.locator("[data-testid=verify-found]").inner_text() if pg.locator("[data-testid=verify-found]").count() else ""
    check("D13 發文者刪帳、收藏還在：發文者顯示已刪除的會員、沒有個人頁連結", "已刪除的會員" in txt and pg.locator("[data-testid=verify-author]").count() == 0 and "del-" not in txt, txt)
    c.close()
    sql(f"UPDATE shares SET hidden_at = '{iso()}' WHERE no = {N2}")
    c, pg = vpage(1440, 900, False, f"/verify?c={cc}", "verify_已刪會員_已下架_1440")
    t = pg.locator("[data-testid=verify-gone]").inner_text() if pg.locator("[data-testid=verify-gone]").count() else ""
    check("D14 發文者刪帳、收藏下架：這張照片來自已刪除的會員，收藏已下架", t == "這張照片來自已刪除的會員，收藏已下架", t)
    c.close()

    # 限流
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")
    codes_seen = []
    for i in range(30):
        r = requests.get(f"{B}/verify?c=ZZZZ{'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[i]}")
        codes_seen.append(r.status_code)
    r = requests.get(f"{B}/verify?c={CODE}")
    check("D15 同一 IP 查 30 次後第 31 次被擋（連真的碼也不回結果）", "查詢次數太多，一小時後再查" in r.text and "verify-found" not in r.text, codes_seen[-3:])
    c, pg = vpage(390, 844, True, f"/verify?c={CODE}", "verify_限流_390")
    check("D16 限流畫面", pg.locator("[data-testid=verify-limited]").count() == 1)
    c.close()
    r = requests.get(f"{B}/verify")
    check("D17 沒帶碼開頁面不算次數、照常顯示表單", "verify-form" in r.text and "查詢次數太多" not in r.text)
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")

    # ---------- E. 使用條款、robots ----------
    c, pg = vpage(1440, 900, False, "/terms")
    body = pg.locator("main").inner_text()
    check("E1 條款有分享照片段落", "分享時須保留照片上的浮水印" in body and "不得移除、裁掉、遮蓋或修改照片上的浮水印" in body and "不得拿別人的照片冒充自己的物品販售或交易" in body)
    check("E2 條款與查證頁沒有「禁止」", "禁止" not in body)
    pg.locator("#share-photos").scroll_into_view_if_needed()
    pg.screenshot(path=str(IMG / "使用條款_分享照片_1440.jpg"), type="jpeg", quality=80)
    c.close()
    rb = requests.get(B + "/robots.txt").text
    bots = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "Google-Extended", "CCBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Bytespider", "Applebot-Extended"]
    check("E3 robots.txt 拒絕 AI 爬蟲", all(f"User-agent: {b}\nDisallow: /\n" in rb for b in bots), rb[:200])
    check("E4 robots.txt 一般爬蟲規則不變", rb.startswith("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n"))
    home = requests.get(B + "/").text
    check("E5 noindex 照舊", 'name="robots" content="noindex' in home)
    br.close()

check("Z console error 0", not errs, errs[:5])
print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} 通過；share {N}、{N2}；封面碼 {CODE}")
json.dump({"share": N, "share2": N2, "code": CODE, "handle": handle, "cover": cover}, open("/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad/vc_local_result.json", "w"), ensure_ascii=False, indent=2)
