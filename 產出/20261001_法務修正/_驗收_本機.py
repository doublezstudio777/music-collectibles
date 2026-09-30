#!/usr/bin/env python3
"""法務修正本機驗收（2026-10-01）。

前提：網站/ 已 npm run build、npm start -- --port 8791（本機 D1 已套 0027_legal），dev server 輸出導到 --log 指定的檔（抓驗證碼與寄信內容）。
用法：python3 _驗收_本機.py --log <server.log> [--base http://127.0.0.1:8791] [--gps <帶 GPS 的 JPEG>]
輸出：result_本機.json、img/*.jpg、reburn_report_本機.json
會在本機 D1 建測試會員、收藏、通知、刪帳申請（每次都用新的時間戳，不清舊資料），不碰正式站。
"""
import argparse, glob, hashlib, io, json, os, re, secrets, shutil, sqlite3, subprocess, sys, time
import requests
from PIL import Image
from PIL.ExifTags import IFD
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", "..", "網站"))
ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8791")
ap.add_argument("--log", required=True)
ap.add_argument("--gps", required=True)
args = ap.parse_args()
B = args.base.rstrip("/")
IMG = os.path.join(HERE, "img")
os.makedirs(IMG, exist_ok=True)
DB = [x for x in glob.glob(os.path.join(SITE, ".wrangler/state/v3/d1/**/*.sqlite"), recursive=True) if "metadata" not in x and os.path.getsize(x) > 100000][0]
db = sqlite3.connect(DB, isolation_level=None)
STAMP = time.strftime("%m%d%H%M%S")
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS" if ok else "FAIL"), name, "" if ok else str(detail)[:300], flush=True)


def one(sql, *a):
    r = db.execute(sql, a).fetchone()
    return r[0] if r else None


def mkuser(handle, terms=None, verified=True):
    uid = "lt" + secrets.token_hex(6)
    ph = one("SELECT password_hash FROM users WHERE id = 'demo-yzadmin'")
    db.execute(
        "INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, name_key, terms_version) VALUES (?,?,?,?,?,?,?,?)",
        (uid, f"{handle}@legal.test", "2026-10-01T00:00:00Z" if verified else None, ph, handle, f"法務{handle[-6:]}", f"法務{handle[-6:]}", terms),
    )
    tok = secrets.token_urlsafe(32)
    db.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", (hashlib.sha256(tok.encode()).hexdigest(), uid, "2030-01-01T00:00:00Z"))
    return uid, tok


def H(tok):
    return {"Cookie": f"yz_session={tok}", "Origin": B, "x-yz-test-country": "TW"}


def mails_since(pos):
    txt = open(args.log, "rb").read()[pos:].decode("utf-8", "replace")
    return re.findall(r"\[樂迷藏寄信\] to=(\S+) subject=(.*?)\n(.*?)\n\[樂迷藏寄信結束\]", txt, re.S)


def logpos():
    return os.path.getsize(args.log)


def r2(key):
    p = os.path.join(HERE, "_tmp_r2")
    if os.path.exists(p):
        os.remove(p)
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", f"yinzang-photos/{key}", "--local",
         "--persist-to", ".wrangler/state", "--config", "wrangler.local.jsonc", "--file", p],
        cwd=SITE, capture_output=True, text=True,
    )
    if r.returncode != 0 or not os.path.exists(p):
        return None
    b = open(p, "rb").read()
    os.remove(p)
    return b


def has_gps(b):
    try:
        im = Image.open(io.BytesIO(b))
        ex = im.getexif()
        return bool(ex.get_ifd(IFD.GPSInfo)) or bool(im.info.get("exif"))
    except Exception as e:  # noqa: BLE001
        return f"讀不出：{e}"


# 準備：清限流、admin 同意現行條款（不然後台畫面被補同意視窗蓋住；記下原值，最後改回）
db.execute("DELETE FROM rate_limits WHERE key LIKE 'register:%' OR key LIKE 'takedown:%' OR key LIKE 'feedback:%'")
admin_terms = db.execute("SELECT terms_version, terms_accepted_at FROM users WHERE id = 'demo-yzadmin'").fetchone()
db.execute("UPDATE users SET terms_version = '1.0' WHERE id = 'demo-yzadmin'")
atok = secrets.token_urlsafe(32)
db.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", (hashlib.sha256(atok.encode()).hexdigest(), "demo-yzadmin", "2030-01-01T00:00:00Z"))

