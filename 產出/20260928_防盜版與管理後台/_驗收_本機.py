# 防盜版＋管理後台 本機驗收（建置版 npm start --port 8791）。
# 用法：python3 _驗收_本機.py http://127.0.0.1:8791 <網站資料夾>
# 本機測試模式（LOCAL_TEST=1）：x-yz-test-country 表頭／yz_test_country cookie 模擬國家；x-yz-rl-test 表頭的值當假 IP 測限流。
# 會新增測試資料（收藏、出價、照片、帳號），可重跑：每次用新的時間戳命名；改過的設定（每日上限、停權）都還原。
import hashlib, io, json, subprocess, sys, time, re, random
from pathlib import Path
import requests
from PIL import Image
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
OUT = Path(__file__).parent; IMG = OUT / "img"; IMG.mkdir(exist_ok=True)
res = []
def check(n, ok, d=""):
    res.append((n, bool(ok))); print(("PASS " if ok else "FAIL ") + n, str(d)[:260])

def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True, check=True)
    return json.loads(r.stdout[r.stdout.index("["):])[0]["results"]

class U:
    def __init__(self, email, cc="TW"):
        r = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}, headers={"x-yz-test-country": cc})
        self.tok = r.json()["token"]; self.cc = cc; self.email = email
    def h(self, cc=None): return {"Authorization": f"Bearer {self.tok}", "x-yz-test-country": cc or self.cc}
    def get(self, p, cc=None): return requests.get(B + p, headers=self.h(cc))
    def post(self, p, body, cc=None): return requests.post(B + p, json=body, headers=self.h(cc))
    def patch(self, p, body, cc=None): return requests.patch(B + p, json=body, headers=self.h(cc))

def img_bytes(w, h, color, fmt="WEBP"):
    b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, fmt, quality=80); return b.getvalue()

def upload(u, cc=None):
    main, thumb = img_bytes(1200, 900, (32, 32, 36)), img_bytes(480, 360, (32, 32, 36))
    r = requests.post(B + "/api/uploads", headers=u.h(cc), files={"image": ("p.webp", main, "image/webp"), "thumb": ("t.webp", thumb, "image/webp")}, data={"purpose": "share"})
    return r.json(), main, thumb

def cv(): return sql("SELECT v FROM content_version WHERE id=1")[0]["v"]

stamp = str(int(time.time()))[-6:]
seller, buyer, hk, cn = U("r01@demo.yinzang.test"), U("r02@demo.yinzang.test"), U("r03@demo.yinzang.test", "HK"), U("r04@demo.yinzang.test", "CN")
admin = U("admin@demo.yinzang.test")

# ---------- A1 連線國家 ----------
geo = {cc: seller.get("/api/me", cc).json()["geo"] for cc in ["TW", "HK", "CN"]}
check("A1 /api/me 模擬 TW／HK／CN 的連線國家與能否交易", geo["TW"] == {"country": "TW", "canTrade": True} and geo["HK"]["canTrade"] is False and geo["CN"] == {"country": "CN", "canTrade": False}, geo)
# 註冊記國家
email = f"geo{stamp}@demo.yinzang.test"
r = requests.post(B + "/api/auth/register", json={"email": email, "password": "yinzang-demo", "handle": f"geo{stamp}", "name": f"香港{stamp}", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}, headers={"x-yz-test-country": "HK"})
g = sql(f"SELECT g.register_country r FROM user_geo g JOIN users u ON u.id=g.user_id WHERE u.email='{email}'")
check("A1 註冊時記錄國家（HK）", r.status_code == 201 and g and g[0]["r"] == "HK", (r.status_code, g))
g = sql("SELECT g.last_login_country l FROM user_geo g JOIN users u ON u.id=g.user_id WHERE u.handle='r03'")
check("A1 登入時記錄最近一次國家（r03 從 HK 登入）", g and g[0]["l"] == "HK", g)

