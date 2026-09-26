# 第 2b 階段驗收：內容進 D1、炫收藏發布（含照片上傳 R2）、出價成交、越權、上傳上限、檢舉鎖定申訴、
# 管理後台、待審核新增、忘記密碼頻率限制、設定頁、存在性檢查、實際計數、localStorage 不再使用、畫面溢出。
# 用法：dev server（npm run dev，輸出導到 LOG），python3 _驗收.py <LOG 路徑> [網址，預設 http://localhost:5174]
# 全程本機：D1／R2 都是 Miniflare 模擬（網站/.wrangler/state）。驗證碼從 dev server 輸出抓。
import io, json, re, subprocess, sys, time
from pathlib import Path
import requests
from PIL import Image
from playwright.sync_api import sync_playwright

LOG = Path(sys.argv[1])
B = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5174"
HERE = Path(__file__).parent
SITE = HERE.parent.parent / "網站"
IMG = HERE / "img"; IMG.mkdir(exist_ok=True)
STAMP = str(int(time.time()))[-6:]
PW = "listen-2026"
TT = "XXXX.DUMMY.TOKEN.XXXX"  # Turnstile 測試金鑰永遠通過
R = {"checks": [], "pages": {}, "stamp": STAMP}


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:400]})
    print(("PASS " if ok else "FAIL ") + name, str(detail)[:200])


def sql(cmd):
    out = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
                          "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
                         cwd=SITE, capture_output=True, text=True)
    try:
        return json.loads(out.stdout)[0]["results"]
    except Exception:
        return out.stdout + out.stderr


class U:
    """一個帳號：Bearer token 打 API（App 路徑，跟網頁同一套 session）"""
    def __init__(self, tag):
        self.email = f"{tag}{STAMP}@example.com"; self.handle = f"{tag}{STAMP}"; self.name = f"{tag.upper()}{STAMP[-3:]}"
        ip = f"10.{int(STAMP) % 250}.{len(tag)}.{ord(tag[0]) % 250}"
        r = requests.post(B + "/api/auth/register", json={"email": self.email, "password": PW, "handle": self.handle, "name": self.name,
                                                          "turnstileToken": TT}, headers={"cf-connecting-ip": ip})
        assert r.status_code == 201, r.text
        code = code_for(self.email)
        r = requests.post(B + "/api/auth/verify-email", json={"email": self.email, "code": code, "client": "app"})
        self.token = r.json()["token"]
        self.id = sql(f"select id from users where email='{self.email}'")[0]["id"]

    def h(self):
        return {"authorization": f"Bearer {self.token}"}

    def get(self, p):
        r = requests.get(B + p, headers=self.h()); return r.status_code, safe(r)

    def post(self, p, body=None, method="POST"):
        r = requests.request(method, B + p, json=body if body is not None else {}, headers=self.h()); return r.status_code, safe(r)

    def upload(self, main, thumb, purpose="share"):
        r = requests.post(B + "/api/uploads", headers=self.h(), data={"purpose": purpose},
                          files={"image": ("a.webp", main, "image/webp"), "thumb": ("t.webp", thumb, "image/webp")})
        return r.status_code, safe(r)


def safe(r):
    try:
        return r.json()
    except Exception:
        return {"raw": r.text[:200]}


def code_for(email, purpose="驗證碼是"):
    for _ in range(60):
        m = re.findall(rf"to={re.escape(email)} .*?\n.*?{purpose} (\d{{6}})", LOG.read_text(errors="ignore"))
        if m:
            return m[-1]
        time.sleep(0.25)
    return None


def webp(w=800, h=600, color=(200, 120, 40), q=80):
    b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, "WEBP", quality=q); return b.getvalue()


def settle(pg):
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pg.wait_for_load_state("load")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)


def wait_turnstile(scope):
    scope.locator("input[name=cf-turnstile-response]").first.wait_for(state="attached", timeout=20000)
    scope.page.wait_for_function("() => [...document.querySelectorAll('input[name=cf-turnstile-response]')].some(i => i.value)", timeout=20000)


def ui_login(pg, u):
    pg.goto(B + "/login"); settle(pg)
    pg.locator("#page-email").fill(u.email); pg.locator("#page-password").fill(u.pw if hasattr(u, "pw") else PW)
    wait_turnstile(pg.locator(".auth-page")); pg.locator(".auth-submit").click()
    pg.wait_for_url(B + "/", timeout=20000); settle(pg)


