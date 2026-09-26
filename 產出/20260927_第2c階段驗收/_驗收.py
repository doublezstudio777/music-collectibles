# 第 2c 階段驗收：維基式編輯（編輯→歷史→還原、未驗證被擋、管理員鎖定）、熱門藝人不感興趣、藝人目錄篩選、
# 歷史價格（3 筆出現、2 筆不出現、離群值排除、同一對只算一次、作廢不算）、管理員下架（隱藏／恢復、永久刪除擋有收藏、
# 無內容藝人頁 404、強制開關）、暫停模式 webhook、照片讀取門檻、申訴照片權限、nosniff、noindex 三種、OG、畫面溢出。
# 用法：dev server（npm run dev，輸出導到 LOG），python3 _驗收.py <LOG 路徑> [網址，預設 http://localhost:5173]
# 全程本機：D1／R2 都是 Miniflare 模擬（網站/.wrangler/state）。寄信一律印 console（真實寄信另外測一次，見 README）。
import io, json, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
import requests
from PIL import Image
from playwright.sync_api import sync_playwright

LOG = Path(sys.argv[1])
B = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5173"
HERE = Path(__file__).parent
SITE = HERE.parent.parent / "網站"
IMG = HERE / "img"; IMG.mkdir(exist_ok=True)
STAMP = str(int(time.time()))[-6:]
PW = "listen-2026"
TT = "XXXX.DUMMY.TOKEN.XXXX"
R = {"checks": [], "pages": {}, "stamp": STAMP}
BUSY_SERIES = "mountain-radio/1"  # 底下有收藏，用來測「永久刪除被擋」
MONTH = "r2_reads:" + datetime.now(timezone.utc).strftime("%Y-%m")


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


def safe(r):
    try:
        return r.json()
    except Exception:
        return {"raw": r.text[:200]}


def code_for(email):
    for _ in range(80):
        m = re.findall(rf"to={re.escape(email)} .*?\n.*?驗證碼：(\d{{6}})", LOG.read_text(errors="ignore"))
        if m:
            return m[-1]
        time.sleep(0.25)
    return None


class U:
    def __init__(self, tag):
        self.email = f"{tag}{STAMP}@example.com"; self.handle = f"{tag}{STAMP}"; self.name = f"{tag.upper()}{STAMP[-3:]}"
        ip = f"10.{int(STAMP) % 250}.{len(tag)}.{sum(map(ord, tag)) % 250}"
        r = requests.post(B + "/api/auth/register", json={"email": self.email, "password": PW, "handle": self.handle, "name": self.name,
                                                          "turnstileToken": TT}, headers={"cf-connecting-ip": ip})
        assert r.status_code == 201, r.text
        r = requests.post(B + "/api/auth/verify-email", json={"email": self.email, "code": code_for(self.email), "client": "app"})
        self.token = r.json()["token"]
        self.id = sql(f"select id from users where email='{self.email}'")[0]["id"]

    def h(self):
        return {"authorization": f"Bearer {self.token}"}

    def get(self, p):
        r = requests.get(B + p, headers=self.h()); return r.status_code, safe(r)

    def post(self, p, body=None):
        r = requests.post(B + p, json=body if body is not None else {}, headers=self.h()); return r.status_code, safe(r)

    def upload(self, purpose="share"):
        r = requests.post(B + "/api/uploads", headers=self.h(), data={"purpose": purpose},
                          files={"image": ("a.webp", webp(), "image/webp"), "thumb": ("t.webp", webp(300, 300), "image/webp")})
        return r.status_code, safe(r)


class Admin(U):
    def __init__(self):
        self.email = "admin@demo.yinzang.test"; self.name = "音藏管理員"
        self.token = requests.post(B + "/api/auth/login", json={"email": self.email, "password": "yinzang-demo", "turnstileToken": TT,
                                                                 "client": "app"}).json()["token"]
        self.pw = "yinzang-demo"


def webp(w=800, h=600, color=(200, 120, 40)):
    b = io.BytesIO(); Image.new("RGB", (w, h), color).save(b, "WEBP", quality=80); return b.getvalue()


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
    pg.locator("#page-email").fill(u.email); pg.locator("#page-password").fill(getattr(u, "pw", PW))
    wait_turnstile(pg.locator(".auth-page")); pg.locator(".auth-submit").click()
    pg.wait_for_url(B + "/", timeout=20000); settle(pg)


def status(p, headers=None):
    return requests.get(B + p, headers=headers or {}, allow_redirects=False).status_code


def new_share(u, sale="offer", price=None, story=""):
    c, up = u.upload()
    assert c == 201, up
    body = {"photoIds": [up["id"]], "about": [PRICE_ABOUT], "seriesKey": PRICE_SERIES, "itemId": PRICE_ITEM, "versionId": PRICE_VER,
            "story": story, "sale": {"state": sale, **({"price": price} if price else {})}}
    c, r = u.post("/api/shares", body)
    assert c == 201, r
    return r["n"] if "n" in r else r.get("share", {}).get("n")


def deal(seller, buyer, price):
    """seller 發一則開放出價 → buyer 出價 → 接受 → 成交；回傳那則的號碼"""
    n = new_share(seller)
    c, r = buyer.post(f"/api/shares/{n}/offers", {"kind": "offer", "price": price}); assert c in (200, 201), r
    oid = sql(f"select id from offers where share_no={n} and buyer_id='{buyer.id}' order by id desc limit 1")[0]["id"]
    c, r = seller.post(f"/api/offers/{oid}/respond", {"answer": "accepted"}); assert c == 200, r
    c, r = seller.post(f"/api/shares/{n}/close", {"offerId": oid}); assert c == 200, r
    return n