# ---------- A2 交易只限台灣（API 層） ----------
up, MAIN, THUMB = upload(seller)
r = seller.post("/api/shares", {"photoIds": [up["id"]], "about": ["山線"], "kind": "CD", "story": f"驗收 {stamp}", "sale": {"state": "sale", "price": 1200}})
N = r.json().get("n"); check("A2 台灣發文直接定價出售 201", r.status_code == 201, r.text)
up_hk, _, _ = upload(hk)
r_hk_sale = hk.post("/api/shares", {"photoIds": [up_hk["id"]], "about": ["山線"], "kind": "CD", "sale": {"state": "sale", "price": 500}})
r_hk_share = hk.post("/api/shares", {"photoIds": [up_hk["id"]], "about": ["山線"], "kind": "CD", "story": f"香港驗收 {stamp}"})
check("A2 海外發文設出售 403＋交易僅限台灣地區；純分享 201（海外可發炫收藏）",
      r_hk_sale.status_code == 403 and r_hk_sale.json()["error"]["message"] == "交易僅限台灣地區" and r_hk_share.status_code == 201, (r_hk_sale.text, r_hk_share.status_code))
HKN = r_hk_share.json().get("n")
blocked = {}
for who, u in [("HK", hk), ("CN", cn)]:
    r = u.post(f"/api/shares/{N}/offers", {"kind": "buy"}); blocked[f"{who} 我要買"] = (r.status_code, r.json()["error"]["message"])
r = buyer.post(f"/api/shares/{N}/offers", {"kind": "buy"}); tw_buy = r.status_code
blocked["HK 賣家改開放出價"] = (seller.patch(f"/api/shares/{N}", {"state": "offer"}, "HK").status_code,)
tw_patch = seller.patch(f"/api/shares/{N}", {"state": "offer"}).status_code
for who, u in [("HK", hk), ("CN", cn)]:
    r = u.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 800}); blocked[f"{who} 出價"] = (r.status_code, r.json()["error"]["message"])
r = buyer.post(f"/api/shares/{N}/offers", {"kind": "offer", "price": 900}); tw_offer = r.status_code
OID = [o for o in buyer.get(f"/api/shares/{N}").json()["offers"] if o["buyer"]["handle"] == "r02"][0]["id"]
blocked["HK 接受"] = (seller.post(f"/api/offers/{OID}/respond", {"answer": "accepted"}, "HK").status_code,)
blocked["CN 接受"] = (seller.post(f"/api/offers/{OID}/respond", {"answer": "accepted"}, "CN").status_code,)
tw_accept = seller.post(f"/api/offers/{OID}/respond", {"answer": "accepted"}).status_code
blocked["HK 成交"] = (seller.post(f"/api/shares/{N}/close", {"offerId": OID}, "HK").status_code,)
tw_close = seller.post(f"/api/shares/{N}/close", {"offerId": OID}).status_code
blocked["HK 改回出售中"] = (seller.post(f"/api/shares/{N}/reopen", {}, "HK").status_code,)
tw_reopen = seller.post(f"/api/shares/{N}/reopen", {}).status_code
blocked["HK 改價"] = (seller.patch(f"/api/shares/{N}", {"state": "sale", "price": 1500}, "HK").status_code,)
tw_price = seller.patch(f"/api/shares/{N}", {"state": "sale", "price": 1500}).status_code
check("A2 海外（HK、CN）出價、我要買、接受、成交、改價、改回出售中全部 403", all(v[0] == 403 for v in blocked.values()) and all(v[1] == "交易僅限台灣地區" for v in blocked.values() if len(v) > 1), blocked)
check("A2 台灣同樣的動作全部成功（我要買、開放出價、出價、接受、成交、改回、改價）", [tw_buy, tw_patch, tw_offer, tw_accept, tw_close, tw_reopen, tw_price] == [200] * 7, [tw_buy, tw_patch, tw_offer, tw_accept, tw_close, tw_reopen, tw_price])
# 海外其他功能正常
like = hk.post("/api/me/likes", {"share": N, "on": True}).status_code
th = hk.post(f"/api/shares/{N}/threads", {}); tid = th.json().get("result")
msg = hk.post(f"/api/threads/{tid}/messages", {"text": "海外可以私訊嗎"}).status_code
hold = cn.post("/api/me/holdings", {"kind": "wanted", "key": "mountain-radio/1#cd-v1", "on": True}).status_code
page = requests.get(f"{B}/share/{N}", headers={"x-yz-test-country": "CN"}).status_code
check("A2 海外可以瀏覽、點讚、私訊、想要", [page, like, th.status_code, msg, hold] == [200, 200, 200, 200, 200], [page, like, th.status_code, msg, hold])
cn.post("/api/me/holdings", {"kind": "wanted", "key": "mountain-radio/1#cd-v1", "on": False})

