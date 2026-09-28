# 周邊選擇流程＋回報入口：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 可重跑：每次自己建新藝人、新會員（帳號名帶時間戳），不碰既有資料；檢舉門檻暫調成 2，跑完改回原值
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
HOST = B.split("//")[1].split(":")[0]
TURNSTILE_STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){}};"


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


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email, "name": j["user"]["name"]}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
sql("DELETE FROM rate_limits WHERE key LIKE 'register:%' OR key LIKE 'submit:%' OR key LIKE 'share:%' OR key LIKE 'report:%' OR key LIKE 'error-report:%' OR key LIKE 'login:%'")
admin = login("admin@demo.yinzang.test")
AH = H(admin)
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")


def mkuser(tag, verified=True):
    h = f"q{tag}{ST}"
    uid = f"u-{h}"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@q.test', '{iso(NOW)}', '{PW}', '{h}', '回報{tag}{ST}', '{iso(NOW)}', '{iso(NOW)}')")
    u = login(f"{h}@q.test")
    if not verified:
        sql(f"UPDATE users SET email_verified_at = NULL WHERE id = '{uid}'")
    return u


def img_bytes(w, h, color, fmt="WEBP"):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, fmt, quality=80)
    return b.getvalue()


def upload(u, purpose="share", color=(120, 60, 60)):
    r = requests.post(B + "/api/uploads", headers=H(u), files={"image": ("p.webp", img_bytes(800, 600, color), "image/webp"), "thumb": ("t.webp", img_bytes(320, 240, color), "image/webp")}, data={"purpose": purpose})
    return r.json()["id"]


def post_share(u, body):
    return requests.post(B + "/api/shares", headers=H(u), json={"photoIds": [upload(u)], "about": [ANAME], "story": "", "tags": [], "sale": {"state": "share"}, **body})


def page(path, **kw):
    return requests.get(B + path, allow_redirects=False, **kw)


def share(no):
    return sql(f"SELECT * FROM shares WHERE no = {no}")[0]


JPG = OUT / "img" / "_upload.jpg"
Image.new("RGB", (1200, 900), (60, 110, 160)).save(JPG, "JPEG", quality=80)

# ============================ 準備：新藝人（有一張專輯：CD 一個版本）、會員 ============================
A = f"qa{ST}"
ANAME = f"驗收藝人{ST}"
A2 = f"qb{ST}"
sql(f"INSERT INTO artists (slug, name, aliases, kind, status, display) VALUES ('{A}', '{ANAME}', '[]', '藝人', 'approved', 'auto'), ('{A2}', '驗收藝人乙{ST}', '[]', '藝人', 'approved', 'auto')")
sql(f"INSERT INTO series (artist_slug, no, title, name, series_type, kind, credits, year, status) VALUES "
    f"('{A}', 1, '驗收專輯', '2020《驗收專輯》專輯發行', '專輯發行', 'album', '[\"{A}\"]', '2020', 'approved')")
SID = one(f"SELECT id FROM series WHERE artist_slug = '{A}' AND no = 1")
sql(f"INSERT INTO items (series_id, item_id, kind, status) VALUES ({SID}, 'cd', 'CD', 'approved')")
IID = one(f"SELECT id FROM items WHERE series_id = {SID} AND item_id = 'cd'")
sql(f"INSERT INTO versions (item_ref, version_id, edition, year, status) VALUES ({IID}, 'v1', '首版', '2020', 'approved')")
M = mkuser("m")  # 發文的會員
check("0a 遷移：series 有 kind 欄、error_reports 表、shares.pending_series_id、reports.photo_id",
      one("SELECT COUNT(*) FROM pragma_table_info('series') WHERE name = 'kind'") == 1
      and one("SELECT COUNT(*) FROM sqlite_master WHERE name = 'error_reports'") == 1
      and one("SELECT COUNT(*) FROM pragma_table_info('shares') WHERE name = 'pending_series_id'") == 1
      and one("SELECT COUNT(*) FROM pragma_table_info('reports') WHERE name = 'photo_id'") == 1)
kinds = {r["series_type"]: r["kind"] for r in sql("SELECT DISTINCT series_type, kind FROM series WHERE kind != 'misc'")}
check("0b 既有系列回填類型：專輯→album、EP→ep、單曲→single、巡迴／演唱會→tour",
      kinds.get("專輯發行") == "album" and kinds.get("EP 發行") == "ep" and kinds.get("單曲發行") == "single" and kinds.get("演唱會巡迴") == "tour", kinds)
check("0c 沒有替全部藝人預先建「周邊與其他」（只有用過的藝人才有）",
      one("SELECT COUNT(*) FROM series WHERE kind = 'misc'") < one("SELECT COUNT(*) FROM artists WHERE status = 'approved'") and one(f"SELECT COUNT(*) FROM series WHERE kind = 'misc' AND artist_slug = '{A}'") == 0)