def price_block():
    html = requests.get(B + "/artist/" + PRICE_SERIES).text
    m = re.search(rf'id="{PRICE_ITEM}-{PRICE_VER}".*?(?=<section id=|</main>)', html, re.S)
    part = m.group(0) if m else ""
    if 'data-testid="price-history"' not in part:
        return None
    part = re.search(r'data-testid="price-history".*?</figure>', part, re.S).group(0)
    n = re.search(r'data-testid="price-n">(\d+)<', part)
    med = re.search(r'data-testid="price-median">([^<]+)<', part)
    return {"n": int(n.group(1)) if n else None, "median": med.group(1) if med else None,
            "names_leak": any(x in part for x in NAMES)}


NAMES = []

# 可重跑：每次挑還沒被編輯過的系列、還沒有成交紀錄的版本、還沒被編輯過且沒有內容的維基藝人（本機資料不清空）
_rev = {x["target"] for x in sql("select distinct target from revisions")}
SERIES = next(f"{x['a']}/{x['n']}" for x in sql("select artist_slug a, no n from series where status='approved' and hidden_at is null and deleted_at is null order by id")
              if f"series:{x['a']}/{x['n']}" not in _rev)
_dealt = {x["k"] for x in sql("select distinct version_key k from deals where version_key is not null")}
_locked = {"faint-signal/1#cd-v1"}
_cand = sql("select s.artist_slug a, s.no n, i.item_id i, v.version_id v, s.credits c from versions v join items i on i.id=v.item_ref join series s on s.id=i.series_id "
            "where v.status='approved' and i.status='approved' and s.status='approved' and v.hidden_at is null and i.hidden_at is null and s.hidden_at is null "
            "and s.artist_slug not like 'empty-%' order by s.id desc, i.id, v.id")
_pick = next(x for x in _cand if f"{x['a']}/{x['n']}#{x['i']}-{x['v']}" not in _dealt | _locked and x["a"] != "mountain-radio")
PRICE_SERIES, PRICE_ITEM, PRICE_VER = f"{_pick['a']}/{_pick['n']}", _pick["i"], _pick["v"]
PRICE_KEY = f"{PRICE_SERIES}#{PRICE_ITEM}-{PRICE_VER}"
PRICE_ABOUT = sql(f"select name from artists where slug='{_pick['a']}'")[0]["name"]
WIKI_SLUG = next(x["slug"] for x in sql("select slug from artists where wiki_url is not null and display='auto' and hidden_at is null order by slug")
                 if f"artist:{x['slug']}" not in _rev)
R["targets"] = {"series": SERIES, "price": PRICE_KEY, "wiki": WIKI_SLUG}
print("targets", R["targets"])

# ======================= 0. 帳號 =======================
A, Bb, C, D, S, E = U("wa"), U("wb"), U("wc"), U("wd"), U("ws"), U("we")
AD = Admin()
NAMES.extend([x.name for x in (A, Bb, C, D, S, E)] + [x.handle for x in (A, Bb, C, D, S, E)])
check("0 六個真帳號（已驗證 Email）＋管理員登入", all(x.token for x in (A, Bb, C, D, S, E, AD)))

# ======================= 1. 維基式編輯（API 部分） =======================
T = f"series:{SERIES}"
c, h0 = requests.get(B + f"/api/revisions?target={T}").status_code, requests.get(B + f"/api/revisions?target={T}").json()
base0 = h0["revisions"][0]["id"]
R["wiki_before"] = len(h0["revisions"])
c, r = A.post("/api/revisions", {"target": T, "content": ["段落一 A 改寫", "段落二"], "summary": "", "baseId": base0})
check("1a 修改說明空白被擋（400 SUMMARY_REQUIRED）", c == 400 and r["error"]["code"] == "SUMMARY_REQUIRED", r)

# 未驗證帳號：session 還在，但 email_verified_at 清掉
sql(f"update users set email_verified_at=NULL where id='{E.id}'")
c, r = E.post("/api/revisions", {"target": T, "content": ["未驗證的人想改"], "summary": "試試", "baseId": base0})
check("1b 未驗證帳號編輯被擋（403 NOT_VERIFIED）", c == 403 and r["error"]["code"] == "NOT_VERIFIED", r)