# 所在地區顯示
offers = buyer.get(f"/api/shares/{N}").json()["offers"]
t = seller.get(f"/api/threads/{tid}").json()["thread"]
prof = requests.get(f"{B}/u/r03").text
check("A1 出價列表顯示所在地區（r02 台灣）", any(o["buyer"]["handle"] == "r02" and o["region"] == "台灣" for o in offers), offers)
check("A1 私訊標題的所在地區（買家 r03 香港、賣家 r01 台灣）", t.get("buyerRegion") == "香港" and t.get("sellerRegion") == "台灣", t)
check("A1 個人頁顯示所在地區（r03 香港）", "所在地區" in prof and "香港" in prof)

# ---------- A3 照片分級與浮水印 ----------
main_url, thumb_url = f"{B}{up['url']}", f"{B}{up['thumbUrl']}"
anon_main = requests.get(main_url); anon_thumb = requests.get(thumb_url)
check("A3 未登入打大圖端點 401＋說明", anon_main.status_code == 401 and "登入後查看大圖" in anon_main.text, (anon_main.status_code, anon_main.text))
check("A3 未登入縮圖 200", anon_thumb.status_code == 200)
bm = requests.get(main_url, headers=buyer.h())
check("A3 登入會員大圖 200、Cache-Control private", bm.status_code == 200 and bm.headers.get("cache-control", "").startswith("private"), (bm.status_code, bm.headers.get("cache-control")))
check("A3 檔案本身沒有浮水印：大圖、縮圖跟上傳的位元組完全相同（sha256）",
      hashlib.sha256(bm.content).hexdigest() == hashlib.sha256(MAIN).hexdigest() and hashlib.sha256(anon_thumb.content).hexdigest() == hashlib.sha256(THUMB).hexdigest())
sql("INSERT INTO settings (key, value) VALUES ('daily_photo_limit', '3') ON CONFLICT(key) DO UPDATE SET value='3'")
codes = [requests.get(main_url, headers=cn.h()).status_code for _ in range(4)]
sql("DELETE FROM settings WHERE key='daily_photo_limit'")
check("A5 大圖每日上限（暫設 3）：第 4 次 429", codes[:3] == [200] * 3 and codes[3] == 429, codes)

# ---------- A4 辨識細節 ----------
html = requests.get(f"{B}/artist/mountain-radio/1").text
bar = sql("SELECT v.barcode b, v.catalog c FROM versions v JOIN items i ON i.id=v.item_ref JOIN series s ON s.id=i.series_id WHERE s.artist_slug='mountain-radio' AND s.no=1 AND v.barcode NOT IN ('無條碼','') LIMIT 1")[0]
check("A4 公開頁面 HTML 不含條碼、目錄號", bar["b"] not in html and bar["c"] not in html, bar)
check("A4 未登入 /api/details 401＋登入後查看辨識細節", (lambda r: r.status_code == 401 and r.json()["error"]["message"] == "登入後查看辨識細節")(requests.get(f"{B}/api/details?series=mountain-radio/1")))
dj = buyer.get("/api/details?series=mountain-radio/1")
check("A4 登入 /api/details 200 含條碼", dj.status_code == 200 and bar["b"] in dj.text)
sql("INSERT INTO settings (key, value) VALUES ('daily_detail_limit', '2') ON CONFLICT(key) DO UPDATE SET value='2'")
codes = [cn.get("/api/details?series=mountain-radio/1").status_code for _ in range(3)]
sql("DELETE FROM settings WHERE key='daily_detail_limit'")
check("A5 辨識細節每日上限（暫設 2）：第 3 次 429", codes == [200, 200, 429], codes)