# ---------- A. 法務頁文字 ----------
S = requests.Session()
t = S.get(B + "/terms").text.replace("<!-- -->", "")
p = S.get(B + "/privacy").text.replace("<!-- -->", "")
home = S.get(B + "/").text.replace("<!-- -->", "")
check("A1 兩頁都沒有「草稿」", "草稿" not in t and "草稿" not in p)
check("A2 版本 1.0＋生效日 2026-10-01", all("版本 1.0" in x and "生效日 2026-10-01" in x for x in (t, p)))
op = "達帛利數位行銷工作室（統一編號 91133660，負責人陳應銓，新竹縣）"
check("A3 條款與隱私權寫經營者", op in t and op in p)
check("A4 聯絡信箱 service@lemibox.com", "service@lemibox.com" in t and "service@lemibox.com" in p)
check("A5 首頁沒有達帛利字樣（頁尾維持 © 2026 樂迷藏）", "達帛利" not in home and "© 2026 樂迷藏" in home, "")
check("A6 頁尾 D4：拍攝者＋選擇編排＋權利侵害通知連結", "網站設計與資料之選擇編排屬樂迷藏" in home and "會員照片著作權屬拍攝者" in home and 'href="/takedown"' in home)
check("A7 M7 禁售品：票券加價、已使用票根另寫、盜錄、私製、仿冒商標、個資", all(k in t for k in ["未使用、仍可入場的演出票券", "已使用的票根作為收藏品出售不在此限", "未經授權的演出錄音、錄影", "私製重製品", "仿冒商標的商品", "附有他人個人資料的物品"]))
check("A8 M4：文字授權、刪帳保留延續、本人拍攝、不可撤回、社群帳號轉貼", all(k in t for k in ["收藏說明、留言、自我介紹與其他文字", "授權延續到該內容移除為止", "都只能上傳你本人拍攝的照片", "CC 授權一經發布無法撤回", "在樂迷藏的社群帳號轉貼，並標示你的帳號名"]))
check("A9 M5：第 11 條通知取下回復、三次終止、窗口", all(k in t for k in ["10 個工作日內沒有提出已經起訴的證明", "達三次，我們會終止該帳號的全部服務", "侵權通知的聯繫窗口"]))
check("A10 第 8 條委任只發通知、不含訴訟和解", "委任我們以你的名義" in t and "不包括提起訴訟、和解" in t)
check("A11 M6：30 日內處理、匿名浮水印", "30 日內處理完成" in t and "浮水印上的帳號名會改成匿名代號" in t)
check("A12 M3：瀏覽次數 90 天、不再「待定」", "待定" not in p and re.search(r"瀏覽次數.*?90 天；刪除帳號時刪除", p, re.S) is not None)
check("A13 M3：利用地區、不提供的影響、特定目的代號、30 日回覆", all(k in p for k in ["利用地區：台灣", "不提供就無法註冊", "（069）", "C001", "30 日內回覆"]))
check("A14 隱私權：私訊檢舉與封鎖名單、同意紀錄、權利侵害通知資料", all(k in p for k in ["私訊檢舉（檢舉人、被檢舉人、理由與補充說明）", "封鎖名單", "條款同意紀錄", "權利侵害通知與回復通知"]))
check("A15 管轄新竹地院、沒有責任上限空格", "臺灣新竹地方法院" in t and "【" not in t and "【" not in p)
r = S.get(B + "/terms/history")
check("A16 /terms/history 200、列 1.0", r.status_code == 200 and "1.0" in r.text)
r = S.get(B + "/takedown")
check("A17 /takedown 200、公告窗口、X-Robots-Tag noindex", r.status_code == 200 and "service@lemibox.com" in r.text and "noindex" in r.headers.get("x-robots-tag", ""))