with sync_playwright() as p:
    br = p.chromium.launch()
    errs = []

    def new_ctx(w, h=900):
        cx = br.new_context(viewport={"width": w, "height": h})
        pg = cx.new_page()
        pg.on("console", lambda m: errs.append((pg.url, m.text)) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append((pg.url, str(e))))
        return cx, pg

    # ---------- 1c. A 用網頁編輯系列正文 ----------
    ca, pa = new_ctx(1440)
    ui_login(pa, A)
    pa.goto(B + f"/artist/{SERIES}"); settle(pa)
    before_text = pa.locator("#body").inner_text()
    pa.locator("[data-testid=edit-link]").click(); pa.wait_for_url(re.compile(r"edit=1")); settle(pa)
    pa.locator("#wiki-text").fill("第一段：A 在網頁上改寫的正文，補上發行月份。\n\n第二段：保留下來的段落。")
    pa.locator("#wiki-form, [data-testid=wiki-form]").locator("button[type=submit]").click()
    pa.wait_for_timeout(600)
    err_txt = pa.locator("[data-testid=wiki-form] .field-error").inner_text() if pa.locator("[data-testid=wiki-form] .field-error").count() else ""
    check("1c 網頁：沒寫修改說明送不出（顯示「寫一句修改說明」）", "修改說明" in err_txt, err_txt)
    pa.locator("#wiki-summary").fill("補上發行月份")
    pa.locator("[data-testid=wiki-form] button[type=submit]").click()
    pa.wait_for_url(re.compile(rf"/artist/{re.escape(SERIES)}$"), timeout=15000); settle(pa)
    body_now = pa.locator("#body").inner_text()
    last = pa.locator("[data-testid=last-edit]").inner_text()
    check("1d 網頁編輯成功：正文更新、顯示「最後修改：A · 歷史」", "A 在網頁上改寫" in body_now and A.name in last and "歷史" in last, last)
    pa.screenshot(path=str(IMG / "c1_series_after_edit_1440.jpg"), type="jpeg", quality=80, full_page=False)

    # ---------- 1e. B 用 API 改（先用過期的 baseId → 衝突） ----------
    hist = requests.get(B + f"/api/revisions?target={T}").json()["revisions"]
    c, r = Bb.post("/api/revisions", {"target": T, "content": ["B 的版本"], "summary": "B 改", "baseId": base0})
    check("1e 用舊版本 id 編輯 → 409 EDIT_CONFLICT", c == 409 and r["error"]["code"] == "EDIT_CONFLICT", r)
    c, r = Bb.post("/api/revisions", {"target": T, "content": ["第一段：B 又改了一次，拿掉發行月份。", "第二段：保留下來的段落。"],
                                      "summary": "月份來源不明先拿掉", "baseId": hist[0]["id"]})
    check("1f B 用最新版本 id 編輯 → 201", c == 201, r)
    hist = requests.get(B + f"/api/revisions?target={T}").json()["revisions"]
    R["wiki_revisions"] = [{"no": x["no"], "author": (x["author"] or {}).get("name"), "summary": x["summary"], "at": x["at"]} for x in hist]
    check("1g 歷史：初始版本＋A＋B 共 3 版，作者、時間、說明都有", len(hist) == 3 and hist[0]["author"]["name"] == Bb.name
          and hist[1]["author"]["name"] == A.name and all(x["summary"] and x["at"] for x in hist), R["wiki_revisions"])

    # ---------- 1h. 歷史頁比對差異＋A 還原到第 2 版 ----------
    pa.goto(B + f"/artist/{SERIES}/history"); settle(pa)
    diff_html = pa.locator("[data-testid=diff]").inner_html()
    check("1h 歷史頁預設比對最新兩版，差異有 <ins>／<del>", "<ins>" in diff_html and "<del>" in diff_html, diff_html[:160])
    pa.screenshot(path=str(IMG / "c2_history_1440.jpg"), type="jpeg", quality=80, full_page=True)
    v2 = [x for x in hist if x["no"] == 2][0]
    pa.locator(f"li[data-rev='{v2['id']}'] button:has-text('還原到這版')").click()
    pa.wait_for_timeout(1500); settle(pa)
    hist = requests.get(B + f"/api/revisions?target={T}").json()["revisions"]
    page_body = requests.get(B + f"/artist/{SERIES}").text
    check("1i 還原：新增第 4 版「還原到第 2 版」、作者 A、正文回到 A 的版本",
          len(hist) == 4 and hist[0]["summary"].startswith("還原到第 2 版") and hist[0]["author"]["name"] == A.name
          and "A 在網頁上改寫" in page_body and hist[0]["revertedFrom"] == v2["id"], hist[0])
    # 比對任意兩版
    first = [x for x in hist if x["no"] == 1][0]
    pa.goto(B + f"/artist/{SERIES}/history?a={first['id']}&b={hist[0]['id']}"); settle(pa)
    check("1j 歷史頁指定兩版比對（第 1 版 → 第 4 版）", "第 1 版 → 第 4 版" in pa.locator(".diff-head").inner_text())

    # ---------- 1k. 未驗證帳號的網頁：編輯區塊顯示「認證後才能編輯」 ----------
    ce, pe = new_ctx(390)
    pe.context.add_cookies([{"name": "yz_session", "value": E.token, "url": B}])
    pe.goto(B + f"/artist/{SERIES}?edit=1"); settle(pe)
    gate = pe.locator("[data-testid=wiki-gate]").inner_text() if pe.locator("[data-testid=wiki-gate]").count() else ""
    check("1k 未驗證帳號網頁：「認證後才能編輯」且沒有表單", "認證後才能編輯" in gate and pe.locator("#wiki-text").count() == 0, gate)
    pe.screenshot(path=str(IMG / "c3_unverified_gate_390.jpg"), type="jpeg", quality=80)
    ce.close()
    sql(f"update users set email_verified_at='2026-09-27T00:00:00.000Z' where id='{E.id}'")

    # ---------- 1l. 管理員鎖定 ----------
    cad, pad = new_ctx(1440)
    ui_login(pad, AD)
    pad.goto(B + f"/artist/{SERIES}/history"); settle(pad)
    pad.locator("[data-testid=page-lock]").click(); pad.wait_for_timeout(1200); settle(pad)
    locked = requests.get(B + f"/api/revisions?target={T}").json()["locked"]
    check("1l 管理員在歷史頁按「鎖定頁面」→ 已鎖定", locked and pad.locator("[data-testid=locked-flag]").count() == 1)
    top = requests.get(B + f"/api/revisions?target={T}").json()["revisions"][0]["id"]
    c, r = A.post("/api/revisions", {"target": T, "content": ["鎖定後想改"], "summary": "試", "baseId": top})
    c2, r2 = A.post(f"/api/revisions/{v2['id']}/revert", {})
    check("1m 鎖定後一般帳號編輯、還原都被擋（423 PAGE_LOCKED）", c == 423 and c2 == 423 and r["error"]["code"] == "PAGE_LOCKED", (c, c2))
    pa.goto(B + f"/artist/{SERIES}?edit=1"); settle(pa)
    g = pa.locator("[data-testid=wiki-gate]").inner_text() if pa.locator("[data-testid=wiki-gate]").count() else ""
    check("1n 鎖定後一般帳號網頁顯示「已被管理員鎖定」", "鎖定" in g, g)
    c, r = AD.post("/api/revisions", {"target": T, "content": ["第一段：A 在網頁上改寫的正文，補上發行月份。", "第二段：保留下來的段落。", "管理員補一段。"],
                                      "summary": "管理員補充", "baseId": top})
    check("1o 鎖定中管理員仍可編輯", c == 201, r)
    AD.post("/api/admin/page-lock", {"target": T, "locked": False})
    top = requests.get(B + f"/api/revisions?target={T}").json()["revisions"][0]["id"]
    c, r = A.post("/api/revisions", {"target": T, "content": ["第一段：A 在網頁上改寫的正文，補上發行月份。", "第二段：保留下來的段落。"],
                                     "summary": "解鎖後拿掉管理員那段", "baseId": top})
    check("1p 解除鎖定後一般帳號又能編輯", c == 201, r)

    # ---------- 1q. 藝人簡介來自維基百科：標示保留，改寫後同樣授權 ----------
    wiki_slug = WIKI_SLUG
    check(f"1q 沒有系列也沒有收藏的藝人頁回 404（匯入的 {WIKI_SLUG}）", status(f"/artist/{wiki_slug}") == 404)
    c, r = AD.post("/api/admin/display", {"slug": wiki_slug, "mode": "on"})
    html = requests.get(B + f"/artist/{wiki_slug}").text
    check("1r 管理員強制顯示後 200，簡介標「來源：維基百科＋條目連結＋CC BY-SA 4.0」",
          c == 200 and 'data-testid="wiki-credit"' in html and "zh.wikipedia.org" in html and "CC BY-SA 4.0" in html)
    intro = requests.get(B + f"/api/revisions?target=artist:{wiki_slug}").json()["revisions"][0]["content"]
    c, r = A.post("/api/revisions", {"target": f"artist:{wiki_slug}", "content": intro + ["A 補充：2026 年巡演資訊待查證。"],
                                     "summary": "補一句巡演", "baseId": 0})
    html = requests.get(B + f"/artist/{wiki_slug}").text
    hist_w = requests.get(B + f"/api/revisions?target=artist:{wiki_slug}").json()["revisions"]
    check("1s 改寫後仍標維基來源，並註明改寫版本同樣以 CC BY-SA 4.0 授權；每一版都記授權",
          c == 201 and "改寫的版本同樣以此授權" in html and all(x["license"] == "CC BY-SA 4.0" for x in hist_w) and len(hist_w) == 2,
          [x["license"] for x in hist_w])
    pa.goto(B + f"/artist/{wiki_slug}/history"); settle(pa)
    check("1t 藝人歷史頁有授權說明", pa.locator("[data-testid=history-license]").count() == 1)

    # ======================= 2. 熱門藝人、藝人目錄 =======================
    cd_, pd = new_ctx(1440)
    ui_login(pd, D)
    pd.goto(B + "/"); settle(pd)
    pd.locator(".hot-list").wait_for(timeout=10000)
    names0 = pd.locator(".hot-item[data-artist]").evaluate_all("els => els.map(e => e.dataset.artist)")
    last_cell = pd.locator(".hot-list > li").last.inner_text()
    all_link = pd.locator(".hot-all a").get_attribute("href")
    check("2a 首頁熱門藝人 5 位＋最後一格「看全部藝人」連到 /artists", len(names0) == 5 and "看全部藝人" in last_cell and all_link == "/artists", names0)
    R["hot_before"] = names0
    pd.screenshot(path=str(IMG / "c4_hot_before_1440.jpg"), type="jpeg", quality=80)
    pd.locator(f".hot-item[data-artist='{names0[0]}'] .hot-dismiss").click(); pd.wait_for_timeout(800)
    names1 = pd.locator(".hot-item[data-artist]").evaluate_all("els => els.map(e => e.dataset.artist)")
    R["hot_after"] = names1
    hot_total = len([x for x in sql("select slug from artists") if True])
    check("2b 按「不感興趣」：那位消失、下一位補上（仍 5 位或名單用完）",
          names0[0] not in names1 and (len(names1) == 5 or len(names1) == len(names0) - 1) and names1[:4] == names0[1:5], names1)
    pd.reload(); settle(pd); pd.locator(".hot-list").wait_for(timeout=10000)
    names2 = pd.locator(".hot-item[data-artist]").evaluate_all("els => els.map(e => e.dataset.artist)")
    db_dis = sql(f"select artist_slug from artist_dismissals where user_id='{D.id}'")
    check("2c 重新整理後仍不推薦（存在 D1）", names0[0] not in names2 and [x["artist_slug"] for x in db_dis] == [names0[0]], db_dis)
    pd.screenshot(path=str(IMG / "c5_hot_after_1440.jpg"), type="jpeg", quality=80)
    pd.locator(f".hot-item[data-artist='{names2[0]}'] .hot-name").click(); pd.wait_for_url(re.compile(r"/artist/")); settle(pd)
    check("2d 點熱門藝人名字進藝人頁", pd.url.endswith(f"/artist/{names2[0]}") and pd.locator(".page-title").count() == 1, pd.url)
    pd.goto(B + "/"); settle(pd); pd.locator(".hot-list").wait_for(timeout=10000)
    pd.locator(f".hot-item[data-artist='{names2[0]}'] .follow").click(); pd.wait_for_timeout(800)
    fol = sql(f"select artist_slug from follows where user_id='{D.id}'")
    check("2e 熱門藝人按「追蹤」寫進 D1", [x["artist_slug"] for x in fol] == [names2[0]], fol)

    arts = {x["slug"]: x for x in sql("select slug, gender, region, kind from artists")}
    combos = [("", ""), ("female", ""), ("", "overseas"), ("group", "domestic"), ("male", "overseas")]
    dir_ok = True; dir_detail = {}
    for g, r_ in combos:
        q = "&".join([x for x in [f"g={g}" if g else "", f"r={r_}" if r_ else ""] if x])
        pd.goto(B + "/artists" + (f"?{q}" if q else "")); settle(pd)
        slugs = pd.locator("[data-testid=artist-dir] li").evaluate_all("els => els.map(e => e.dataset.artist)") if pd.locator("[data-testid=artist-dir]").count() else []
        good = all((not g or arts[s]["gender"] == g) and (not r_ or arts[s]["region"] == r_) and arts[s]["kind"] == "藝人" for s in slugs)
        api = requests.get(B + "/api/artists" + (f"?{q}" if q else "")).json()["artists"]
        same = sorted(slugs) == sorted(a["slug"] for a in api)
        dir_ok = dir_ok and good and same
        dir_detail[q or "全部"] = len(slugs)
        if q == "g=female":
            pd.screenshot(path=str(IMG / "c6_artists_female_1440.jpg"), type="jpeg", quality=80)
    check("2f 藝人目錄 5 種篩選組合：列出的都符合類型×地區、只列藝人、網頁與 API 一致", dir_ok, dir_detail)
    R["artist_dir"] = dir_detail
    all_n = dir_detail["全部"]
    invisible = sql("select count(*) n from artists a where kind='藝人' and display='auto' and not exists (select 1 from series s where s.credits like '%\"'||a.slug||'\"%' and s.status='approved')")[0]["n"]
    check("2g 目錄不列沒有內容的藝人（全部藝人數 < 資料庫藝人數）", all_n < len([a for a in arts.values() if a["kind"] == "藝人"]), f"{all_n} 位顯示；無系列的 {invisible} 位")

    # ======================= 3. 歷史價格 =======================
    n1 = deal(S, A, 1200)
    n2 = deal(S, Bb, 1300)
    pb2 = price_block()
    check("3a 成交 2 筆：價格區塊不顯示", pb2 is None, pb2)
    n3 = deal(S, C, 1100)
    pb3 = price_block()
    check("3b 成交 3 筆：價格區塊出現，3 筆、中間值 NT$ 1,200、不顯示買賣雙方", pb3 is not None and pb3["n"] == 3 and pb3["median"] == "NT$ 1,200"
          and not pb3["names_leak"], pb3)
    n4 = deal(S, D, 99000)
    pb4 = price_block()
    check("3c 加一筆離群值 NT$ 99,000：被排除，仍是 3 筆、中間值不變", pb4 is not None and pb4["n"] == 3 and pb4["median"] == "NT$ 1,200", pb4)
    n5 = deal(S, A, 1250)
    pb5 = price_block()
    check("3d 同一對買賣家（S→A）再成交一次：只算一次（取最新），仍 3 筆、中間值變 NT$ 1,250",
          pb5 is not None and pb5["n"] == 3 and pb5["median"] == "NT$ 1,250", pb5)
    # 作廢：S 把 n2 改回出售中 → 那筆不算，剩 2 筆有效 → 不顯示
    c, r = S.post(f"/api/shares/{n2}/reopen", {})
    pb6 = price_block()
    voided = sql(f"select voided_at from deals where share_no={n2}")
    check("3e 賣家改回出售中：那筆成交作廢（紀錄留著），有效筆數不足 3 → 整塊不顯示", c == 200 and voided[0]["voided_at"] and pb6 is None, (c, pb6))
    # 改回：S 再成交給 Bb → 3 筆；開價與出價區間
    oid = sql(f"select id from offers where share_no={n2} and buyer_id='{Bb.id}' order by id desc limit 1")[0]["id"]
    Bb.post(f"/api/shares/{n2}/offers", {"kind": "offer", "price": 1350})
    oid = sql(f"select id from offers where share_no={n2} and buyer_id='{Bb.id}' order by id desc limit 1")[0]["id"]
    S.post(f"/api/offers/{oid}/respond", {"answer": "accepted"}); S.post(f"/api/shares/{n2}/close", {"offerId": oid})
    ask = new_share(S, "sale", 1500)
    bidshare = new_share(S, "offer")
    E.post(f"/api/shares/{bidshare}/offers", {"kind": "offer", "price": 1000})
    html = requests.get(B + "/artist/" + PRICE_SERIES).text
    part = re.search(rf'id="{PRICE_ITEM}-{PRICE_VER}".*?(?=<section id=|</main>)', html, re.S).group(0)
    check("3f 目前開價與出價區間顯示（開價 NT$ 1,500、出價 NT$ 1,000）", "NT$ 1,500" in part and "NT$ 1,000" in part)
    # 只算認證帳號：把 C 的 Email 驗證清掉 → C 那筆不算
    sql(f"update users set email_verified_at=NULL where id='{C.id}'")
    pb7 = price_block()
    sql(f"update users set email_verified_at='2026-09-27T00:00:00.000Z' where id='{C.id}'")
    check("3g 買家不是認證帳號時那筆不算（剩 2 筆 → 不顯示）", pb7 is None, pb7)
    cp, pp = new_ctx(1440)
    pp.goto(B + f"/artist/{PRICE_SERIES}#{PRICE_ITEM}-{PRICE_VER}"); settle(pp)
    pp.locator(f"[id='{PRICE_ITEM}-{PRICE_VER}'] [data-testid=price-history]").scroll_into_view_if_needed()
    pp.locator(f"[id='{PRICE_ITEM}-{PRICE_VER}'] [data-testid=price-history]").screenshot(path=str(IMG / "c7_price_block_1440.jpg"), type="jpeg", quality=80)
    api_p = requests.get(B + f"/api/prices?series={PRICE_SERIES}").json()["versions"].get(PRICE_KEY)
    check("3h API /api/prices 同一份行情（3 筆、排除 1 筆離群值），沒有買賣雙方欄位", api_p and api_p["n"] == 3 and api_p["excluded"] == 1
          and "sellerId" not in json.dumps(api_p), api_p)
    R["price"] = api_p

    # ======================= 4. 管理員下架 =======================
    c, r = AD.post("/api/admin/hide", {"type": "share", "key": str(n1), "hidden": True})
    home = requests.get(B + "/?sort=new").text
    check("4a 隱藏炫收藏：單則頁 404、首頁牆沒有、API 當不存在",
          c == 200 and status(f"/share/{n1}") == 404 and f'href="/share/{n1}"' not in home and A.post("/api/me/likes", {"share": n1, "on": True})[0] == 404)
    AD.post("/api/admin/hide", {"type": "share", "key": str(n1), "hidden": False})
    check("4b 恢復後單則頁 200、首頁牆又出現", status(f"/share/{n1}") == 200 and f'href="/share/{n1}"' in requests.get(B + "/?sort=new").text)
    AD.post("/api/admin/hide", {"type": "version", "key": PRICE_KEY, "hidden": True})
    h1 = requests.get(B + "/artist/" + PRICE_SERIES).text
    AD.post("/api/admin/hide", {"type": "version", "key": PRICE_KEY, "hidden": False})
    h2 = requests.get(B + "/artist/" + PRICE_SERIES).text
    vid = f'id="{PRICE_ITEM}-{PRICE_VER}"'
    check("4c 隱藏版本：系列頁沒有那個版本；恢復後又出現", vid not in h1 and vid in h2)
    AD.post("/api/admin/hide", {"type": "series", "key": PRICE_SERIES, "hidden": True})
    s_hidden = status("/artist/" + PRICE_SERIES)
    AD.post("/api/admin/hide", {"type": "series", "key": PRICE_SERIES, "hidden": False})
    check("4d 隱藏系列：系列頁 404；恢復後 200", s_hidden == 404 and status("/artist/" + PRICE_SERIES) == 200)
    AD.post("/api/admin/hide", {"type": "item", "key": f"{PRICE_SERIES}#{PRICE_ITEM}", "hidden": True})
    h3 = requests.get(B + "/artist/" + PRICE_SERIES).text
    AD.post("/api/admin/hide", {"type": "item", "key": f"{PRICE_SERIES}#{PRICE_ITEM}", "hidden": False})
    iid = f'id="{PRICE_ITEM}"'
    check("4e 隱藏品項：系列頁沒有那個品項；恢復後又出現", iid not in h3 and iid in requests.get(B + "/artist/" + PRICE_SERIES).text)
    AD.post("/api/admin/hide", {"type": "artist", "key": "lin-hsia", "hidden": True})
    a_hidden = status("/artist/lin-hsia")
    AD.post("/api/admin/hide", {"type": "artist", "key": "lin-hsia", "hidden": False})
    check("4f 隱藏藝人：藝人頁 404；恢復後 200", a_hidden == 404 and status("/artist/lin-hsia") == 200)
    logs = sql("select action, target from admin_log where action in ('隱藏','恢復') order by id desc limit 10")
    check("4g 每次隱藏／恢復都留操作紀錄", len([x for x in logs if x["action"] == "隱藏"]) >= 5 and len([x for x in logs if x["action"] == "恢復"]) >= 5, logs[:4])

    c1, r1 = AD.post("/api/admin/purge", {"type": "series", "key": BUSY_SERIES})
    c2, r2 = AD.post("/api/admin/purge", {"type": "artist", "key": "mountain-radio"})
    c3, r3 = AD.post("/api/admin/purge", {"type": "version", "key": PRICE_KEY})
    c4, r4 = AD.post("/api/admin/purge", {"type": "share", "key": str(n1)})
    check("4h 有收藏的系列／藝人／版本永久刪除被擋（409 HAS_CONTENT），炫收藏本身不能永久刪除",
          (c1, c2, c3) == (409, 409, 409) and all(r["error"]["code"] == "HAS_CONTENT" for r in (r1, r2, r3)) and c4 == 400, (r1["error"]["message"], c4))
    # 建一位空藝人＋空系列（走待審核→核准），可以永久刪除
    slug = f"empty-{STAMP}"
    A.post("/api/catalog/submit", {"type": "artist", "name": f"空藝人{STAMP}", "slug": slug, "gender": "male", "region": "domestic"})
    AD.post("/api/admin/submissions", {"type": "artist", "id": slug, "approve": True})
    A.post("/api/catalog/submit", {"type": "series", "artist": slug, "title": "空系列", "year": "2026"})
    sid = sql(f"select id from series where artist_slug='{slug}'")[0]["id"]
    AD.post("/api/admin/submissions", {"type": "series", "id": str(sid), "approve": True})
    visible_with_series = status(f"/artist/{slug}")
    c5, r5 = AD.post("/api/admin/purge", {"type": "series", "key": f"{slug}/1"})
    no_series_404 = status(f"/artist/{slug}")
    A.post("/api/catalog/submit", {"type": "series", "artist": slug, "title": "第二個系列", "year": "2026"})
    new_no = sql(f"select no from series where artist_slug='{slug}'")[0]["no"]
    c6, r6 = AD.post("/api/admin/purge", {"type": "artist", "key": slug})
    gone = sql(f"select count(*) n from artists where slug='{slug}'")[0]["n"]
    check("4i 空系列可永久刪除；刪了之後藝人沒有系列 → 藝人頁 404；系列號不重用（新系列是 2 號）；空藝人可永久刪除",
          visible_with_series == 200 and c5 == 200 and no_series_404 == 404 and new_no == 2 and c6 == 200 and gone == 0, (visible_with_series, c5, no_series_404, new_no, c6))
    snap = sql("select detail from admin_log where action='永久刪除' order by id desc limit 1")[0]["detail"]
    check("4j 永久刪除留操作紀錄，含整列內容快照", "snapshot" in snap and slug in snap)
    AD.post("/api/admin/display", {"slug": "mountain-radio", "mode": "off"})
    off = status("/artist/mountain-radio")
    AD.post("/api/admin/display", {"slug": "mountain-radio", "mode": "auto"})
    check("4k 管理員強制不顯示有內容的藝人 → 404；改回自動 → 200", off == 404 and status("/artist/mountain-radio") == 200)

    # 後台畫面
    pad.goto(B + "/admin"); settle(pad)
    pad.locator("#td-type").select_option("share"); pad.locator("#td-key").fill(str(n3))
    pad.locator(".takedown button:has-text('隱藏')").click(); pad.wait_for_timeout(1200); settle(pad)
    in_list = pad.locator(f"[data-hidden='share:{n3}']").count()
    pad.screenshot(path=str(IMG / "c8_admin_takedown_1440.jpg"), type="jpeg", quality=80, full_page=True)
    pad.locator(f"[data-hidden='share:{n3}'] button:has-text('恢復')").click(); pad.wait_for_timeout(1200); settle(pad)
    check("4l 後台畫面：隱藏後出現在下架清單、按恢復後移出", in_list == 1 and pad.locator(f"[data-hidden='share:{n3}']").count() == 0 and status(f"/share/{n3}") == 200)
    pad.locator("#td-type").select_option("series"); pad.locator("#td-key").fill(BUSY_SERIES)
    pad.locator("[data-testid=purge]").click(); pad.wait_for_timeout(1200)
    msg = pad.locator("[data-testid=admin-error]").inner_text() if pad.locator("[data-testid=admin-error]").count() else ""
    check("4m 後台畫面：有收藏的系列按「永久刪除」顯示擋下原因", "不能永久刪除" in msg, msg)

    # ======================= 5. 暫停模式、讀取門檻、照片權限 =======================
    img_url = "/img/p/demo-share-1.jpg"
    r0 = requests.get(B + img_url)
    check("5a /img/ 回應帶 X-Content-Type-Options: nosniff", r0.headers.get("x-content-type-options") == "nosniff" and r0.status_code == 200)
    wh = B + "/api/internal/budget-alert"
    w1 = requests.post(wh, data="{}", headers={"cf-webhook-auth": "wrong-secret", "cf-connecting-ip": "10.9.9.1"})
    w2 = requests.post(wh, data="{}", headers={"cf-connecting-ip": "10.9.9.2"})
    paused_after_bad = sql("select value from settings where key='paused'")
    check("5b webhook 錯誤密鑰、沒帶密鑰都被擋（401），不會進暫停", w1.status_code == 401 and w2.status_code == 401
          and (not paused_after_bad or paused_after_bad[0]["value"] != "1"), (w1.status_code, w2.status_code))
    w3 = requests.post(wh, data=json.dumps({"alert_type": "billing_usage_alert", "text": "驗收測試"}),
                       headers={"cf-webhook-auth": "local-webhook-secret", "cf-connecting-ip": "10.9.9.3"})
    ri = requests.get(B + img_url + "?p=1")
    up_state = A.get("/api/uploads")
    cu, ru = A.upload()
    text_ok = status("/") == 200 and status(f"/artist/{SERIES}") == 200
    check("5c 正確密鑰 → 暫停模式：照片回佔位圖、上傳停止（GET 回 paused、POST 503）、文字頁照常",
          w3.status_code == 200 and ri.headers.get("x-photo-placeholder") == "paused" and ri.headers.get("content-type", "").startswith("image/svg")
          and up_state[1].get("paused") is True and cu == 503 and text_ok, (w3.status_code, ri.headers.get("x-photo-placeholder"), up_state, cu))
    pad.goto(B + "/admin"); settle(pad)
    st = pad.locator("[data-testid=site-status]").inner_text()
    pad.screenshot(path=str(IMG / "c9_admin_paused_1440.jpg"), type="jpeg", quality=80)
    pad.locator("button:has-text('解除暫停')").click(); pad.wait_for_timeout(1200); settle(pad)
    ri2 = requests.get(B + img_url + "?p=2")
    check("5d 後台顯示暫停中，管理員按「解除暫停」→ 照片恢復", "暫停中" in st and ri2.status_code == 200 and not ri2.headers.get("x-photo-placeholder")
          and ri2.headers.get("content-type") == "image/jpeg", st[:80])

    # 讀取計數：先歸零，讀 25 次不同網址（避開快取）→ 寫入 20（每 20 次寫一次）
    sql(f"insert into counters (key, value) values ('{MONTH}', 0) on conflict(key) do update set value = 0")
    before = sql(f"select value from counters where key='{MONTH}'")[0]["value"]
    for i in range(25):
        requests.get(B + img_url + f"?count={STAMP}-{i}")
    after = sql(f"select value from counters where key='{MONTH}'")[0]["value"]
    check("5e 照片讀取計數：25 次 R2 讀取 → D1 累計 +20（每 20 次寫一次）", after - before >= 20, (before, after))
    sql(f"update counters set value = 8000000 where key='{MONTH}'")
    rl = requests.get(B + img_url + "?limit=1")
    pad.goto(B + "/admin"); settle(pad)
    st2 = pad.locator("[data-testid=site-status]").inner_text()
    sql(f"update counters set value = 0 where key='{MONTH}'")
    rl2 = requests.get(B + img_url + "?limit=2")
    check("5f 本月讀取達 800 萬（免費 1,000 萬的 80%）→ 佔位圖；歸零後恢復", rl.headers.get("x-photo-placeholder") == "limit"
          and rl2.status_code == 200 and not rl2.headers.get("x-photo-placeholder") and "8,000,0" in st2, (rl.headers.get("x-photo-placeholder"), st2[:120]))

    # 申訴證據照片
    ca2, ra = A.upload("appeal")
    key = ra["url"].replace("/img/", "")
    anon = requests.get(B + ra["url"])
    other = requests.get(B + ra["url"], headers=Bb.h())
    own = requests.get(B + ra["url"], headers=A.h())
    adm = requests.get(B + ra["url"], headers=AD.h())
    check("5g 申訴證據照片放 a/，訪客與其他人 404、本人與管理員 200（private, no-store、nosniff）",
          key.startswith("a/") and anon.status_code == 404 and other.status_code == 404 and own.status_code == 200 and adm.status_code == 200
          and "no-store" in own.headers.get("cache-control", "") and own.headers.get("x-content-type-options") == "nosniff",
          (key, anon.status_code, other.status_code, own.status_code, adm.status_code))

    # ======================= 6. noindex、OG =======================
    pages = ["/", f"/artist/{SERIES}", f"/share/{n3}", "/artists", "/login"]
    metas = [('<meta name="robots" content="noindex">' in requests.get(B + u).text) for u in pages]
    heads = [requests.get(B + u).headers.get("x-robots-tag") for u in pages + ["/api/me", "/robots.txt"]]
    robots = requests.get(B + "/robots.txt").text
    check("6a noindex：每頁 <meta name=robots content=noindex>", all(metas), metas)
    check("6b noindex：回應表頭 X-Robots-Tag: noindex（頁面、API、robots.txt）", all(h == "noindex" for h in heads), heads)
    check("6c robots.txt 允許爬取（沒有 Disallow: / 全站），只擋 /admin 與 /api/",
          "Allow: /" in robots and "Disallow: /admin" in robots and "Disallow: /api/" in robots and not re.search(r"Disallow: /\s*$", robots, re.M), robots)
    share_html = requests.get(B + f"/share/{n3}").text
    og = dict(re.findall(r'<meta property="og:(title|description|image|url)" content="([^"]*)"', share_html))
    img_ok = og.get("image", "").startswith("http") and requests.get(og.get("image", "")).status_code == 200
    check("6d 單則炫收藏 OG：og:title、og:description、og:image（那則主圖、絕對網址、打得開）、og:url",
          all(k in og for k in ("title", "description", "image", "url")) and img_ok and og["url"].endswith(f"/share/{n3}"), og)
    R["og"] = og

    # ======================= 7. 畫面：1440／390 溢出與 console error =======================
    AD.post("/api/admin/display", {"slug": wiki_slug, "mode": "on"})
    shots = [("home", "/"), ("artists", "/artists"), ("artists_f", "/artists?g=female&r=domestic"), ("artist", "/artist/mountain-radio"),
             ("artist_wiki", f"/artist/{wiki_slug}"), ("series_edit", f"/artist/{SERIES}?edit=1"), ("series_hist", f"/artist/{SERIES}/history"),
             ("artist_hist", f"/artist/{wiki_slug}/history"), ("price", f"/artist/{PRICE_SERIES}"), ("share", f"/share/{n3}"), ("admin", "/admin")]
    errs.clear()
    for w in (1440, 390):
        for who, pg_ in (("a", None), ("admin", None)):
            pass
        cx = br.new_context(viewport={"width": w, "height": 900})
        cx.add_cookies([{"name": "yz_session", "value": AD.token, "url": B}])
        pg = cx.new_page()
        pg.on("console", lambda m: errs.append((pg.url, m.text)) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append((pg.url, str(e))))
        for name, u in shots:
            pg.goto(B + u); settle(pg)
            sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
            R["pages"][f"{name}_{w}"] = {"url": u, "scrollWidth": sw, "innerWidth": iw, "overflow": sw > iw}
            if name in ("price", "series_hist", "admin", "artists", "home", "artist_wiki", "series_edit"):
                pg.screenshot(path=str(IMG / f"p_{name}_{w}.jpg"), type="jpeg", quality=80, full_page=(name != "home"))
        cx.close()
    over = [k for k, v in R["pages"].items() if v["overflow"]]
    check(f"7a {len(R['pages'])} 個畫面（11 頁 × 1440／390）無橫向溢出", not over, over)
    R["console_errors"] = errs[:20]
    check("7b 畫面巡檢 console error 0", not errs, errs[:3])
    AD.post("/api/admin/display", {"slug": wiki_slug, "mode": "auto"})
    br.close()

ok = sum(c["ok"] for c in R["checks"])
R["summary"] = f"{ok}/{len(R['checks'])}"
print("TOTAL", R["summary"])
(HERE / "result.json").write_text(json.dumps(R, ensure_ascii=False, indent=2))