# ---------- A6 按讚不讓整頁快取失效 ----------
p = f"/share/{N}"
requests.get(B + p); h1 = requests.get(B + p).headers.get("x-yz-cache")
v0 = cv(); before = requests.get(f"{B}/api/counts?s={N}").json()["likes"][str(N)]
buyer.post("/api/me/likes", {"share": N, "on": True})
v1 = cv(); h2 = requests.get(B + p).headers.get("x-yz-cache"); after = requests.get(f"{B}/api/counts?s={N}").json()["likes"][str(N)]
dbn = sql(f"SELECT count(*) n FROM likes WHERE share_no={N}")[0]["n"]
check("A6 按讚後內容版本不變、整頁快取仍命中", v0 == v1 and h1 == "HIT" and h2 == "HIT", (v0, v1, h1, h2))
check("A6 /api/counts 讚數跟資料庫一致（+1）", after == before + 1 == dbn, (before, after, dbn))
mine = buyer.get(f"/api/counts?s={N}").json()["likes"][str(N)]
check("A6 登入者拿到的是扣掉自己的人數", mine == dbn - 1, (mine, dbn))

# ---------- A5 防爬（IP 限流） ----------
crawl = [requests.get(f"{B}/artists", headers={"x-yz-rl-test": f"crawler{stamp}"}) for _ in range(40)]
codes = [r.status_code for r in crawl]; first = codes.index(429) if 429 in codes else -1
blocked_r = crawl[first] if first >= 0 else None
check("A5 同一 IP 連續狂抓 40 頁 → 429＋說明＋Retry-After", first >= 0 and "請求太頻繁" in blocked_r.text and blocked_r.headers.get("retry-after"), (first, codes.count(429)))
still = requests.get(f"{B}/", headers={"x-yz-rl-test": f"crawler{stamp}"}).status_code
check("A5 被擋後 60 秒內其他頁也 429", still == 429, still)
share_nos = [x["n"] for x in sql("SELECT no n FROM shares WHERE hidden_at IS NULL AND deleted_at IS NULL ORDER BY no DESC LIMIT 30")]
thumbs = [x["k"] for x in sql("SELECT thumb_key k FROM photos WHERE purpose='share' AND deleted_at IS NULL AND share_no IS NOT NULL LIMIT 24")]
human = f"human{stamp}"; hc = []; t0 = time.time()
pages = ["/", "/artists", "/artist/mountain-radio", "/artist/mountain-radio/1"] + [f"/share/{n}" for n in share_nos]
for i in range(30):
    H = {"x-yz-rl-test": human}
    hc.append(requests.get(B + pages[i % len(pages)], headers=H).status_code)
    hc += [requests.get(B + "/api/me", headers=H).status_code, requests.get(f"{B}/api/counts?s=1", headers=H).status_code]
    hc += [requests.get(B + pages[(i + k) % len(pages)], headers={**H, "rsc": "1", "next-router-prefetch": "1"}).status_code for k in range(20)]
    hc += [requests.get(f"{B}/img/{k}", headers=H).status_code for k in thumbs]
    time.sleep(max(0, t0 + (i + 1) * 2 - time.time()))
check(f"A5 一般瀏覽（2 秒一頁 × 30 頁，每頁帶 2 支 API、20 個預先載入、{len(thumbs)} 張縮圖，共 {len(hc)} 個請求）不會 429", 429 not in hc, f"{round(time.time()-t0)} 秒，429 次數 {hc.count(429)}")

