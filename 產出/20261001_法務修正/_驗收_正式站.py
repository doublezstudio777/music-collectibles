#!/usr/bin/env python3
"""法務修正正式站驗收（2026-10-01，lemibox.com）。

第一段（本機無頭 Chromium＋API）：法務頁文字、頁尾、舊會員補同意、同意後發布（帶 GPS 照片，驗 R2 檔沒有位置資訊）、
  權利侵害通知後台流程（移除→寄信→回復通知→轉送→回復）、刪帳保留照片→重燒匿名浮水印。
第二段（Windows Chrome CDP，Turnstile 受管理模式無頭過不了）：註冊勾選同意、權利侵害通知表單送出。
測試帳號、session 直接寫 D1；信件寄到 Resend 測試信箱 delivered+…@resend.dev，從 Resend API 讀。
用法：python3 _驗收_正式站.py <scratchpad> <rq.sh> <gps.jpg>（CDP 轉接 192.168.48.1:9223 先開好）
狀態存 scratchpad/legal_prod_state.json（清測試資料用），不進 git。
"""
import hashlib, io, json, os, re, secrets, shutil, subprocess, sys, time
import requests
from PIL import Image
from PIL.ExifTags import IFD
from playwright.sync_api import sync_playwright

B = "https://lemibox.com"
SP, RQ, GPS = sys.argv[1], sys.argv[2], sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", "..", "網站"))
IMG = os.path.join(HERE, "img")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36"
ADMIN = "_mVdpM87Csonq7po"
STAMP = time.strftime("%m%d%H%M")
IGNORE = ("sentry.io", "spotify", "challenges.cloudflare.com")
results = []
stf = os.path.join(SP, "legal_prod_state.json")
st = {"stamp": STAMP, "users": [], "shares": [], "notices": [], "deletions": [], "admin_session": None}


def save():
    json.dump(st, open(stf, "w"), ensure_ascii=False, indent=2)


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS" if ok else "FAIL"), name, "" if ok else str(detail)[:300], flush=True)


def q(sql):
    out = subprocess.run([RQ, sql], capture_output=True, text=True).stdout
    try:
        return json.loads(out)[0]
    except Exception:  # noqa: BLE001
        raise SystemExit(f"D1 查詢失敗：{sql}\n{out[-800:]}")


def one(sql):
    r = q(sql)
    return list(r[0].values())[0] if r else None


def resend_key():
    for l in open("/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/_私人/resend.txt", encoding="utf8"):
        if l.startswith("RESEND_API_KEY="):
            return l.split("=", 1)[1].strip()


def wait_mail(to, kw, timeout=120):
    h = {"Authorization": "Bearer " + resend_key()}
    t0 = time.time()
    while time.time() - t0 < timeout:
        for e in requests.get("https://api.resend.com/emails?limit=30", headers=h, timeout=20).json().get("data", []):
            if to in e["to"] and kw in e["subject"]:
                return requests.get("https://api.resend.com/emails/" + e["id"], headers=h, timeout=20).json()
        time.sleep(4)
    return None


def mkuser(handle, terms=None):
    uid = "lt" + secrets.token_hex(6)
    email = f"delivered+{handle}@resend.dev"
    tv = f"'{terms}'" if terms else "NULL"
    q(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, name_key, terms_version) VALUES ('{uid}', '{email}', '2026-10-01T00:00:00Z', '!test', '{handle}', '法務驗收{handle[-4:]}', '法務驗收{handle[-4:]}', {tv})")
    tok = secrets.token_urlsafe(32)
    q(f"INSERT INTO sessions (id, user_id, expires_at) VALUES ('{hashlib.sha256(tok.encode()).hexdigest()}', '{uid}', '2026-10-02T00:00:00Z')")
    st["users"].append(uid)
    save()
    return uid, tok, email


def H(tok):
    return {"Cookie": f"yz_session={tok}", "Origin": B, "User-Agent": UA}