# ---------- 0. 帳號 ----------
A, Bb, C = U("a"), U("b"), U("c")
ADMIN_TOKEN = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": TT,
                                                          "client": "app"}).json()["token"]
AD = {"authorization": f"Bearer {ADMIN_TOKEN}"}
check("0 三個真帳號＋管理員登入", all([A.token, Bb.token, C.token, ADMIN_TOKEN]))

big = SITE / ".wrangler" / "verify-photo.jpg"
Image.new("RGB", (3000, 2000), (90, 60, 30)).save(big, "JPEG", quality=92)
R["big_photo_bytes"] = big.stat().st_size

with sync_playwright() as p:
    br = p.chromium.launch()
    errs = []

    def new_ctx(w, h=900):
        c = br.new_context(viewport={"width": w, "height": h})
        pg = c.new_page()
        pg.on("console", lambda m: errs.append((pg.url, m.text, (m.location or {}).get("url", ""))) if m.type == "error" else None)
        return c, pg

    # ---------- 1. A 用網頁發炫收藏（含照片，瀏覽器端壓縮）----------
    ca, pa = new_ctx(1440)
    ui_login(pa, A)
    pa.goto(B + "/share/new"); settle(pa)
    pa.locator("input[type=file]").first.set_input_files(str(big))
    pa.wait_for_function("() => document.querySelector('.drop.has-photo')", timeout=30000)
    pa.locator("#share-form-about").fill("山線")
    pa.locator(".suggest button", has_text="山線電台").click()
    pa.locator("[data-testid=pick-series] button", has_text="夜行採集").click()
    pa.locator("[data-testid=pick-item] button", has_text="CD").click()
    pa.locator("[data-testid=pick-version] button").first.click()
    pa.locator("#share-form-story").fill(f"驗收 {STAMP}：2b 發布測試")
    pa.locator(".seg button", has_text="開放出價").click()
    pa.screenshot(path=str(IMG / "1_表單填好_1440.jpg"), full_page=True, type="jpeg", quality=80)
    pa.locator(".form-foot button[type=submit]").click()
    pa.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000); settle(pa)
    N = int(pa.url.rsplit("/", 1)[1])
    R["share_no"] = N
    row = sql(f"select s.author_id, s.sale_state, s.series_key, p.r2_key, p.thumb_key, p.bytes, p.width, p.height, p.content_type from shares s join photos p on p.share_no=s.no where s.no={N}")[0]
    check("1 作者是登入的 A（不是小孟）", row["author_id"] == A.id, row["author_id"])
    check("1 系列＋品項＋版本、開放出價寫進 D1", row["series_key"] == "mountain-radio/1" and row["sale_state"] == "offer", row)
    check("1 照片轉 WebP、長邊 ≤1600", row["content_type"] == "image/webp" and max(row["width"], row["height"]) <= 1600 and max(row["width"], row["height"]) >= 1500,
          f'{row["width"]}x{row["height"]} {row["bytes"]}B（原檔 3000x2000 {R["big_photo_bytes"]}B）')
    img = requests.get(B + "/img/" + row["r2_key"])
    check("1 照片走網站路徑＋快取標頭", img.status_code == 200 and "immutable" in img.headers.get("cache-control", "") and img.headers.get("content-type") == "image/webp",
          dict(img.headers))
    thumb = requests.get(B + "/img/" + row["thumb_key"])
    check("1 另產縮圖（長邊 480）", thumb.status_code == 200 and max(Image.open(io.BytesIO(thumb.content)).size) == 480, Image.open(io.BytesIO(thumb.content)).size)
    pa.screenshot(path=str(IMG / "1_單則_A發布後_1440.jpg"), full_page=True, type="jpeg", quality=80)
    home = requests.get(B + "/?sort=new").text
    check("1 首頁（最新）看得到", f'href="/share/{N}"' in home)
    ser = requests.get(B + "/artist/mountain-radio/1").text
    check("1 系列頁看得到", f'href="/share/{N}"' in ser)
    ls = pa.evaluate("Object.keys(localStorage)")
    check("10 瀏覽器 localStorage 沒有音藏的鍵", not [k for k in ls if "yinzang" in k], ls)

    # ---------- 2. 出價：B 出價 → A 拒絕 → B 再出價 → A 接受 → 成交 → 已售出 → 改回出售中 ----------
    st, r1 = Bb.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 500})
    check("2 B 出價 500", st == 200, r1)
    offers = requests.get(B + f"/api/shares/{N}").json()["offers"]
    o1 = offers[-1]["id"]
    st, _ = A.post(f"/api/offers/{o1}/respond", {"answer": "rejected"})
    check("2 A 拒絕", st == 200 and sql(f"select status from offers where id={o1}")[0]["status"] == "rejected")
    st, r2 = Bb.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 800})
    o2 = requests.get(B + f"/api/shares/{N}").json()["offers"][-1]["id"]
    check("2 B 再出價 800（同一條對話）", st == 200 and o2 != o1 and r2["result"] == r1["result"], (o1, o2))
    # 越權：B 替 A 接受、B 改 A 的收藏
    st_x1, e1 = Bb.post(f"/api/offers/{o2}/respond", {"answer": "accepted"})
    st_x2, e2 = Bb.post(f"/api/shares/{N}", {"state": "sale", "price": 1}, method="PATCH")
    st_x3, _ = Bb.post(f"/api/shares/{N}/close", {"offerId": o2})
    st_x4, _ = A.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 100})
    check("3 越權：B 不能替 A 接受出價", st_x1 == 403, e1)
    check("3 越權：B 不能改 A 的收藏", st_x2 == 403 and sql(f"select sale_state from shares where no={N}")[0]["sale_state"] == "offer", e2)
    check("3 越權：B 不能替 A 成交、A 不能對自己出價", st_x3 == 403 and st_x4 == 403, (st_x3, st_x4))
    st, _ = A.post(f"/api/shares/{N}/close", {"offerId": o2})
    check("2 還沒接受不能成交", st == 409)
    st, _ = A.post(f"/api/offers/{o2}/respond", {"answer": "accepted"})
    check("2 A 接受 800", st == 200)
    # 用畫面按「成交給這位」
    pa.goto(B + f"/share/{N}"); settle(pa)
    pa.locator(".offers button", has_text="成交給這位").click()
    pa.wait_for_function("() => document.querySelector('.detail[data-sale=sold]')", timeout=15000); settle(pa)
    s = sql(f"select sale_state, sold_price, sold_to from shares where no={N}")[0]
    check("2 成交 → 已售出（成交價 800、成交對象 B）", s["sale_state"] == "sold" and s["sold_price"] == 800 and s["sold_to"] == Bb.id, s)
    pa.screenshot(path=str(IMG / "2_已售出_1440.jpg"), full_page=True, type="jpeg", quality=80)
    st, _ = Bb.post(f"/api/shares/{N}/reopen")
    check("3 越權：B 不能把 A 的改回出售中", st == 403)
    pa.locator(".seller-bar button", has_text="改回出售中").click()
    pa.wait_for_function("() => document.querySelector('.detail[data-sale=offer]')", timeout=15000); settle(pa)
    check("2 A 改回出售中（回到開放出價）", sql(f"select sale_state from shares where no={N}")[0]["sale_state"] == "offer")
    st, t = Bb.get(f"/api/threads/{r1['result']}")
    msgs = [m.get("text") for m in t["thread"]["messages"] if m["from"] is None]
    check("2 私訊裡有系統訊息（拒絕、接受、成交、改回）", {"賣家拒絕了 NT$ 500", "賣家接受了 NT$ 800", "已成交 NT$ 800", "賣家改回出售中"} <= set(msgs), msgs)
    st, _ = Bb.post(f"/api/threads/{r1['result']}/messages", {"text": "謝謝，週末面交"})
    st2, _ = C.get(f"/api/threads/{r1['result']}")
    check("5 私訊雙方可讀寫、第三人讀不到", st == 200 and st2 == 404, (st, st2))

    # ---------- 4. 上傳限制 ----------
    st, e = C.upload(b"not an image at all" * 10, b"nope" * 10)
    check("4 格式錯誤被拒（415）", st == 415 and e["error"]["code"] == "BAD_FORMAT", e)
    png = io.BytesIO(); Image.new("RGB", (10, 10)).save(png, "PNG")
    st, e = C.upload(png.getvalue(), png.getvalue())
    check("4 PNG 被拒（只收 WebP／JPEG）", st == 415, e)
    huge = webp(4000, 4000, q=100) + b"\0" * 1_600_000
    st, e = C.upload(huge, webp(100, 100))
    check("4 超過單檔大小被拒（413）", st == 413, e)
    small = webp(64, 64)
    oks = 0
    for i in range(40):
        st, e = C.upload(small, small)
        if st == 201:
            oks += 1
        else:
            break
    check("4 每人每日 30 張上限（第 31 張 429）", oks == 30 and st == 429 and e["error"]["code"] == "DAILY_LIMIT", (oks, st, e))
    used = sql("select value from counters where key='r2_bytes'")[0]["value"]
    R["r2_bytes_before_limit_test"] = used
    sql(f"update counters set value = {8 * 1024 ** 3 - 100} where key='r2_bytes'")
    st, e = Bb.upload(small, small)
    check("4 累計 8GB 邊界（剩 100 位元組）上傳被拒", st == 507 and e["error"]["code"] == "STORAGE_FULL", e)
    st, g = Bb.get("/api/uploads")
    check("4 容量滿時 /api/uploads 回 paused", g.get("paused") is True, g)
    cb, pb = new_ctx(390)
    pb.context.add_cookies([])  # 訪客也看得到「上傳暫停」
    pb.goto(B + "/share/new"); settle(pb)
    pb.wait_for_selector("[data-testid=upload-paused]", timeout=10000)
    check("4 表單顯示一行「上傳暫停」", pb.locator("[data-testid=upload-paused]").inner_text().strip() == "上傳暫停")
    pb.screenshot(path=str(IMG / "4_上傳暫停_390.jpg"), full_page=True, type="jpeg", quality=80)
    cb.close()
    sql(f"update counters set value = {8 * 1024 ** 3} where key='r2_bytes'")
    st, e = Bb.upload(small, small)
    check("4 剛好 8GB 也拒絕", st == 507, e)
    sql("update counters set value = (select coalesce(sum(bytes),0) from photos where deleted_at is null) where key='r2_bytes'")
    st, e = Bb.upload(small, small)
    check("4 還原累計值後可上傳", st == 201, e)

    # ---------- 6. 檢舉 → 鎖定 → 申訴 → 管理員解鎖 ----------
    requests.post(B + "/api/admin/threshold", json={"value": 2}, headers=AD)
    check("7 管理員把門檻調成 2（寫進 settings）", sql("select value from settings where key='report_threshold'")[0]["value"] == "2")
    st, e = A.post("/api/reports", {"target": f"share:{N}", "reason": "fake", "note": ""})
    check("6 不能檢舉自己的收藏", st == 403, e)
    sql(f"update users set email_verified_at = NULL where id='{C.id}'")
    st, e = C.post("/api/reports", {"target": f"share:{N}", "reason": "fake", "note": ""})
    check("6 Email 未驗證不能檢舉", st == 403 and e["error"]["code"] == "NOT_VERIFIED", e)
    sql(f"update users set email_verified_at = '2026-09-27T00:00:00Z' where id='{C.id}'")
    st, _ = Bb.post("/api/reports", {"target": f"share:{N}", "reason": "fake", "note": ""})
    st2, e2 = Bb.post("/api/reports", {"target": f"share:{N}", "reason": "fake", "note": ""})
    check("6 一人一次（重複 409）", st == 201 and st2 == 409, e2)
    st, _ = Bb.post("/api/reports", {"target": "share:999999", "reason": "fake"})
    check("6 檢舉不存在的對象 404", st == 404)
    st, _ = Bb.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 900})
    check("6 未達門檻時還能出價", st == 200)
    st, r = C.post("/api/reports", {"target": f"share:{N}", "reason": "fake", "note": ""})
    check("6 第 2 人檢舉 → 計數 2（資料庫）", st == 201 and r["count"] == 2, r)
    st, e = Bb.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 950})
    check("6 達門檻鎖定：出價被擋（423）", st == 423 and e["error"]["code"] == "LOCKED", e)
    last_offer = requests.get(B + f"/api/shares/{N}").json()["offers"][-1]["id"]
    st, e = A.post(f"/api/offers/{last_offer}/respond", {"answer": "accepted"})
    check("6 鎖定時賣家也不能接受（同一個判斷）", st == 423, e)
    st, e = A.post(f"/api/shares/{N}", {"state": "sale", "price": 1000}, method="PATCH")
    check("6 鎖定時不能改定價", st == 423, e)
    pa.goto(B + f"/share/{N}"); settle(pa)
    check("6 單則頁顯示鎖定＋交易暫停", pa.locator(".lock-banner").count() > 0 and pa.locator("[data-testid=frozen]").count() > 0)
    # A 申訴（附一張照片）
    st, up = A.upload(webp(600, 400), webp(120, 80), purpose="appeal")
    pa.locator(".appeal-btn").click()
    pa.locator(".appeal-form textarea").fill("這是官方首批，附發票")
    pa.locator(".appeal-form button[type=submit]").click()
    pa.wait_for_selector("[data-testid=appeal-status]", timeout=10000)
    check("6 A 申訴 → 審核中", "審核中" in pa.locator("[data-testid=appeal-status]").inner_text())
    pa.screenshot(path=str(IMG / "6_鎖定與申訴_1440.jpg"), full_page=True, type="jpeg", quality=80)
    st, e = Bb.post("/api/appeals", {"target": f"share:{N}", "text": "我也要申訴"})
    check("6 不是發文者不能申訴", st == 403, e)

    # ---------- 7. 管理後台 ----------
    st_b = requests.get(B + "/api/admin", headers=Bb.h()).status_code
    st_anon = requests.get(B + "/api/admin").status_code
    check("7 非管理員打 /api/admin 被擋（403／401）", st_b == 403 and st_anon == 401, (st_b, st_anon))
    cb, pb = new_ctx(1440)
    ui_login(pb, Bb)
    pb.goto(B + "/admin"); settle(pb)
    check("7 非管理員進 /admin 頁面被擋", pb.locator("[data-testid=admin-denied]").count() == 1 and pb.locator("#threshold").count() == 0)
    pb.screenshot(path=str(IMG / "7_非管理員進後台_1440.jpg"), type="jpeg", quality=80)
    menu_admin = pb.evaluate("() => [...document.querySelectorAll('.menu-panel a')].map(a => a.textContent)")
    check("7 非管理員選單沒有「管理後台」", "管理後台" not in menu_admin, menu_admin)
    cb.close()
    ov = requests.get(B + "/api/admin", headers=AD).json()
    ap = [a for a in ov["appeals"] if a["target"] == f"share:{N}"][0]
    check("7 後台看得到申訴與鎖定", ap["status"] == "pending" and any(t["target"] == f"share:{N}" and t["locked"] for t in ov["targets"]))
    cad, pad = new_ctx(1440)
    pad.goto(B + "/login"); settle(pad)
    pad.locator("#page-email").fill("admin@demo.yinzang.test"); pad.locator("#page-password").fill("yinzang-demo")
    wait_turnstile(pad.locator(".auth-page")); pad.locator(".auth-submit").click(); pad.wait_for_url(B + "/"); settle(pad)
    pad.goto(B + "/admin"); settle(pad)
    pad.locator(f".appeal[data-target='share:{N}'] button", has_text="解鎖").click()
    pad.wait_for_function(f"() => document.querySelector(\".appeal[data-target='share:{N}']\")?.dataset.status === 'unlocked'", timeout=10000)
    settle(pad)
    pad.screenshot(path=str(IMG / "7_後台_解鎖後_1440.jpg"), full_page=True, type="jpeg", quality=80)
    dec = sql(f"select decision from target_decisions where target='share:{N}'")
    logs = sql("select action, target from admin_log order by id desc limit 5")
    check("7 解鎖寫進資料庫＋操作紀錄", dec and dec[0]["decision"] == "unlocked" and any(l["action"] == "解鎖" and l["target"] == f"share:{N}" for l in logs), (dec, logs))
    check("7 調門檻也有操作紀錄", len(sql("select id from admin_log where action='調整檢舉門檻'")) >= 1)
    st, _ = Bb.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 960})
    check("6 解鎖後 B 又能出價", st == 200)
    requests.post(B + "/api/admin/threshold", json={"value": 10}, headers=AD)

    # ---------- 8. 這裡沒有，我要新增 → 待審核 → 核准才出現 ----------
    st, sub = C.post("/api/catalog/submit", {"type": "series", "artist": "mountain-radio", "title": f"驗收系列{STAMP}", "seriesType": "專輯發行", "year": "2026"})
    key = sub.get("key", "")
    form_before = requests.get(B + "/share/new").text
    check("8 新增系列送出後是待審核、表單看不到", st == 201 and f"驗收系列{STAMP}" not in form_before, sub)
    st, sub_i = C.post("/api/catalog/submit", {"type": "item", "seriesKey": "mountain-radio/1", "kind": "毛巾", "edition": f"驗收毛巾{STAMP}"})
    st2, sub_a = C.post("/api/catalog/submit", {"type": "artist", "name": f"驗收藝人{STAMP}", "slug": f"verify-artist-{STAMP}"})
    check("8 新增品項、藝人也是待審核", st == 201 and st2 == 201 and requests.get(B + f"/artist/verify-artist-{STAMP}").status_code == 404, (sub_i, sub_a))
    pend = requests.get(B + "/api/admin", headers=AD).json()["pending"]
    for pnd in pend:
        if STAMP in pnd["title"] or STAMP in pnd["detail"] or pnd["detail"] in (sub_i.get("key"), f'{sub_i.get("key")}-v1'):
            requests.post(B + "/api/admin/submissions", json={"type": pnd["type"], "id": pnd["id"], "approve": True}, headers=AD)
    s_ok = requests.get(B + "/artist/" + key).status_code == 200
    a_ok = requests.get(B + f"/artist/verify-artist-{STAMP}").status_code == 200
    towel = f"驗收毛巾{STAMP}" in requests.get(B + "/artist/mountain-radio/1").text
    check("8 管理員核准後才出現（系列、品項＋版本、藝人）", s_ok and a_ok and towel, (s_ok, a_ok, towel))
    check("8 核准有操作紀錄", len(sql("select id from admin_log where action='核准新增'")) >= 3)

    # ---------- 9. 忘記密碼頻率限制 ----------
    codes = [requests.post(B + "/api/auth/forgot-password", json={"email": f"nobody{STAMP}@example.com", "turnstileToken": TT},
                           headers={"cf-connecting-ip": f"10.9.{i}.{int(STAMP) % 200}"}).status_code for i in range(7)]
    check("9 同一個 Email 每小時 5 次（第 6 次 429）", codes[:5] == [200] * 5 and codes[5] == 429, codes)
    ip = f"10.8.{int(STAMP) % 200}.1"
    codes = [requests.post(B + "/api/auth/forgot-password", json={"email": f"x{i}{STAMP}@example.com", "turnstileToken": TT},
                           headers={"cf-connecting-ip": ip}).status_code for i in range(12)]
    check("9 同一個 IP 每小時 10 次（第 11 次 429）", codes[:10] == [200] * 10 and codes[10] == 429, codes)

    # ---------- 10. 存在性檢查、實際計數 ----------
    st1, _ = A.post("/api/me/likes", {"share": 999999, "on": True})
    st2, _ = A.post("/api/me/holdings", {"kind": "owned", "key": "mountain-radio/1#cd-v99", "on": True})
    st3, _ = A.post("/api/me/follows", {"artist": "no-such-artist", "on": True})
    check("10 點讚／我有／追蹤不存在的對象 404", (st1, st2, st3) == (404, 404, 404), (st1, st2, st3))
    before = requests.get(B + f"/api/shares/{N}").json()["share"]["likes"]
    Bb.post("/api/me/likes", {"share": N, "on": True}); C.post("/api/me/likes", {"share": N, "on": True})
    after = requests.get(B + f"/api/shares/{N}").json()["share"]["likes"]
    db_count = sql(f"select count(*) n from likes where share_no={N}")[0]["n"]
    check("10 讚數＝資料庫實際計數", before == 0 and after == 2 == db_count, (before, after, db_count))
    vkey = "mountain-radio/1#cd-v1"
    own_db = sql(f"select count(*) n from holdings where target_key='{vkey}' and kind='owned'")[0]["n"]
    page = requests.get(B + "/artist/mountain-radio/1").text
    m = re.search(r'我有 <span class="num">(\d+)</span>', page)
    check("10 持有人數＝資料庫實際計數（訪客看）", m and int(m.group(1)) == own_db, (m and m.group(1), own_db))

    # ---------- 11. 設定頁 ----------
    pa.goto(B + "/settings"); settle(pa)
    pa.locator("#set-name").fill(f"改名{STAMP[-3:]}"); pa.locator(".settings-block button[type=submit]").first.click()
    pa.wait_for_selector(".field-ok", timeout=10000)
    check("11 改顯示名稱", sql(f"select name from users where id='{A.id}'")[0]["name"] == f"改名{STAMP[-3:]}")
    pa.locator("[data-testid=delete-box] button").click()
    pa.locator("#del-handle").fill(A.handle); pa.locator("#del-pw").fill(PW)
    pa.locator("[data-testid=delete-box] button[type=submit]").click()
    pa.wait_for_selector("[data-testid=delete-requested]", timeout=10000)
    check("11 刪除帳號確認流程（只記申請，帳號照常可用）", sql(f"select deletion_requested_at d from users where id='{A.id}'")[0]["d"] is not None)
    pa.screenshot(path=str(IMG / "11_設定_1440.jpg"), full_page=True, type="jpeg", quality=80)
    pa.locator("[data-testid=delete-box] button", has_text="取消申請").click(); pa.wait_for_timeout(800)
    st, e = A.post("/api/me/password", {"current": "wrong", "password": "new-pass-2026"})
    st2, _ = A.post("/api/me/password", {"current": PW, "password": "new-pass-2026"})
    check("11 改密碼（舊密碼錯擋下、對了成功）", st == 400 and st2 == 200, e)
    st, _ = A.get("/api/me/state")
    web_state = pa.evaluate("fetch('/api/me').then(r=>r.json()).then(j=>!!j.user)")
    check("11 改密碼後這個裝置保持登入、其他裝置登出", st == 200 and web_state is False, (st, web_state))
    st, _ = A.post("/api/auth/logout-all")
    st2, _ = A.get("/api/me/state")
    check("11 登出所有裝置", st == 200 and st2 == 401)
    ca.close()

    # ---------- 12. 受影響頁 1440／390：溢出、console error ----------
    A.pw = "new-pass-2026"
    PAGES = [("首頁", "/"), ("首頁_最新", "/?sort=new"), ("單則_新發", f"/share/{N}"), ("單則_鎖定", "/share/8"), ("藝人", "/artist/mountain-radio"),
             ("藝人_維基", "/artist/elephant-gym"), ("系列", "/artist/mountain-radio/1"), ("標籤", "/tag/%E5%B1%B1%E7%B7%9A%E9%9B%BB%E5%8F%B0"),
             ("搜尋", "/search?q=%E5%A4%9C"), ("個人", "/u/" + A.handle), ("喜愛清單", "/me/likes"), ("表單", "/share/new"),
             ("私訊", "/messages"), ("私訊_對話", f"/messages/{r1['result']}"), ("設定", "/settings"), ("後台", "/admin")]
    for who in ("訪客", "登入"):
        for wdt in (1440, 390):
            c, pg = new_ctx(wdt, 900)
            if who == "登入":
                ui_login(pg, A)
            for name, url in PAGES:
                start = len(errs)
                pg.goto(B + url); settle(pg)
                sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
                pg.screenshot(path=str(IMG / f"{who}_{name}_{wdt}.jpg"), full_page=True, type="jpeg", quality=80)
                own = [e for e in errs[start:] if "challenges.cloudflare.com" not in e[2]]
                R["pages"][f"{who}_{name}_{wdt}"] = {"url": url, "sw": sw, "iw": iw, "errors": own}
            c.close()
    over = [k for k, v in R["pages"].items() if v["sw"] > v["iw"]]
    bad = {k: v["errors"] for k, v in R["pages"].items() if v["errors"]}
    check(f"12 {len(R['pages'])} 個畫面無橫向溢出", not over, over)
    check("12 console error 0（不含 Turnstile iframe）", not bad, bad)
    # 管理員看後台（1440／390）
    for wdt in (1440, 390):
        pad.set_viewport_size({"width": wdt, "height": 900}); pad.goto(B + "/admin"); settle(pad)
        sw, iw = pad.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        pad.screenshot(path=str(IMG / f"管理員_後台_{wdt}.jpg"), full_page=True, type="jpeg", quality=80)
        R["pages"][f"管理員_後台_{wdt}"] = {"url": "/admin", "sw": sw, "iw": iw, "errors": []}
        check(f"12 管理員後台 {wdt} 無溢出", sw <= iw, (sw, iw))
    cad.close()
    br.close()

ok = sum(c["ok"] for c in R["checks"])
R["summary"] = f"{ok}/{len(R['checks'])}"
print("通過", R["summary"])
(HERE / "result.json").write_text(json.dumps(R, ensure_ascii=False, indent=2))