# ---------- B. 註冊必勾 ----------
r = S.post(B + "/api/auth/register", json={"email": f"nocheck{STAMP}@legal.test", "password": "password123", "handle": f"nc{STAMP}", "name": f"不勾{STAMP}", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}, headers={"Origin": B})
check("B1 API 沒勾 → 400 TERMS_REQUIRED、沒建帳號", r.status_code == 400 and r.json()["error"]["code"] == "TERMS_REQUIRED" and one("SELECT COUNT(*) FROM users WHERE handle = ?", f"nc{STAMP}") == 0, r.text)
r = S.post(B + "/api/auth/register", json={"email": f"oldver{STAMP}@legal.test", "password": "password123", "handle": f"ov{STAMP}", "name": f"舊版{STAMP}", "agreeTerms": True, "termsVersion": "0.9", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}, headers={"Origin": B})
check("B2 API 版本不對 → 409 TERMS_CHANGED", r.status_code == 409 and r.json()["error"]["code"] == "TERMS_CHANGED", r.text)

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    def ctx(w, h, token=None, mobile=False):
        c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        if token:
            c.add_cookies([{"name": "yz_session", "value": token, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        c.route(re.compile(r"^http://127\.0\.0\.1:8791/"), lambda route: route.continue_(headers={**route.request.headers, "x-yz-test-country": "TW"}))
        pg = c.new_page()
        pg.on("console", lambda m, u=w: m.type == "error" and errs.append(f"{u}: {m.text[:200]}"))
        pg.on("response", lambda x, u=w: x.status >= 400 and errs.append(f"{u}: HTTP {x.status} {x.request.method} {x.url[:120]}"))
        return c, pg

    def settle(pg, extra=0):
        pg.wait_for_load_state("load")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(600 + extra)

    def shot(pg, name):
        pg.screenshot(path=os.path.join(IMG, name + ".jpg"), type="jpeg", quality=80, full_page=False)

    # B. 註冊畫面
    c, pg = ctx(390, 844, mobile=True)
    pg.goto(B + "/login")
    settle(pg)
    pg.locator(".auth-links button.link", has_text="註冊").click()
    pg.wait_for_selector("[data-testid=register-agree]")
    check("B3 註冊畫面有同意框，沒勾時送出鈕反灰", pg.locator("[data-testid=auth-submit]").is_disabled())
    txt = pg.locator("[data-testid=register-agree]").inner_text()
    check("B4 同意框文字：18 歲、兩個連結另開分頁、搜尋引擎收錄", "年滿 18 歲" in txt and "搜尋引擎收錄" in txt and pg.locator("[data-testid=register-agree] a[target=_blank]").count() == 2, txt)
    handle = f"lreg{STAMP}"
    pg.fill("#login-email", f"{handle}@legal.test") if pg.locator("#login-email").count() else pg.locator("input[type=email]").first.fill(f"{handle}@legal.test")
    pg.locator("input[type=password]").first.fill("password123")
    pg.locator("input[autocomplete=username]").fill(handle)
    pg.locator("input[autocomplete=nickname]").fill(f"註冊{STAMP[-6:]}")
    pg.locator("[data-testid=register-agree-box]").check()
    shot(pg, "B_註冊同意框_390")
    pos = logpos()
    pg.wait_for_function("() => !document.querySelector('[data-testid=auth-submit]').disabled")
    pg.wait_for_timeout(2500)  # Turnstile 測試金鑰
    pg.locator("[data-testid=auth-submit]").click()
    pg.wait_for_selector("form[data-mode=verify]", timeout=20000)
    code = None
    for _ in range(20):
        m = [x for x in mails_since(pos) if x[0] == f"{handle}@legal.test"]
        if m:
            code = re.search(r"(\d{6})", m[-1][2]).group(1)
            break
        time.sleep(0.5)
    pg.locator("input[autocomplete=one-time-code]").fill(code or "000000")
    pg.locator("[data-testid=auth-submit]").click()
    pg.wait_for_timeout(2500)
    row = db.execute("SELECT u.terms_version, u.terms_accepted_at, (SELECT via || '|' || version FROM terms_consents WHERE user_id = u.id) FROM users u WHERE handle = ?", (handle,)).fetchone()
    check("B5 勾選註冊成功，users 記版本與時間、terms_consents via=register", row and row[0] == "1.0" and row[1] and row[2] == "register|1.0", row)
    check("B6 新註冊會員登入後不跳補同意視窗", pg.locator("[data-testid=terms-consent]").count() == 0)
    c.close()

    # ---------- C. 舊會員補同意 ----------
    mh = f"lold{STAMP}"
    mid, mtok = mkuser(mh, terms=None)
    r = requests.post(B + "/api/comments", headers=H(mtok), json={"share": 1, "body": "測試"})
    check("C1 沒同意的舊會員寫留言 → 403 TERMS_REQUIRED", r.status_code == 403 and r.json()["error"]["code"] == "TERMS_REQUIRED", r.text[:200])
    r = requests.post(B + "/api/uploads/code", headers=H(mtok))
    check("C2 沒同意拿不到上傳查證碼（不能發布）", r.status_code == 403, r.status_code)
    r = requests.get(B + "/api/me", headers=H(mtok)).json()
    check("C3 /api/me termsOk=false", r["user"]["termsOk"] is False, r["user"])
    c, pg = ctx(390, 844, token=mtok, mobile=True)
    pg.goto(B + "/")
    settle(pg, 2000)
    pg.wait_for_selector("[data-testid=terms-consent]", timeout=10000)
    box = pg.locator("[data-testid=terms-consent]").inner_text()
    check("C4 登入後跳補同意視窗，D3 四點＋兩個按鈕", all(k in box for k in ["版本 1.0", "CC BY-NC-ND 4.0", "搜尋引擎收錄", "著作權侵權通知", "30 日內處理", "閱讀並同意", "先不要，我想刪除帳號"]), box)
    shot(pg, "C_補同意視窗_390")
    pg.locator(".terms-consent .modal-x").click()
    pg.wait_for_timeout(400)
    check("C5 稍後再說 → 關閉、可以繼續瀏覽", pg.locator("[data-testid=terms-consent]").count() == 0)
    pg.goto(B + "/artists")
    settle(pg, 1500)
    check("C6 同一分頁換頁不再自動跳", pg.locator("[data-testid=terms-consent]").count() == 0)
    pg.goto(B + "/share/new")
    settle(pg, 1500)
    pg.locator("input[type=file]").first.set_input_files(args.gps)
    pg.wait_for_selector("[data-testid=terms-consent]", timeout=15000)
    check("C7 想發布（上傳照片）被擋 → 補同意視窗再打開", True)
    pg.locator("[data-testid=terms-agree]").click()
    pg.wait_for_function("() => !document.querySelector('[data-testid=terms-consent]')", timeout=10000)
    row = db.execute("SELECT terms_version, (SELECT group_concat(via || '|' || version) FROM terms_consents WHERE user_id = ?) FROM users WHERE id = ?", (mid, mid)).fetchone()
    check("C8 按同意 → users 1.0、terms_consents via=update", row[0] == "1.0" and row[1] == "update|1.0", row)
    c.close()

    # ---------- D. 發布提示＋GPS ----------
    c, pg = ctx(1440, 900, token=mtok)
    pg.goto(B + "/share/new")
    settle(pg, 1000)
    lic = pg.locator("[data-testid=sf-license]").inner_text()
    check("D1 發布鈕旁有 D2 授權提示（本人拍攝、CC BY-NC-ND、無法撤回）", all(k in lic for k in ["本人拍攝", "CC BY-NC-ND 4.0", "無法撤回"]), lic)
    ups = []
    pg.on("response", lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST" and ups.append(x))
    pg.locator("input[type=file]").first.set_input_files(args.gps)
    pg.wait_for_function("() => document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 1", timeout=90000)
    pg.locator("[data-testid=artist-search]").fill("國蛋")
    pg.locator("[data-testid=artist-opt][data-slug=gordon]").first.click()
    pg.locator("[data-testid=pick-kind] button:text-is('CD')").click()
    if pg.locator("[data-testid=where-opt]").count():
        pg.locator("[data-testid=where-opt]").first.click()
    if pg.locator("[data-testid=pick-version] button").count():
        pg.locator("[data-testid=pick-version] button").first.click()
    pg.locator("#share-form-story").fill(f"法務驗收 {STAMP}") if pg.locator("#share-form-story").count() else None
    shot(pg, "D_發布提示_1440")
    pg.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    pg.locator("[data-testid=share-submit]").click()
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
    share_no = int(pg.url.rsplit("/", 1)[1])
    check("D2 會員同意後可以發布", share_no > 0, pg.url)
    c.close()
    for w in (390, 360):
        c, pg = ctx(w, 800, token=mtok, mobile=True)
        pg.goto(B + "/share/new")
        settle(pg, 1000)
        bb = pg.locator("[data-testid=sf-summary]").bounding_box()
        lb = pg.locator("[data-testid=sf-license]").bounding_box()
        btn = pg.locator("[data-testid=share-submit]").bounding_box()
        check(f"D3 手機 {w}：提示在黏底列裡、按鈕上方、不超出螢幕", lb and bb and lb["y"] >= bb["y"] and lb["y"] + lb["height"] <= btn["y"] + 1 and lb["x"] + lb["width"] <= w, (bb, lb, btn))
        shot(pg, f"D_發布提示_{w}")
        c.close()
    ph = db.execute("SELECT id, r2_key, thumb_key, orig_key FROM photos WHERE share_no = ? AND deleted_at IS NULL", (share_no,)).fetchone()
    src_gps = has_gps(open(args.gps, "rb").read())
    got = {k: r2(v) for k, v in zip(("main", "thumb", "orig"), ph[1:])}
    check("D4 GPS 實測：原始檔有 GPS，上傳後主圖、縮圖、原圖都沒有 EXIF／GPS", src_gps is True and all(b and has_gps(b) is False for b in got.values()), {"src": src_gps, **{k: (has_gps(b) if b else "讀不到") for k, b in got.items()}})

    # ---------- E. 權利侵害通知 ----------
    c, pg = ctx(1440, 900)
    pg.goto(B + "/takedown")
    settle(pg, 1000)
    pg.fill("[data-testid=td-name]", f"通知人{STAMP[-4:]}")
    pg.fill("[data-testid=td-email]", f"claimant{STAMP}@legal.test")
    pg.fill("[data-testid=td-phone]", "0912000000")
    pg.locator("[data-testid=td-role-owner]").check()
    pg.locator("[data-testid=td-right-copyright]").check()
    pg.fill("[data-testid=td-work]", "我拍的照片")
    pg.fill("[data-testid=td-urls]", f"{B}/share/{share_no}")
    pg.fill("[data-testid=td-detail]", "未經同意使用")
    pg.locator("[data-testid=td-sworn]").check()
    pg.wait_for_timeout(2500)
    shot(pg, "E_權利侵害通知表單_1440")
    pg.locator("[data-testid=td-submit]").click()
    pg.wait_for_selector("[data-testid=takedown-done]", timeout=15000)
    nid = int(re.search(r"#(\d+)", pg.locator("[data-testid=takedown-done]").inner_text()).group(1))
    row = db.execute("SELECT status, member_id, shares FROM takedown_notices WHERE id = ?", (nid,)).fetchone()
    check("E1 通知送出，對到收藏與會員", row == ("pending", mid, f"[{share_no}]"), row)
    c.close()
    c, pg = ctx(1440, 900, token=atok)
    pg.goto(B + "/admin/takedowns")
    settle(pg, 1500)
    item = pg.locator(f"[data-testid=td-item][data-id='{nid}']")
    check("E2 後台看得到通知（含通知人聯絡方式）", item.count() == 1 and f"claimant{STAMP}@legal.test" in item.inner_text())
    shot(pg, "E_後台侵權通知_待處理")
    pos = logpos()
    item.locator("[data-testid=td-act-remove]").click()
    pg.wait_for_selector(f"[data-testid=td-item][data-id='{nid}'][data-status=removed]", timeout=10000)
    hidden = one("SELECT hidden_at FROM shares WHERE no = ?", share_no)
    st = requests.get(B + f"/share/{share_no}?cb={secrets.token_hex(3)}").status_code
    m = [x for x in mails_since(pos) if x[0] == f"{mh}@legal.test"]
    check("E3 移除：收藏隱藏（404）、寄信給會員附回復通知網址、信裡沒有通知人 Email", hidden and st == 404 and m and f"/takedown/counter?id={nid}" in m[-1][2] and f"claimant{STAMP}" not in m[-1][2], (hidden, st, m[-1][1] if m else None))
    c.close()
    c, pg = ctx(390, 844, token=mtok, mobile=True)
    pg.goto(B + f"/takedown/counter?id={nid}")
    settle(pg, 1500)
    pg.wait_for_selector("[data-testid=counter-form]", timeout=10000)
    check("E4 會員看得到通知內容（不含通知人 Email）", f"claimant{STAMP}" not in pg.content() and "我拍的照片" in pg.content())
    pg.fill("[data-testid=counter-text]", "照片是我本人拍的")
    pg.locator("[data-testid=counter-sworn]").check()
    shot(pg, "E_回復通知_390")
    pg.locator("[data-testid=counter-submit]").click()
    pg.wait_for_selector("[data-testid=counter-done]", timeout=10000)
    check("E5 回復通知送出 → status=counter", one("SELECT status FROM takedown_notices WHERE id = ?", nid) == "counter")
    c.close()
    other_id, other_tok = mkuser(f"loth{STAMP}", terms="1.0")
    r = requests.get(B + f"/api/takedown/{nid}", headers=H(other_tok))
    check("E6 別的會員看不到這則通知（404）", r.status_code == 404, r.status_code)
    c, pg = ctx(1440, 900, token=atok)
    pg.goto(B + "/admin/takedowns")
    settle(pg, 1500)
    item = pg.locator(f"[data-testid=td-item][data-id='{nid}']")
    pos = logpos()
    item.locator("[data-testid=td-act-forward]").click()
    pg.wait_for_selector(f"[data-testid=td-item][data-id='{nid}'][data-status=forwarded]", timeout=10000)
    m = [x for x in mails_since(pos) if x[0] == f"claimant{STAMP}@legal.test"]
    due = one("SELECT restore_due FROM takedown_notices WHERE id = ?", nid)
    check("E7 轉送回復通知：寄信給通知人（含回復內容、10 個工作日）、記下期限", m and "照片是我本人拍的" in m[-1][2] and "10 個工作日" in m[-1][2] and due, (due, m[-1][1] if m else None))
    item = pg.locator(f"[data-testid=td-item][data-id='{nid}']")
    item.locator("[data-testid=td-act-restore]").click()
    pg.wait_for_selector(f"[data-testid=td-item][data-id='{nid}'][data-status=restored]", timeout=10000)
    st = requests.get(B + f"/share/{share_no}?cb={secrets.token_hex(3)}").status_code
    check("E8 回復：收藏取消隱藏（200）", one("SELECT hidden_at FROM shares WHERE no = ?", share_no) is None and st == 200, st)
    pg.locator(f"[data-testid=td-item][data-id='{nid}'] details.td-log summary").click()
    ev = json.loads(one("SELECT events FROM takedown_notices WHERE id = ?", nid))
    check("E9 處理紀錄完整（送出→移除→寄信→回復通知→轉送→回復）", [e["action"][:4] for e in ev] == ["送出通知", "移除內容", "已寄信通", "會員送出", "轉送回復", "回復內容"], [e["action"] for e in ev])
    shot(pg, "E_後台侵權通知_處理紀錄")
    c.close()
    # 三次侵權停權：直接建三筆已移除的通知（網址不是收藏），管理員各按一次計入
    sid, stok = mkuser(f"lstr{STAMP}", terms="1.0")
    ids = []
    for i in range(3):
        db.execute(
            "INSERT INTO takedown_notices (status, claimant_name, claimant_email, role, right_type, work, urls, detail, member_id, events) VALUES ('removed','測試','c@legal.test','owner','copyright','w','[\"/artist/x\"]','d',?, '[]')",
            (sid,),
        )
        ids.append(one("SELECT MAX(id) FROM takedown_notices"))
    outs = [requests.post(B + "/api/admin/takedowns", headers=H(atok), json={"id": i, "action": "strike"}).status_code for i in ids]
    again = requests.post(B + "/api/admin/takedowns", headers=H(atok), json={"id": ids[0], "action": "strike"}).status_code
    u = db.execute("SELECT copyright_strikes, status FROM users WHERE id = ?", (sid,)).fetchone()
    susp = one("SELECT reason FROM suspensions WHERE user_id = ? AND ended_at IS NULL", sid)
    check("E10 計入三次 → 累計 3、自動停權（原因 copyright）、同一則不能重複計", outs == [200, 200, 200] and again == 409 and u == (3, "suspended") and susp == "copyright", (outs, again, u, susp))
    r = requests.post(B + "/api/admin/takedowns", headers=H(atok), json={"id": ids[0], "action": "reject"})
    check("E11 已處理過的通知不能再按不成立", r.status_code == 409, r.status_code)
    r = requests.post(B + "/api/takedown", json={"name": "x", "email": "x@legal.test", "role": "owner", "rightType": "copyright", "work": "w", "urls": "/share/1", "detail": "d", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}, headers={"Origin": B})
    check("E12 沒勾聲明屬實 → 400", r.status_code == 400, r.text[:120])

    # ---------- F. 刪帳：申請時選照片、30 日期限、保留照片重燒匿名浮水印 ----------
    d3, d3tok = mkuser(f"ldel{STAMP}", terms="1.0")
    r = requests.post(B + "/api/me/delete", headers=H(d3tok), json={"reason": "測試一併刪照片", "deletePhotos": True})
    check("F1 申請時勾一併刪除照片 → delete_photos=1", r.status_code == 201 and one("SELECT delete_photos FROM deletion_requests WHERE user_id = ?", d3) == 1, r.text[:120])
    requests.delete(B + "/api/me/delete", headers=H(d3tok))
    c, pg = ctx(390, 844, token=mtok, mobile=True)
    pg.goto(B + "/settings/delete")
    settle(pg, 1500)
    txt = pg.locator(".delete-request").inner_text()
    check("F2 申請頁寫 30 日內、可選一併刪照片、保留的照片改匿名", "30 日內處理完成" in txt and pg.locator("[data-testid=delete-photos]").count() == 1 and "匿名代號" in txt, txt[:200])
    pg.fill("#del-reason", "法務驗收刪帳")
    shot(pg, "F_刪帳申請_390")
    pg.locator("[data-testid=delete-form] button[type=submit]").click()
    pg.wait_for_selector("[data-testid=delete-requested]", timeout=10000)
    c.close()
    rid = one("SELECT id FROM deletion_requests WHERE user_id = ? AND status = 'pending'", mid)
    old = db.execute("SELECT id, r2_key, thumb_key, og_key, verify_code FROM photos WHERE share_no = ? AND deleted_at IS NULL", (share_no,)).fetchone()
    c, pg = ctx(1440, 900, token=atok)
    pg.goto(B + "/admin/deletions")
    settle(pg, 1500)
    it = pg.locator(f"[data-request='{rid}']")
    check("F3 後台顯示處理期限（申請後 30 日）、預設照會員選擇（保留照片＝不勾）", "處理期限" in it.inner_text() and not it.locator("[data-testid=del-photos]").is_checked(), it.inner_text()[:200])
    shot(pg, "F_後台刪帳_期限")
    it.locator("[data-testid=del-execute]").click()
    it.locator("[data-testid=del-confirm]").fill(mh)
    it.locator("[data-testid=del-confirm-go]").click()
    pg.wait_for_function(f"() => (document.querySelector('[data-testid=del-reburn]')?.innerText || '').includes('--deletion {rid}')", timeout=15000)
    code = one("SELECT handle FROM users WHERE id = ?", mid)
    res = json.loads(one("SELECT result FROM deletion_requests WHERE id = ?", rid))
    check("F4 執行後：帳號名換代號、reburnPending=1、後台出現待重燒提示與指令", code.startswith("del-") and res.get("reburnPending") == 1 and f"--deletion {rid}" in pg.locator("[data-testid=del-reburn]").inner_text(), (code, res))
    shot(pg, "F_後台刪帳_待重燒")
    c.close()
    rb = subprocess.run(["python3", "scripts/reburn-watermark.py", "--local", "--deletion", str(rid)], cwd=SITE, capture_output=True, text=True)
    rep = json.load(open(os.path.join(SITE, ".wrangler/reburn/report.json"), encoding="utf-8"))
    shutil.copy(os.path.join(SITE, ".wrangler/reburn/report.json"), os.path.join(HERE, "reburn_report_本機.json"))
    new = db.execute("SELECT r2_key, thumb_key, og_key, verify_code FROM photos WHERE id = ?", (old[0],)).fetchone()
    corner = rep["照片"][0]["浮水印"]["corner"] if rep.get("照片") else ""
    check("F5 重燒腳本 --deletion：只重燒這位的 1 張、浮水印改成匿名代號、查證碼沿用", rb.returncode == 0 and len(rep["照片"]) == 1 and f"@{code}" in corner and mh not in corner and new[3] == old[4], (rb.returncode, corner, rb.stderr[-300:]))
    check("F6 新檔名、舊主圖縮圖從 R2 刪掉", new[0] != old[1] and r2(old[1]) is None and r2(old[2]) is None and r2(new[0]) is not None, (old[1], new[0]))
    st_old = requests.get(B + f"/img/{old[2]}", headers=H(atok)).status_code
    check("F7 舊縮圖網址 404", st_old == 404, st_old)
    check("F8 reburned_at 寫入", one("SELECT reburned_at FROM deletion_requests WHERE id = ?", rid) is not None)
    with open(os.path.join(IMG, "F_重燒後縮圖.jpg"), "wb") as f:
        Image.open(io.BytesIO(r2(new[1]))).convert("RGB").save(f, "JPEG", quality=85)
    c, pg = ctx(1440, 900, token=atok)
    pg.goto(B + "/admin/deletions")
    settle(pg, 1500)
    rb_txt = pg.locator("[data-testid=del-reburn]").inner_text() if pg.locator("[data-testid=del-reburn]").count() else ""
    check("F9 後台待重燒提示不再列這筆、紀錄顯示浮水印已匿名", f"--deletion {rid}" not in rb_txt and "浮水印已匿名" in pg.locator("[data-testid=del-handled]").inner_text(), rb_txt[:200])
    c.close()
    check("F10 刪帳清掉他的封鎖名單（user_blocks blocker）", one("SELECT COUNT(*) FROM user_blocks WHERE blocker_id = ?", mid) == 0)

    # ---------- G. 版面 ----------
    for path, name in (("/terms", "G_使用條款"), ("/privacy", "G_隱私權政策"), ("/takedown", "G_權利侵害通知")):
        for w in (1440, 390):
            c, pg = ctx(w, 900 if w > 500 else 844, mobile=w < 500)
            pg.goto(B + path)
            settle(pg, 800)
            ow = pg.evaluate("document.documentElement.scrollWidth")
            check(f"G {path} {w} 沒有橫向溢出", ow <= w, ow)
            shot(pg, f"{name}_{w}")
            if path == "/terms":
                pg.locator("footer.foot").screenshot(path=os.path.join(IMG, f"G_頁尾_{w}.jpg"), type="jpeg", quality=80)
                fr = pg.evaluate("[...document.querySelectorAll('.foot-row > *')].map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; })")
                check(f"G 頁尾 {w} 每個元素都在畫面內", all(l >= 0 and r <= w for l, r in fr), fr)
            c.close()
    br.close()

bad = [e for e in errs if "403" not in e and "409" not in e and "font-size:0" not in e and "/api/details" not in e]
check("Z console error 0（排除故意觸發的 403／409）", not bad, bad[:5])
db.execute("UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE id = 'demo-yzadmin'", admin_terms)
json.dump({"stamp": STAMP, "results": results}, open(os.path.join(HERE, "result_本機.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
n = sum(r["ok"] for r in results)
print(f"\n{n}/{len(results)} 通過")
sys.exit(0 if n == len(results) else 1)