def r2(key):
    p = os.path.join(SP, "_r2_get")
    if os.path.exists(p):
        os.remove(p)
    env = dict(os.environ)
    for l in open("/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/_私人/cloudflare.txt", encoding="utf8"):
        if "=" in l:
            k, v = l.strip().split("=", 1)
            env[k] = v
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", f"yinzang-photos/{key}", "--remote",
                        "--config", "wrangler.production.jsonc", "--file", p], cwd=SITE, capture_output=True, text=True, env=env)
    if r.returncode != 0 or not os.path.exists(p):
        return None
    b = open(p, "rb").read()
    os.remove(p)
    return b


def has_gps(b):
    im = Image.open(io.BytesIO(b))
    return bool(im.getexif().get_ifd(IFD.GPSInfo)) or bool(im.info.get("exif"))


save()
# ---------- A. 法務頁 ----------
S = requests.Session()
S.headers["User-Agent"] = UA
t = S.get(B + "/terms").text.replace("<!-- -->", "")
p = S.get(B + "/privacy").text.replace("<!-- -->", "")
home = S.get(B + "/").text.replace("<!-- -->", "")
op = "達帛利數位行銷工作室（統一編號 91133660，負責人陳應銓，新竹縣）"
check("A1 條款、隱私權沒有「草稿」，版本 1.0、生效日 2026-10-01", all("草稿" not in x and "版本 1.0" in x and "生效日 2026-10-01" in x for x in (t, p)))
check("A2 經營者與 service@lemibox.com 寫在條款與隱私權", all(op in x and "service@lemibox.com" in x for x in (t, p)))
check("A3 首頁沒有達帛利字樣、頁尾 © 2026 樂迷藏＋D4＋權利侵害通知連結", "達帛利" not in home and "© 2026 樂迷藏" in home and "會員照片著作權屬拍攝者" in home and 'href="/takedown"' in home)
check("A4 M7 禁售品（票券加價／票根另寫／盜錄／私製／仿冒商標）", all(k in t for k in ["未使用、仍可入場的演出票券", "已使用的票根作為收藏品出售不在此限", "未經授權的演出錄音、錄影", "私製重製品", "仿冒商標的商品"]))
check("A5 M3 瀏覽次數 90 天、利用地區、不提供的影響、私訊檢舉與封鎖", "待定" not in p and all(k in p for k in ["利用地區：台灣", "不提供就無法註冊", "私訊檢舉（檢舉人、被檢舉人、理由與補充說明）", "封鎖名單"]))
r = S.get(B + "/takedown")
check("A6 /takedown 200、公告窗口", r.status_code == 200 and "service@lemibox.com" in r.text)
check("A7 /terms/history 200", S.get(B + "/terms/history").status_code == 200)