# ---------- B 管理後台 ----------
st = admin.get("/api/admin/stats?fresh=1").json(); S = st["stats"]
db = {
    "總會員": sql("SELECT count(*) n FROM users")[0]["n"],
    "炫收藏": sql("SELECT count(*) n FROM shares WHERE deleted_at IS NULL")[0]["n"],
    "照片": sql("SELECT count(*) n FROM photos WHERE deleted_at IS NULL AND purpose='share'")[0]["n"],
    "出價": sql("SELECT count(*) n FROM offers")[0]["n"],
    "成交": sql("SELECT count(*) n FROM deals WHERE voided_at IS NULL")[0]["n"],
    "成交金額": sql("SELECT coalesce(sum(price),0) n FROM deals WHERE voided_at IS NULL")[0]["n"],
    "30 天活躍": sql("SELECT count(DISTINCT user_id) n FROM user_activity WHERE day >= date('now','-29 days')")[0]["n"],
    "今日新註冊": sql("SELECT count(*) n FROM users WHERE date(created_at,'+8 hours') = date('now','+8 hours')")[0]["n"],
    "待處理申訴": sql("SELECT count(*) n FROM appeals WHERE status='pending'")[0]["n"],
}
dash = {"總會員": S["members"]["total"], "炫收藏": S["content"]["shares"], "照片": S["content"]["photos"], "出價": S["trade"]["offers"], "成交": S["trade"]["deals"],
        "成交金額": S["trade"]["amount"], "30 天活躍": S["members"]["active30"], "今日新註冊": S["members"]["today"], "待處理申訴": st["queue"]["appeals"]}
for k in db: check(f"B1 儀表板「{k}」＝資料庫直接查", db[k] == dash[k], (dash[k], db[k]))
check("B1 國家分布加總＝總會員", sum(r["n"] for r in S["regions"]) == S["members"]["total"], S["regions"])
check("B1 30 天趨勢 30 個點、累計會員最後一點＝總會員", len(S["trend"]) == 30 and S["trend"][-1]["members"] == S["members"]["total"])
t_1 = time.time(); admin.get("/api/admin/stats"); cached = admin.get("/api/admin/stats").json()["cached"]
check("B5 儀表板第二次讀快取（cached=true）", cached is True)
check("B6 一般會員打後台 API 403、未登入 401", buyer.get("/api/admin/stats").status_code == 403 and requests.get(f"{B}/api/admin/stats").status_code == 401
      and buyer.get("/api/admin/members").status_code == 403 and requests.get(f"{B}/api/admin/usage").status_code == 401)
# 會員管理
mem = admin.get("/api/admin/members?q=r05").json()["members"]
row = [m for m in mem if m["handle"] == "r05"][0]
check("B3 會員搜尋 r05，欄位齊全且不含私訊內容", set(["name", "email", "createdAt", "region", "verified", "posts", "deals", "reported", "threads", "status"]) <= set(row) and "messages" not in json.dumps(row), row)
tid_count = sql("SELECT count(*) n FROM threads t JOIN shares s ON s.no=t.share_no WHERE t.buyer_id=(SELECT id FROM users WHERE handle='r03') OR s.author_id=(SELECT id FROM users WHERE handle='r03')")[0]["n"]
r03 = [m for m in admin.get("/api/admin/members?q=r03").json()["members"] if m["handle"] == "r03"][0]
check("B3 對話數＝資料庫（r03）", r03["threads"] == tid_count, (r03["threads"], tid_count))
sus = admin.post("/api/admin/members", {"id": row["id"], "action": "suspend", "reason": "驗收測試"})
login_after = requests.post(B + "/api/auth/login", json={"email": "r05@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"})
logrow = sql("SELECT action, detail FROM admin_log WHERE target='user:r05' ORDER BY id DESC LIMIT 1")
res_ = admin.post("/api/admin/members", {"id": row["id"], "action": "restore", "reason": ""})
st_after = sql("SELECT status FROM users WHERE handle='r05'")[0]["status"]
check("B3 停權：狀態 suspended、不能登入、有操作紀錄；恢復後 active", sus.status_code == 200 and login_after.status_code != 200 and logrow and logrow[0]["action"] == "停權會員" and res_.status_code == 200 and st_after == "active",
      (sus.status_code, login_after.status_code, logrow, st_after))
check("B3 不能停權管理員", admin.post("/api/admin/members", {"id": sql("SELECT id FROM users WHERE handle='yzadmin'")[0]["id"], "action": "suspend", "reason": "x"}).status_code == 403)
u = admin.get("/api/admin/usage").json()
check("B4 用量：R2 容量＝counters、暫停狀態、Cloudflare 未設定", u["r2"]["used"] == sql("SELECT value v FROM counters WHERE key='r2_bytes'")[0]["v"] and u["paused"]["on"] is False and u["cloudflare"]["configured"] is False, (u["r2"], u["cloudflare"]))