def ctx_for(browser, u=None, w=1280, h=900, mobile=False):
    c = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=TURNSTILE_STUB))
    if u:
        c.add_cookies([{"name": "yz_session", "value": u["tok"], "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")


def fill_top(p, kind):
    """照片、藝人（打字搜尋）、品項"""
    p.goto(B + "/share/new")
    settle(p)
    p.set_input_files("[data-testid=pp-input]", str(JPG))
    # [改寫] 新單頁表單：artist-search／artist-opt；品項按鈕用完全相同的字（「CD」不要對到別的）
    p.fill("[data-testid=artist-search]", ANAME)
    p.locator("[data-testid=artist-opt]", has_text=ANAME).first.click(timeout=15000)
    p.locator(f"[data-testid=pick-kind] button:text-is('{kind}')").click()


def publish(p):
    p.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
    return int(p.url.rsplit("/", 1)[1])


errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    # ============================ 1. 周邊掛演唱會：管理員新增演唱會 → 發毛巾 ============================
    c = ctx_for(br, admin)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("1", m.text)))
    fill_top(p, "毛巾")
    groups = p.locator("[data-testid=where] .sf-sec").all_inner_texts()  # [改寫] 組名節點 .where-title → .sf-sec
    check("1a 周邊類「屬於哪裡」分三組，依序：演唱會／巡迴、隨專輯發行的周邊、藝人自有品牌或周邊", groups == ["演唱會／巡迴", "隨專輯發行的周邊", "藝人自有品牌或周邊"], groups)
    album_in = p.locator("[data-testid=where-album] button", has_text="驗收專輯").count()
    misc_btn = p.locator("[data-testid=where-brand] button[data-series-kind=misc]")
    check("1b 隨專輯發行組列出這位藝人的專輯；自有品牌組有「周邊與其他」；有「不確定」",
          album_in == 1 and misc_btn.locator(".sf-row-name").inner_text() == "周邊與其他" and misc_btn.get_attribute("data-key") == f"misc:{A}"
          and p.locator("[data-testid=where] button[data-key=unsure]").count() == 1, (album_in, misc_btn.get_attribute("data-key")))
    # [改寫] 新增演唱會 → where-new-tour 打開新增框 new-box（名稱、年份、用這個名字）；存好後直接收成答案黑框 bar-where，
    # 選好的系列鍵改從「打開清單看 aria-pressed 那列」取得
    p.click("[data-testid=where-new-tour]")
    p.fill("[data-testid=new-box-name]", f"驗收巡迴{ST}")
    p.fill("[data-testid=new-box-year]", "2024")
    p.screenshot(path=str(IMG / "1_新增演唱會_1440.jpg"), type="jpeg", quality=80, full_page=True)
    p.click("[data-testid=new-box-save]")
    p.locator("[data-testid=bar-where]").wait_for(timeout=10000)
    p.click("[data-testid=bar-where-change]")
    if p.locator("[data-testid=rename-series-cancel]").count():  # [改寫] 自己剛新增的系列，「改」是改名框；按「換成別的」才回到清單
        p.click("[data-testid=rename-series-cancel]")
    tour_btn = p.locator("[data-testid=where-tour] button[aria-pressed=true]")
    tour_btn.wait_for(timeout=10000)
    TOURKEY = tour_btn.get_attribute("data-key")
    check("1c 管理員新增演唱會立即生效，而且直接選好", " ".join(tour_btn.inner_text().split()) == f"2024《驗收巡迴{ST}》演唱會巡迴" and TOURKEY.startswith(f"{A}/"), (tour_btn.inner_text(), TOURKEY))
    trow = sql(f"SELECT * FROM series WHERE artist_slug = '{A}' AND title = '驗收巡迴{ST}'")[0]
    check("1d 新系列 kind=tour、status=approved、年份 2024", trow["kind"] == "tour" and trow["status"] == "approved" and trow["year"] == "2024", trow)
    tour_btn.click()  # [改寫] 打開清單看完再點一次同一列收回
    N1 = publish(p)
    s1 = share(N1)
    check("1e 毛巾掛在這場演唱會：series_key 對、品項自動建成 towel、版本不確定",
          s1["series_key"] == TOURKEY and s1["item_id"] == "towel" and s1["version_id"] is None and s1["kind"] == "毛巾", {k: s1[k] for k in ("series_key", "item_id", "version_id", "kind", "what")})
    check("1f 標題「系列・品項」", s1["what"] == f"驗收巡迴{ST}・毛巾", s1["what"])
    p.goto(B + "/" + "artist/" + TOURKEY)
    settle(p)
    html = p.content()
    check("1g 系列頁標出類型「巡迴」、列出毛巾品項（還沒有版本）、看得到這則",
          p.locator("[data-testid=series-kind]").inner_text() == "巡迴" and p.locator("h2.item-title", has_text="毛巾").count() == 1
          and p.locator("[data-testid=item-no-version]").count() == 1 and f'/share/{N1}"' in html, p.locator("[data-testid=series-kind]").inner_text())
    p.screenshot(path=str(IMG / "1_系列頁_巡迴_1440.jpg"), type="jpeg", quality=80, full_page=True)
    c.close()

    # ============================ 2. 藝人自有周邊：自動建「周邊與其他」→ 發 T 恤 ============================
    c = ctx_for(br, M)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("2", m.text)))
    fill_top(p, "T 恤")
    p.locator(f"[data-testid=where-brand] button[data-key='misc:{A}']").click()
    p.screenshot(path=str(IMG / "2_周邊與其他_1440.jpg"), type="jpeg", quality=80, full_page=True)
    N2 = publish(p)
    misc = sql(f"SELECT * FROM series WHERE artist_slug = '{A}' AND kind = 'misc'")
    s2 = share(N2)
    check("2a 第一次用到才建「周邊與其他」：一個、直接生效、沒有年份", len(misc) == 1 and misc[0]["status"] == "approved" and misc[0]["title"] == "周邊與其他" and misc[0]["year"] == "", misc)
    MISCKEY = f"{A}/{misc[0]['no']}"
    check("2b T 恤掛在「周邊與其他」、品項 tshirt", s2["series_key"] == MISCKEY and s2["item_id"] == "tshirt" and s2["what"] == "周邊與其他・T 恤", {k: s2[k] for k in ("series_key", "item_id", "what")})
    # 同一位藝人再發一則：沿用同一個，不會多建
    fill_top(p, "海報")
    btn = p.locator(f"[data-testid=where-brand] button[data-series-kind=misc]")
    check("2c 已經建好的「周邊與其他」表單改用真的系列鍵", btn.get_attribute("data-key") == MISCKEY, btn.get_attribute("data-key"))
    btn.click()
    N2b = publish(p)
    check("2d 第二則沿用同一個「周邊與其他」", one(f"SELECT COUNT(*) FROM series WHERE artist_slug = '{A}' AND kind = 'misc'") == 1 and share(N2b)["series_key"] == MISCKEY)
    # 兩個請求同時要建（另一位藝人）：只會有一個
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(4) as ex:
        rs = list(ex.map(lambda i: requests.post(B + "/api/shares", headers=H(M), json={"photoIds": [upload(M)], "about": [f"驗收藝人乙{ST}"], "kind": "毛巾", "seriesKey": f"misc:{A2}", "sale": {"state": "share"}}), range(4)))
    check("2e 四個請求同時建同一位藝人的「周邊與其他」：全部成功、只有一個系列", all(r.status_code == 201 for r in rs) and one(f"SELECT COUNT(*) FROM series WHERE artist_slug = '{A2}' AND kind = 'misc'") == 1, [r.status_code for r in rs])
    p.goto(B + f"/artist/{A}")
    settle(p)
    tiles = p.locator("section.block", has=p.locator("h2", has_text="系列")).first.locator("li.tile .tile-title").all_inner_texts()
    tags = p.locator("section.block", has=p.locator("h2", has_text="系列")).first.locator("li.tile .kind-tag").all_inner_texts()
    check("2f 藝人頁「周邊與其他」排最後，每張卡標出類型", tiles and tiles[-1] == "周邊與其他" and tags[-1] == "周邊" and "巡迴" in tags and "專輯" in tags, (tiles, tags))
    p.screenshot(path=str(IMG / "2_藝人頁_1440.jpg"), type="jpeg", quality=80, full_page=True)
    p.goto(B + "/artist/" + MISCKEY)
    settle(p)
    check("2g「周邊與其他」系列頁標「周邊」、不出現補年份", p.locator("[data-testid=series-kind]").inner_text() == "周邊" and p.locator("text=補上發行年").count() == 0)
    r = requests.post(B + "/api/series/year", headers=H(M), json={"key": MISCKEY, "year": "2020"})
    check("2h「周邊與其他」API 也不能補年份", r.status_code == 400, r.text[:120])

    # ============================ 3. 會員新增系列：待審 → 核准 → 自動改掛 ============================
    # [改寫] 新表單的「找不到？新增」只有專輯、演唱會兩種，沒有「自有品牌」；新增後立即生效（事後審），沒有「審核中、先放不確定」。
    # 3a～3f 的操作在新表單做不出來，照原判斷記為不通過並寫明原因
    for n_ in ["3a 會員新增系列 → 提示審核中、這則先放「不確定」", "3b 系列待審（kind=brand、沒有年份）；收藏掛不確定並記著等哪個系列", "3c 待審系列前台看不到",
               "3d 編輯頁也看得到「審核中、先放不確定」", "3e 管理員核准 → 回報改掛 1 則；收藏自動改掛到新系列、品項 poster、標題重組", "3f 新系列頁出現、標「自有品牌」、看得到這則"]:
        check(n_, False, "新表單沒有這個操作：不能新增自有品牌系列，新增系列改事後審（上傳表單改版定案）")
    # 退回的路徑：另一個待審系列被退回 → 收藏維持不確定、清掉等待
    rr = requests.post(B + "/api/catalog/submit", headers=H(M), json={"type": "series", "artist": A, "title": f"驗收退回{ST}", "seriesKind": "tour", "year": "2023"})
    rid = rr.json()["id"]
    rs = post_share(M, {"kind": "場刊", "pendingSeriesId": rid})
    # [改寫] 事後審後新增的系列一建好就生效、沒有待審，掛 pendingSeriesId 的收藏發不出去（400）：照原判斷記為不通過，附回應
    if rs.status_code == 201:
        N3r = rs.json()["n"]
        requests.post(B + "/api/admin/submissions", headers=AH, json={"type": "series", "id": str(rid), "approve": False})
        s3r = share(N3r)
        check("3g 系列被退回：收藏維持不確定、等待標記清掉", s3r["series_key"] is None and s3r["pending_series_id"] is None, {k: s3r[k] for k in ("series_key", "pending_series_id")})
    else:
        check("3g 系列被退回：收藏維持不確定、等待標記清掉", False, f"發收藏 {rs.status_code} {rs.text[:120]}；新增系列回應 {rr.text[:120]}")
    other = mkuser("o")
    rr2 = requests.post(B + "/api/catalog/submit", headers=H(other), json={"type": "series", "artist": A, "title": f"別人的{ST}", "seriesKind": "brand", "year": ""})
    r = post_share(M, {"kind": "毛巾", "pendingSeriesId": rr2.json()["id"]})
    check("3h 不能掛到別人新增的待審系列", r.status_code == 400, r.text[:120])
    requests.post(B + "/api/admin/submissions", headers=AH, json={"type": "series", "id": str(rr2.json()["id"]), "approve": False})

    # ============================ 4. 唱片類舊流程 ============================
    fill_top(p, "CD")
    # [改寫] 清單列文字是「年份 名稱 類型」三段、「不確定」在清單外的 where-unsure：把兩者一起收、空白壓成一格
    rec = [" ".join(x.split()) for x in p.locator("[data-testid=where-record] button[data-key], [data-testid=where-unsure]").all_inner_texts()]
    check("4a 唱片類只列專輯／EP／單曲，外加不確定（不列巡迴、周邊與其他）",
          "2020《驗收專輯》專輯發行" in rec and "不確定" in rec and not any("巡迴" in x or "周邊與其他" in x for x in rec) and p.locator("[data-testid=where-tour]").count() == 0, rec)
    p.locator("[data-testid=where-record] button", has_text="驗收專輯").click()
    if p.locator("[data-testid=bar-version-change]").count():  # [改寫] 版本題預設收成答案，要先打開
        p.click("[data-testid=bar-version-change]")
    p.locator("[data-testid=pick-version] button", has_text="首版").click()
    p.screenshot(path=str(IMG / "4_唱片類_1440.jpg"), type="jpeg", quality=80, full_page=True)
    N4 = publish(p)
    s4 = share(N4)
    check("4b CD 掛專輯＞CD＞首版", s4["series_key"] == f"{A}/1" and s4["item_id"] == "cd" and s4["version_id"] == "v1" and s4["what"] == "驗收專輯・CD・首版", {k: s4[k] for k in ("series_key", "item_id", "version_id", "what")})
    r = post_share(M, {"seriesKey": f"{A}/1", "itemId": "cd", "versionId": "v1"})
    check("4c 舊版 API 寫法（只帶系列＋品項＋版本、不帶 kind）照樣收", r.status_code == 201 and share(r.json()["n"])["kind"] == "CD", r.text[:120])
    r = post_share(M, {"kind": "毛巾", "seriesKey": f"{A}/1", "itemId": "cd"})
    check("4d 品項跟類型對不上會擋（毛巾＋CD 品項）", r.status_code == 400, r.text[:120])
    r = post_share(M, {"kind": "CD"})
    check("4e 不確定（不選系列）照樣可以發", r.status_code == 201 and share(r.json()["n"])["series_key"] is None)
    r = post_share(M, {"kind": "其他周邊", "seriesKey": f"misc:{A}"})
    check("4f 其他周邊沒寫是什麼會擋，而且不會先建出任何東西", r.status_code == 400 and one(f"SELECT COUNT(*) FROM items i JOIN series s ON s.id = i.series_id WHERE s.artist_slug = '{A}' AND i.kind = '其他周邊'") == 0, r.text[:100])

    # ============================ 5. 編輯既有收藏用同一套流程 ============================
    p.goto(B + f"/share/{N2}/edit")
    settle(p)
    # [改寫] 編輯頁答過的題目收成答案黑框，先按「改」打開才看得到選中的按鈕
    p.click("[data-testid=bar-kind-change]")
    p.click("[data-testid=bar-where-change]")
    if p.locator("[data-testid=rename-series-cancel]").count():
        p.click("[data-testid=rename-series-cancel]")
    pre = (p.locator("[data-testid=pick-kind] button[aria-pressed=true]").inner_text(), p.locator("[data-testid=where] button[aria-pressed=true]").get_attribute("data-key"))
    check("5a 編輯頁帶入目前的品項與屬於哪裡", pre == ("T 恤", MISCKEY), pre)
    p.locator("[data-testid=pick-kind] button:text-is('毛巾')").click()
    if p.locator("[data-testid=bar-where-change]").count():
        p.click("[data-testid=bar-where-change]")
        if p.locator("[data-testid=rename-series-cancel]").count():
            p.click("[data-testid=rename-series-cancel]")
    p.locator(f"[data-testid=where-tour] button[data-key='{TOURKEY}']").click()
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(rf"/share/{N2}$"), timeout=30000)
    s5 = share(N2)
    check("5b 改成毛巾＋演唱會：沿用既有的 towel 品項", s5["series_key"] == TOURKEY and s5["item_id"] == "towel" and s5["kind"] == "毛巾", {k: s5[k] for k in ("series_key", "item_id", "kind")})
    c.close()

    # ============================ 6. 回報：七種原因分流 ============================
    th0 = one("SELECT value FROM settings WHERE key = 'report_threshold'") or "10"
    requests.post(B + "/api/admin/threshold", headers=AH, json={"value": 2})
    T = N4  # 回報對象：會員 M 的 CD
    tgt = f"share:{T}"
    reporters = [mkuser(f"r{i}") for i in range(8)]
    errs_before = one(f"SELECT COUNT(*) FROM error_reports WHERE share_no = {T}")
    out = {}
    for u, reason in zip(reporters[:4], ["wrong_info", "not_artist", "duplicate", "other"]):
        r = requests.post(B + "/api/reports", headers=H(u), json={"target": tgt, "reason": reason, "note": f"說明{reason}"})
        out[reason] = (r.status_code, r.json().get("kind"))
    check("6a 資料有誤、不是這位藝人、重複發文、其他 → 錯誤回報", all(v == (201, "error") for v in out.values()), out)
    check("6b 四筆錯誤回報只進 error_reports，reports 沒有多", one(f"SELECT COUNT(*) FROM error_reports WHERE share_no = {T}") == errs_before + 4 and one(f"SELECT COUNT(*) FROM reports WHERE target = '{tgt}'") == 0)
    check("6c 門檻暫調成 2，四筆錯誤回報後仍未鎖定", "多人檢舉" not in page(f"/share/{T}").text)
    r = requests.post(B + "/api/shares/%d/offers" % T, headers=H(reporters[5]), json={"kind": "offer", "price": 100})
    check("6d 錯誤回報不擋交易（未鎖定時出價不回 423）", r.status_code != 423, r.status_code)
    out = {}
    for u, reason in zip(reporters[4:7], ["fake", "scam", "improper"]):
        r = requests.post(B + "/api/reports", headers=H(u), json={"target": tgt, "reason": reason})
        out[reason] = (r.status_code, r.json().get("kind"))
    check("6e 疑似盜版仿冒、疑似詐騙、照片或文字不妥 → 檢舉", all(v == (201, "report") for v in out.values()), out)
    check("6f 三筆檢舉進 reports、達門檻（2）鎖定", one(f"SELECT COUNT(*) FROM reports WHERE target = '{tgt}'") == 3 and "多人檢舉" in page(f"/share/{T}").text)
    r = requests.post(B + "/api/reports", headers=H(reporters[4]), json={"target": tgt, "reason": "scam"})
    check("6g 同一則每人只能檢舉一次（409）", r.status_code == 409, r.text[:100])
    unv = mkuser("u", verified=False)
    r = requests.post(B + "/api/reports", headers=H(unv), json={"target": tgt, "reason": "fake"})
    r2 = requests.post(B + "/api/reports", headers=H(unv), json={"target": tgt, "reason": "wrong_info"})
    check("6h 未驗證 Email：檢舉不收（403），錯誤回報照收", r.status_code == 403 and r2.status_code == 201, (r.status_code, r2.status_code))
    r = requests.post(B + "/api/reports", headers=H(reporters[0]), json={"target": tgt, "reason": "wrong_info"})
    check("6i 同一人同一則錯誤回報第二次：回已收到、不多一筆", r.status_code == 201 and r.json().get("already") is True and one(f"SELECT COUNT(*) FROM error_reports WHERE share_no = {T} AND reporter_id = '{reporters[0]['id']}'") == 1)
    r = requests.post(B + "/api/reports", headers=H(reporters[7]), json={"target": tgt, "reason": "other", "note": "x" * 800})
    check("6j 補充說明超過 500 字截到 500", r.status_code == 201 and one(f"SELECT LENGTH(note) FROM error_reports WHERE share_no = {T} AND reporter_id = '{reporters[7]['id']}'") == 500)
    r = requests.post(B + "/api/reports", headers=H(M), json={"target": tgt, "reason": "fake"})
    check("6k 不能檢舉自己的收藏", r.status_code == 403)
    ok_before = one(f"SELECT COUNT(*) FROM score_events WHERE kind = 'report_ok' AND user_id IN ('{reporters[0]['id']}','{reporters[1]['id']}')")
    requests.post(B + "/api/admin/scores", headers=AH, json={})
    check("6m 分數規則照舊：檢舉成立的有 report_ok，錯誤回報的沒有",
          one(f"SELECT COUNT(*) FROM score_events WHERE kind = 'report_ok' AND user_id IN ('{reporters[0]['id']}','{reporters[1]['id']}','{reporters[2]['id']}','{reporters[3]['id']}')") == 0 == ok_before
          and one(f"SELECT COUNT(*) FROM score_events WHERE kind = 'report_ok' AND user_id = '{reporters[4]['id']}'") == 1)

    requests.post(B + "/api/admin/threshold", headers=AH, json={"value": int(th0)})
    check("6l 門檻改回原值", one("SELECT value FROM settings WHERE key = 'report_threshold'") == str(th0), th0)
    # ============================ 7. 回報對話框（桌機，登入者，附照片） ============================
    T2 = N1  # 管理員發的毛巾
    R = mkuser("d")
    c = ctx_for(br, R)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("7", m.text)))
    p.goto(B + f"/share/{T2}")
    settle(p)
    q = p.locator("[data-testid=question]")
    last = p.evaluate("() => { const q = document.querySelector('[data-testid=question]'); const m = q.closest('main'); return m.lastElementChild === q }")
    check("7a 單則頁最下方一行小字「對這則收藏有疑問嗎？」；原本的「檢舉這則」不在了",
          q.count() == 1 and last and p.locator("[data-testid=question-open]").inner_text() == "對這則收藏有疑問嗎？" and p.locator("text=檢舉這則").count() == 0)
    p.click("[data-testid=question-open]")
    d = p.locator("[data-testid=question-dialog]")
    d.wait_for()
    labels = d.locator(".q-reason span").all_inner_texts()
    check("7b 對話框：七個原因單選", len(labels) == 7 and labels[0] == "疑似盜版或仿冒品" and labels[-1] == "其他", labels)
    d.locator(".q-reason", has_text="資料有誤").click()
    d.locator("[data-testid=question-note]").fill("年份應該是 2023")
    d.locator("[data-testid=question-photo]").set_input_files(str(JPG))
    d.locator(".q-photo").wait_for(timeout=15000)
    p.screenshot(path=str(IMG / "7_回報對話框_1440.jpg"), type="jpeg", quality=80)
    d.locator("[data-testid=question-submit]").click()
    p.locator("[data-testid=question-done]").wait_for()
    check("7c 送出後顯示「已收到，謝謝你的回報」", p.locator("[data-testid=question-done]").inner_text() == "已收到，謝謝你的回報")
    er = sql(f"SELECT * FROM error_reports WHERE share_no = {T2} AND reporter_id = '{R['id']}'")
    check("7d 錯誤回報帶著補充說明與比對照片（照片不公開）",
          er and er[0]["note"] == "年份應該是 2023" and er[0]["photo_id"] and one(f"SELECT purpose FROM photos WHERE id = '{er[0]['photo_id']}'") == "appeal", er)
    pkey = one(f"SELECT r2_key FROM photos WHERE id = '{er[0]['photo_id']}'")
    check("7e 比對照片訪客打不開（只有本人與管理員）", page(f"/img/{pkey}").status_code in (401, 403, 404) and requests.get(B + f"/img/{pkey}", headers=AH).status_code == 200)
    p.keyboard.press("Escape")
    check("7f Esc 關掉對話框", p.locator("[data-testid=question-dialog]").count() == 0)
    p.click("[data-testid=question-open]")
    p.locator("[data-testid=question-dialog] .q-reason", has_text="疑似詐騙").click()
    p.locator("[data-testid=question-note]").fill("要求私下匯款")
    p.locator("[data-testid=question-submit]").click()
    p.locator("[data-testid=question-done]").wait_for()
    check("7g 從對話框送檢舉（疑似詐騙）→ 進 reports", one(f"SELECT reason FROM reports WHERE target = 'share:{T2}' AND reporter_id = '{R['id']}'") == "scam")
    c.close()
    c = ctx_for(br, admin)
    p = c.new_page()
    p.goto(B + f"/share/{T2}")
    settle(p)
    check("7h 發文者自己看不到這一行", p.locator("[data-testid=question]").count() == 0)
    c.close()
    p0 = ctx_for(br).new_page()
    p0.goto(B + f"/share/{T2}")
    settle(p0)
    check("7i 留言的檢舉照舊（有留言時的檢舉按鈕由留言元件負責，這裡確認元件還在）", p0.locator("section#comments, [data-testid=comments]").count() >= 1 or "留言" in p0.content())
    p0.context.close()

    # ============================ 8. 未登入：先登入，回到原頁並打開對話框 ============================
    L = mkuser("l")
    c = ctx_for(br)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("8", m.text)))
    p.goto(B + f"/share/{T2}")
    settle(p)
    p.click("[data-testid=question-open]")
    panel = p.locator("[data-testid=auth-panel]")
    panel.wait_for()
    check("8a 沒登入點了先跳登入", panel.is_visible() and p.locator("[data-testid=question-dialog]").count() == 0)
    panel.locator("input[type=email]").fill(L["email"])
    panel.locator("input[type=password]").fill("yinzang-demo")
    p.wait_for_timeout(300)
    panel.locator("button[type=submit]").click()
    p.locator("[data-testid=question-dialog]").wait_for(timeout=20000)
    check("8b 登入後留在原頁並直接打開對話框", p.url.endswith(f"/share/{T2}") and p.locator("[data-testid=question-dialog]").is_visible(), p.url)
    p.locator("[data-testid=question-dialog] .q-reason", has_text="重複發文").click()
    p.locator("[data-testid=question-submit]").click()
    p.locator("[data-testid=question-done]").wait_for()
    check("8c 登入後送出成功", one(f"SELECT reason FROM error_reports WHERE share_no = {T2} AND reporter_id = '{L['id']}'") == "duplicate")
    c.close()
    # 換頁登入（例如走 /login 整頁）再回來：記號對得上也會打開
    L2 = mkuser("l2")
    c = ctx_for(br)
    p = c.new_page()
    p.goto(B + f"/share/{T2}")
    settle(p)
    p.click("[data-testid=question-open]")
    p.locator("[data-testid=auth-panel]").wait_for()
    c.add_cookies([{"name": "yz_session", "value": L2["tok"], "domain": HOST, "path": "/", "httpOnly": True}])
    p.goto(B + f"/share/{T2}")
    settle(p)
    p.locator("[data-testid=question-dialog]").wait_for(timeout=15000)
    check("8d 在別處登入後回到原頁：對話框自動打開（sessionStorage 記號）", p.locator("[data-testid=question-dialog]").is_visible())
    c.close()

    # ============================ 9. 手機 390：從下方滑出的面板 ============================
    R2 = mkuser("p")
    c = ctx_for(br, R2, 390, 844, mobile=True)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("9", m.text)))
    p.goto(B + f"/share/{T2}")
    settle(p)
    p.locator("[data-testid=question-open]").scroll_into_view_if_needed()
    p.locator("[data-testid=question-open]").tap()
    d = p.locator("[data-testid=question-dialog]")
    d.wait_for()
    p.wait_for_timeout(400)
    box = d.bounding_box()
    check("9a 手機面板貼齊螢幕底部、滿版寬", abs(box["y"] + box["height"] - 844) < 2 and abs(box["width"] - 390) < 1 and box["x"] == 0, box)
    d.locator(".q-reason", has_text="其實不是這位藝人").tap()
    d.locator("[data-testid=question-note]").fill("這是另一個團的")
    p.screenshot(path=str(IMG / "9_手機面板_390.jpg"), type="jpeg", quality=80)
    ov = p.evaluate("() => { const d = document.querySelector('[data-testid=question-dialog]'); return [...d.querySelectorAll('*')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5) }).map(e => e.className) }")
    check("9b 面板內沒有元素超出螢幕", not ov, ov)
    sub = d.locator("[data-testid=question-submit]")
    sub.scroll_into_view_if_needed()
    sb = sub.bounding_box()
    check("9c 送出鈕在可見範圍、夠大好點（高 ≥ 40）", sb["y"] + sb["height"] <= 844 and sb["height"] >= 40, sb)
    sub.tap()
    p.locator("[data-testid=question-done]").wait_for()
    check("9d 手機送出成功", one(f"SELECT reason FROM error_reports WHERE share_no = {T2} AND reporter_id = '{R2['id']}'") == "not_artist")
    p.screenshot(path=str(IMG / "9_手機已收到_390.jpg"), type="jpeg", quality=80)
    c.close()

    # ============================ 10. 後台：錯誤回報佇列、儀表板數量 ============================
    c = ctx_for(br, admin)
    p = c.new_page()
    p.on("console", lambda m: m.type == "error" and errs.append(("10", m.text)))
    p.goto(B + "/admin/error-reports")
    settle(p)
    openn = one("SELECT COUNT(*) FROM error_reports WHERE status = 'open'")
    items_open = p.locator("[data-testid=er-open] [data-testid=er-item]").count()
    check("10a 後台「錯誤回報」列出全部待處理", items_open == openn, (items_open, openn))
    mine = p.locator(f"[data-testid=er-open] [data-testid=er-item][data-share='{T2}']", has_text="資料有誤").first
    check("10b 回報附的說明與比對照片看得到", mine.locator(".er-note").inner_text() == "年份應該是 2023" and mine.locator(".er-photo img").count() == 1)
    p.screenshot(path=str(IMG / "10_後台錯誤回報_1440.jpg"), type="jpeg", quality=80, full_page=True)
    rid = mine.get_attribute("data-id")
    mine.locator("[data-testid=er-fixed]").click()
    p.locator(f"[data-testid=er-done] [data-testid=er-item][data-id='{rid}']").wait_for()
    ign = p.locator("[data-testid=er-open] [data-testid=er-item]").first
    iid = ign.get_attribute("data-id")
    ign.locator("[data-testid=er-ignored]").click()
    p.locator(f"[data-testid=er-done] [data-testid=er-item][data-id='{iid}']").wait_for()
    check("10c 標記已修正、不處理，寫進操作紀錄",
          one(f"SELECT status FROM error_reports WHERE id = {rid}") == "fixed" and one(f"SELECT status FROM error_reports WHERE id = {iid}") == "ignored"
          and one(f"SELECT COUNT(*) FROM admin_log WHERE action LIKE '錯誤回報：%' AND detail LIKE '%{rid}%'") >= 1)
    st = requests.get(B + "/api/admin/stats", headers=AH).json()["queue"]
    check("10d 儀表板待處理有「錯誤回報」數量，等於待處理筆數", st.get("errorReports") == one("SELECT COUNT(*) FROM error_reports WHERE status = 'open'"), st.get("errorReports"))
    p.goto(B + "/admin")
    settle(p)
    p.locator("[data-testid=queue-error-reports]").wait_for()
    check("10e 儀表板上看得到「錯誤回報」格", "錯誤回報" in p.locator("[data-testid=queue-error-reports]").inner_text())
    p.goto(B + "/admin/moderation")
    settle(p)
    row = p.locator(f"tr[data-target='share:{T2}']")
    check("10f 審核頁的檢舉列顯示檢舉附的說明", row.count() == 1 and "要求私下匯款" in row.inner_text() and "疑似詐騙" in row.inner_text(), row.inner_text() if row.count() else "")
    r = requests.get(B + "/api/admin/error-reports", headers=H(M))
    check("10g 非管理員打不到後台錯誤回報 API", r.status_code == 403, r.status_code)
    c.close()

    # ============================ 11. 320／390／1440 溢出 ============================
    pages = [("/share/new", "form"), (f"/share/{T2}", "share"), ("/artist/" + TOURKEY, "series"), (f"/artist/{A}", "artist"), ("/admin/error-reports", "admin")]
    bad = []
    for w in (320, 390, 1440):
        c = ctx_for(br, admin, w, 900)
        p = c.new_page()
        p.on("console", lambda m, w=w: m.type == "error" and errs.append((f"11-{w}", m.text)))
        for path, name in pages:
            p.goto(B + path)
            settle(p)
            if name == "form":
                # [改寫] 同 fill_top；新增演唱會 → where-new-tour
                p.fill("[data-testid=artist-search]", ANAME)
                p.locator("[data-testid=artist-opt]", has_text=ANAME).first.click(timeout=15000)
                p.locator("[data-testid=pick-kind] button:text-is('毛巾')").click()
                p.click("[data-testid=where-new-tour]")
            sw = p.evaluate("() => document.documentElement.scrollWidth")
            if sw > w:
                bad.append((w, path, sw))
            if w != 1440 or name in ("form",):
                p.screenshot(path=str(IMG / f"11_{name}_{w}.jpg"), type="jpeg", quality=80, full_page=True)
        c.close()
    check("11a 受影響頁面 320／390／1440 無水平溢出（表單展開新增演唱會、單則、巡迴系列頁、藝人頁、後台錯誤回報）", not bad, bad)
    br.close()

check("12 全程 console error 0", not errs, errs[:5])
n_ok = sum(r["ok"] for r in res)
print(f"\n{n_ok}/{len(res)} 通過")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"at": iso(datetime.now(timezone.utc)), "pass": n_ok, "total": len(res), "results": res}, ensure_ascii=False, indent=1))
sys.exit(0 if n_ok == len(res) else 1)