# ---------- B～F ----------
mh = f"lmblg{STAMP}"
mid, mtok, memail = mkuser(mh)
r = requests.post(B + "/api/comments", headers=H(mtok), json={"share": 4, "body": "測試"})
check("B1 沒同意的舊會員寫留言 → 403 TERMS_REQUIRED", r.status_code == 403 and r.json()["error"]["code"] == "TERMS_REQUIRED", r.text[:200])
atok = secrets.token_urlsafe(32)
q(f"INSERT INTO sessions (id, user_id, expires_at) VALUES ('{hashlib.sha256(atok.encode()).hexdigest()}', '{ADMIN}', '2026-10-02T00:00:00Z')")
st["admin_session"] = hashlib.sha256(atok.encode()).hexdigest()
save()
errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    def ctx(w, h, token=None, mobile=False):
        c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, user_agent=UA)
        if token:
            c.add_cookies([{"name": "yz_session", "value": token, "domain": "lemibox.com", "path": "/", "httpOnly": True, "secure": True}])
        pg = c.new_page()
        pg.on("console", lambda m: m.type == "error" and not any(k in m.text + (m.location or {}).get("url", "") for k in IGNORE) and errs.append(m.text[:200]))
        return c, pg

    c, pg = ctx(390, 844, token=mtok, mobile=True)
    pg.goto(B + "/", wait_until="load")
    pg.wait_for_selector("[data-testid=terms-consent]", timeout=20000)
    check("B2 正式站：舊會員登入後跳補同意視窗", "閱讀並同意" in pg.locator("[data-testid=terms-consent]").inner_text())
    pg.screenshot(path=os.path.join(IMG, "正式站_補同意視窗_390.jpg"), type="jpeg", quality=80)
    pg.locator("[data-testid=terms-agree]").click()
    pg.wait_for_function("() => !document.querySelector('[data-testid=terms-consent]')", timeout=15000)
    row = q(f"SELECT u.terms_version tv, (SELECT group_concat(via || '|' || version) FROM terms_consents WHERE user_id = u.id) c FROM users u WHERE id = '{mid}'")[0]
    check("B3 按同意 → D1 users 1.0、terms_consents via=update", row == {"tv": "1.0", "c": "update|1.0"}, row)
    c.close()

    c, pg = ctx(1440, 900, token=mtok)
    pg.goto(B + "/share/new", wait_until="load")
    pg.wait_for_selector("[data-testid=sf-license]", timeout=20000)
    check("C1 發布鈕旁有授權提示", "無法撤回" in pg.locator("[data-testid=sf-license]").inner_text())
    pg.locator("input[type=file]").first.set_input_files(GPS)
    pg.wait_for_function("() => document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 1", timeout=120000)
    pg.locator("[data-testid=artist-search]").fill("國蛋")
    pg.locator("[data-testid=artist-opt][data-slug=gordon]").first.click()
    pg.locator("[data-testid=pick-kind] button:text-is('CD')").click()
    pg.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    pg.locator("[data-testid=share-submit]").click()
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=60000)
    share_no = int(pg.url.rsplit("/", 1)[1])
    st["shares"].append(share_no)
    save()
    check("C2 同意後可以發布", share_no > 10, pg.url)
    c.close()
    ph = q(f"SELECT id, r2_key, thumb_key, orig_key, og_key FROM photos WHERE share_no = {share_no} AND deleted_at IS NULL")[0]
    got = {k: r2(ph[k]) for k in ("r2_key", "thumb_key", "orig_key")}
    check("C3 GPS 實測（正式站 R2）：原檔有 GPS，主圖、縮圖、原圖都沒有 EXIF／GPS", has_gps(open(GPS, "rb").read()) and all(b and not has_gps(b) for b in got.values()), {k: (has_gps(b) if b else "讀不到") for k, b in got.items()})

    # 第二段：Windows Chrome（註冊、權利侵害通知表單）
    cdp = pw.chromium.connect_over_cdp("http://192.168.48.1:9223")
    wc = cdp.new_context(viewport={"width": 1280, "height": 900})
    wp = wc.new_page()
    rh = f"lmbrg{STAMP}"
    wp.goto(B + "/login", wait_until="load")
    wp.locator("main .auth-links button.link", has_text="註冊").click()
    wp.wait_for_selector("main [data-testid=register-agree]")
    check("D1 正式站註冊畫面：同意框在、沒勾送出鈕反灰", wp.locator("main [data-testid=auth-submit]").is_disabled())
    f = wp.locator("main form.auth-form")
    f.locator("input[type=email]").fill(f"delivered+{rh}@resend.dev")
    f.locator("input[type=password]").fill(secrets.token_urlsafe(12))
    f.locator("input[autocomplete=username]").fill(rh)
    f.locator("input[autocomplete=nickname]").fill(f"註冊驗收{STAMP[-4:]}")
    f.locator("[data-testid=register-agree-box]").check()
    for _ in range(120):
        if wp.evaluate("(document.querySelector('main input[name=\"cf-turnstile-response\"]')||{}).value || ''"):
            break
        time.sleep(0.5)
    wp.screenshot(path=os.path.join(IMG, "正式站_註冊同意框_1280.jpg"), type="jpeg", quality=80)
    f.locator("[data-testid=auth-submit]").click()
    wp.wait_for_selector("main form.auth-form[data-mode=verify]", timeout=30000)
    rid_user = one(f"SELECT id FROM users WHERE handle = '{rh}'")
    if rid_user:
        st["users"].append(rid_user)
        save()
    row = q(f"SELECT u.terms_version tv, (SELECT group_concat(via || '|' || version) FROM terms_consents WHERE user_id = u.id) c FROM users u WHERE handle = '{rh}'")
    check("D2 正式站勾選註冊 → users 1.0、terms_consents via=register", row and row[0] == {"tv": "1.0", "c": "register|1.0"}, row)
    m = wait_mail(f"delivered+{rh}@resend.dev", "驗證碼")
    check("D3 註冊驗證信有寄出", m is not None, m and m.get("last_event"))

    wp.goto(B + "/takedown", wait_until="load")  # 第一輪在這裡等不到 Turnstile token，後段改用 _驗收_正式站_後段.py 續跑
    wp.fill("[data-testid=td-name]", f"驗收通知人{STAMP[-4:]}")
    wp.fill("[data-testid=td-email]", f"delivered+lmbclaim{STAMP}@resend.dev")
    wp.locator("[data-testid=td-role-owner]").check()
    wp.locator("[data-testid=td-right-copyright]").check()
    wp.fill("[data-testid=td-work]", "驗收用：我拍的照片")
    wp.fill("[data-testid=td-urls]", f"{B}/share/{share_no}")
    wp.fill("[data-testid=td-detail]", "驗收用：未經同意使用")
    wp.locator("[data-testid=td-sworn]").check()
    for _ in range(120):
        if wp.evaluate("(document.querySelector('main form[data-testid=takedown-form] input[name=\"cf-turnstile-response\"]')||{}).value || ''"):
            break
        time.sleep(0.5)
    wp.locator("[data-testid=td-submit]").click()
    wp.wait_for_selector("[data-testid=takedown-done]", timeout=30000)
    nid = int(re.search(r"#(\d+)", wp.locator("[data-testid=takedown-done]").inner_text()).group(1))
    st["notices"].append(nid)
    save()
    row = q(f"SELECT status, member_id, shares FROM takedown_notices WHERE id = {nid}")[0]
    check("E1 正式站權利侵害通知送出，對到收藏與會員", row == {"status": "pending", "member_id": mid, "shares": f"[{share_no}]"}, row)
    wc.close()
    cdp.close()
    br.close()