# ---------- 瀏覽器 ----------
errs = []
def ctx_for(br, w, tok=None, cc=None):
    c = br.new_context(viewport={"width": w, "height": 900 if w > 500 else 844}, accept_downloads=True)
    cookies = []
    if tok: cookies.append({"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True})
    if cc: cookies.append({"name": "yz_test_country", "value": cc, "domain": "127.0.0.1", "path": "/"})
    if cookies: c.add_cookies(cookies)
    return c
def page_of(c):
    pg = c.new_page(); pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160])); pg.on("pageerror", lambda e: errs.append(str(e)[:160])); return pg
def settle(pg):
    pg.wait_for_load_state("networkidle"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(400)
def overflow(pg): return pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

with sync_playwright() as p:
    br = p.chromium.launch()
    # 未登入：縮圖＋浮水印、點照片跳登入、辨識細節被擋
    c = ctx_for(br, 1440); pg = page_of(c)
    pg.goto(f"{B}/share/{N}"); settle(pg)
    src = pg.locator(".detail-photo img").first.get_attribute("src") or ""
    wm = pg.locator(".detail-photo [data-testid=watermark]").first
    check("A3 未登入單則頁是縮圖、浮水印 @r01 · 樂迷藏 顯示", "_t." in src and wm.is_visible() and wm.inner_text() == "@r01 · 樂迷藏", (src, wm.inner_text()))
    card_wm = pg.locator(".card [data-testid=watermark]").count()
    pg.click("[data-testid=photo-open]"); pg.wait_for_timeout(400)
    check("A3 未登入點照片 → 登入面板（不開大圖）", pg.locator("[data-testid=lightbox]").count() == 0 and pg.get_by_text("登入後可以點開大圖").count() > 0)
    pg.goto(f"{B}/"); settle(pg)
    check("A3 首頁卡片縮圖都有浮水印", pg.locator(".card img").count() > 0 and pg.locator(".card [data-testid=watermark]").count() == pg.locator(".card img").count(), (pg.locator(".card img").count(), pg.locator(".card [data-testid=watermark]").count()))
    pg.goto(f"{B}/artist/mountain-radio/1"); settle(pg)
    check("A4 未登入系列頁顯示「登入後查看辨識細節」、看不到條碼", pg.locator("[data-testid=details-gate]").count() > 0 and pg.locator("[data-testid=details]").count() == 0 and bar["b"] not in pg.content())
    pg.screenshot(path=str(IMG / "系列頁_未登入_辨識細節.jpg"), type="jpeg", quality=80); c.close()

    # 登入：大圖＋浮水印、辨識細節（分享圖 2026-09-28 拿掉）
    c = ctx_for(br, 1440, buyer.tok); pg = page_of(c)
    pg.goto(f"{B}/artist/mountain-radio/1"); settle(pg); pg.wait_for_selector("[data-testid=details]")
    check("A4 登入系列頁看得到辨識細節（含條碼）", pg.locator("[data-testid=details]").count() > 0 and bar["b"] in pg.content())
    pg.screenshot(path=str(IMG / "系列頁_登入_辨識細節.jpg"), type="jpeg", quality=80)
    pg.goto(f"{B}/share/{N}"); settle(pg)
    pg.click("[data-testid=photo-open]"); pg.wait_for_selector("[data-testid=lightbox-img]")
    lb = pg.evaluate("(() => { const i = document.querySelector('[data-testid=lightbox-img]'); return [i.naturalWidth, i.naturalHeight]; })()")
    lwm = pg.locator("[data-testid=lightbox] [data-testid=watermark]")
    check("A3 登入點開大圖 1200px 原檔＋浮水印疊在上面", lb[0] == 1200 and lwm.is_visible() and lwm.inner_text() == "@r01 · 樂迷藏", lb)
    pg.screenshot(path=str(IMG / "大圖_浮水印.jpg"), type="jpeg", quality=80)
    pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # 2026-09-28 改：「下載分享圖」整個拿掉（使用者：分享只要放連結），浮水印只留在顯示與連結預覽圖
    check("A3 下載分享圖已拿掉（2026-09-28），單則頁只剩分享按鈕", pg.locator("[data-testid=share-image-btn]").count() == 0 and pg.locator("[data-testid=share-btn]").count() == 1)
    c.close()

    # 海外：交易按鈕換成「交易僅限台灣地區」
    c = ctx_for(br, 1440, hk.tok, "HK"); pg = page_of(c)
    pg.goto(f"{B}/share/{N}"); settle(pg)
    check("A2 香港連線看定價出售：顯示「交易僅限台灣地區」、沒有我要買", pg.locator("[data-testid=region-note]").count() > 0 and pg.get_by_role("button", name="我要買").count() == 0)
    pg.screenshot(path=str(IMG / "海外_交易僅限台灣.jpg"), type="jpeg", quality=80)
    pg.goto(f"{B}/messages/{tid}"); settle(pg)
    check("A1 私訊標題顯示對方所在地區（賣家 台灣）", "所在地區 台灣" in pg.locator(".pin-sub").inner_text(), pg.locator(".pin-sub").inner_text())
    c.close()
    c = ctx_for(br, 1440, buyer.tok, "TW"); pg = page_of(c)
    pg.goto(f"{B}/share/{N}"); settle(pg)
    check("A2 台灣連線：交易按鈕照常、沒有提示", pg.locator("[data-testid=region-note]").count() == 0 and pg.locator(".deal").count() > 0)
    # 按讚：畫面數字＝資料庫；重新整理仍正確
    before_ui = int(pg.locator(".detail-by .like .num").inner_text())
    pg.click(".detail-by .like"); pg.wait_for_timeout(800)
    after_ui = int(pg.locator(".detail-by .like .num").inner_text())
    dbn = sql(f"SELECT count(*) n FROM likes WHERE share_no={N}")[0]["n"]
    pg.reload(); settle(pg); pg.wait_for_timeout(600)
    reload_ui = int(pg.locator(".detail-by .like .num").inner_text())
    hdr = requests.get(f"{B}/share/{N}").headers.get("x-yz-cache")
    check("A6 瀏覽器按讚：數字即時變、重新整理後＝資料庫、整頁仍命中快取", after_ui == dbn and reload_ui == dbn and after_ui != before_ui and hdr == "HIT", (before_ui, after_ui, reload_ui, dbn, hdr))
    c.close()

    # 管理後台：一般會員進不去；管理員看儀表板
    c = ctx_for(br, 1440, buyer.tok); pg = page_of(c)
    pg.goto(f"{B}/admin"); settle(pg)
    check("B6 一般會員開 /admin 只看到「只有管理員進得去」", pg.locator("[data-testid=admin-denied]").count() == 1 and pg.locator("[data-testid=dashboard]").count() == 0)
    c.close()

    # 溢出：1440／390
    shots = {"單則頁": f"/share/{N}", "系列頁": "/artist/mountain-radio/1", "個人頁": "/u/r03", "儀表板": "/admin", "會員": "/admin/members", "審核與下架": "/admin/moderation", "私訊": f"/messages/{tid}"}
    for w in (1440, 390):
        c = ctx_for(br, w, admin.tok if True else None); pg = page_of(c)
        for name, path in shots.items():
            tok_ctx = c
            if name == "私訊":
                c2 = ctx_for(br, w, hk.tok, "HK"); pg2 = page_of(c2); pg2.goto(B + path); settle(pg2); ov = overflow(pg2)
                pg2.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=True); c2.close()
            else:
                pg.goto(B + path); settle(pg)
                if name == "儀表板": pg.wait_for_selector("[data-testid=usage]", timeout=15000)
                if name == "會員": pg.wait_for_selector("[data-testid=members-table] tbody tr", timeout=15000)
                ov = overflow(pg); pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=True)
            check(f"溢出 {w} {name}", ov <= 0, ov)
        c.close()
    br.close()

check("console error 0", not errs, errs[:5])
ok = sum(1 for _, x in res if x); print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"stamp": stamp, "share": N, "hk_share": HKN, "result": res}, ensure_ascii=False, indent=1), encoding="utf-8")