A = H(atok)
r = requests.post(B + "/api/admin/takedowns", headers=A, json={"id": nid, "action": "remove"})
st_share = requests.get(B + f"/share/{share_no}?cb={secrets.token_hex(3)}", headers={"User-Agent": UA}).status_code
m = wait_mail(memail, f"通知 #{nid}")
check("E2 移除：收藏 404、會員收到通知信（附回復通知網址、沒有通知人 Email）", r.status_code == 200 and st_share == 404 and m and f"/takedown/counter?id={nid}" in (m.get("text") or "") and "lmbclaim" not in (m.get("text") or ""), (r.status_code, st_share, m and m.get("subject")))
r = requests.post(B + f"/api/takedown/{nid}/counter", headers=H(mtok), json={"text": "驗收用：照片是我本人拍的", "sworn": True})
check("E3 會員送回復通知", r.status_code == 200 and one(f"SELECT status FROM takedown_notices WHERE id = {nid}") == "counter", r.text[:200])
r = requests.post(B + "/api/admin/takedowns", headers=A, json={"id": nid, "action": "forward"})
m = wait_mail(f"delivered+lmbclaim{STAMP}@resend.dev", f"#{nid} 的回復通知")
check("E4 轉送：通知人收到回復通知信（10 個工作日）", r.status_code == 200 and m and "10 個工作日" in (m.get("text") or ""), (r.status_code, m and m.get("subject")))
r = requests.post(B + "/api/admin/takedowns", headers=A, json={"id": nid, "action": "restore"})
st_share = requests.get(B + f"/share/{share_no}?cb={secrets.token_hex(3)}", headers={"User-Agent": UA}).status_code
ev = json.loads(one(f"SELECT events FROM takedown_notices WHERE id = {nid}"))
check("E5 回復：收藏 200、處理紀錄 6 步", r.status_code == 200 and st_share == 200 and len(ev) == 6, (st_share, [e["action"] for e in ev]))

# ---------- F. 刪帳保留照片 → 重燒匿名浮水印 ----------
r = requests.post(B + "/api/me/delete", headers=H(mtok), json={"reason": "驗收用：刪帳匿名化", "deletePhotos": False})
rid = one(f"SELECT id FROM deletion_requests WHERE user_id = '{mid}' AND status = 'pending'")
st["deletions"].append(rid)
save()
r = requests.post(B + "/api/admin/deletions/execute", headers=A, json={"id": rid, "deletePhotos": False, "confirm": mh})
res = json.loads(one(f"SELECT result FROM deletion_requests WHERE id = {rid}") or "{}")
code = one(f"SELECT handle FROM users WHERE id = '{mid}'")
check("F1 管理員執行刪帳：帳號名換代號、reburnPending=1、reburned_at 空", r.status_code == 200 and code.startswith("del-") and res.get("reburnPending") == 1 and one(f"SELECT reburned_at FROM deletion_requests WHERE id = {rid}") is None, (r.status_code, code, res))
env = dict(os.environ)
for l in open("/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/_私人/cloudflare.txt", encoding="utf8"):
    if "=" in l:
        k, v = l.strip().split("=", 1)
        env[k] = v
rb = subprocess.run(["python3", "scripts/reburn-watermark.py", "--remote", "--deletion", str(rid)], cwd=SITE, capture_output=True, text=True, env=env)
rep = json.load(open(os.path.join(SITE, ".wrangler/reburn/report.json"), encoding="utf-8"))
shutil.copy(os.path.join(SITE, ".wrangler/reburn/report.json"), os.path.join(HERE, "reburn_report_正式站.json"))
corner = rep["照片"][0]["浮水印"]["corner"] if rep.get("照片") else ""
new = q(f"SELECT r2_key, thumb_key FROM photos WHERE id = '{ph['id']}'")[0]
check("F2 正式站重燒：只這 1 張、浮水印 @del-代號、沒有原帳號名", rb.returncode == 0 and len(rep["照片"]) == 1 and f"@{code}" in corner and mh not in corner, (rb.returncode, corner, rb.stdout[-300:], rb.stderr[-300:]))
old_st = requests.get(B + f"/img/{ph['thumb_key']}", headers={"User-Agent": UA}).status_code
new_st = requests.get(B + f"/img/{new['thumb_key']}", headers={"User-Agent": UA})
check("F3 舊縮圖網址 404、新縮圖 200、reburned_at 寫入", old_st == 404 and new_st.status_code == 200 and one(f"SELECT reburned_at FROM deletion_requests WHERE id = {rid}"), (old_st, new_st.status_code))
if new_st.status_code == 200:
    Image.open(io.BytesIO(new_st.content)).convert("RGB").save(os.path.join(IMG, "正式站_重燒後縮圖.jpg"), "JPEG", quality=85)
check("Z console error 0（排除 Spotify、Sentry、Turnstile）", not errs, errs[:5])
json.dump({"stamp": STAMP, "results": results}, open(os.path.join(HERE, "result_正式站.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
n = sum(r["ok"] for r in results)
print(f"\n{n}/{len(results)} 通過；測試資料狀態 {stf}")
