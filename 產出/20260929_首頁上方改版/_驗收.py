"""首頁上方改版驗收（一首歌＋藝人分類、頁首藝人、/artists?type=、後台推薦歌曲）。
用法：python3 _驗收.py 本機|正式 [截圖子資料夾]
- 本機：http://127.0.0.1:8791，後台用 admin@demo.yinzang.test 實際登入操作（新增、停用、啟用、刪除）
- 正式：https://yinzang.dblzm.workers.dev，不登入任何帳號；「停用後首頁生效」用 D1 直接改一列再改回
"""
import io, json, os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright
from PIL import Image

MODE = sys.argv[1] if len(sys.argv) > 1 else "本機"
LOCAL = MODE == "本機"
BASE = "http://127.0.0.1:8791" if LOCAL else "https://yinzang.dblzm.workers.dev"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "img", sys.argv[2] if len(sys.argv) > 2 else MODE)
os.makedirs(OUT, exist_ok=True)
SITE = os.path.join(HERE, "..", "..", "網站")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
results = []


def ok(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  {info}" if info else ""), flush=True)


def sql(q):
    cmd = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--json", "--command", q]
    cmd += ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"] if LOCAL else ["--remote", "--config", "wrangler.production.jsonc"]
    out = subprocess.run(cmd, cwd=SITE, capture_output=True, text=True, env=os.environ).stdout
    return json.loads(out)[0]["results"]


def get(path, headers=None):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, dict(r.headers), r.read().decode()


def home_tracks(html):
    return re.findall(r'\\"track\\":\\"([A-Za-z0-9]{22})\\"', html)


def me(admin=False):
    return {"geo": {"country": "TW", "canTrade": True},
            "user": {"id": "x", "email": "a@b.c", "handle": "tester", "name": "測試帳號", "bio": "", "role": "member", "verified": True, "admin": admin, "deletionRequested": False, "avatar": None},
            "state": {"liked": [], "owned": [], "wanted": [], "follows": [], "reported": [], "appeals": [], "unread": 0, "dismissed": []}}


TRUNC = """(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null)
  .filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => e.textContent)"""
SPOTIFY = re.compile(r"spotify|scdn\.co|spotifycdn")


def open_page(b, w, path, user=False, h=900):
    ctx = b.new_context(viewport={"width": w, "height": h}, user_agent=UA)
    pg = ctx.new_page()
    errs, sp_errs = [], []

    def on_console(m):
        if m.type != "error":
            return
        loc = (m.location or {}).get("url", "")
        (sp_errs if SPOTIFY.search(loc) or SPOTIFY.search(m.text) else errs).append(m.text[:160])

    def on_resp(r):
        if r.status < 400 or "/u/tester" in r.url:
            return
        (sp_errs if SPOTIFY.search(r.url) else errs).append(f"{r.status} {r.url[:120]}")

    pg.on("console", on_console)
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.on("response", on_resp)
    if user:
        pg.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(me())))
    # 正式站偶爾整個請求卡住（curl 同網址 1 秒內回），逾時就重開一次，重開過的印出來
    try:
        pg.goto(BASE + path, wait_until="domcontentloaded", timeout=30000)
    except Exception:
        print(f"  （{path} 30 秒沒回應，重開一次）")
        pg.goto(BASE + path, wait_until="domcontentloaded", timeout=30000)
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(600)
    return ctx, pg, errs, sp_errs


def real(errs):
    return [e for e in errs if not e.startswith("Failed to load resource")]


picks = sql("SELECT p.id, p.artist_slug AS slug, p.track_id AS track, p.enabled, a.name, a.gender, a.region FROM spotify_picks p JOIN artists a ON a.slug = p.artist_slug ORDER BY p.sort, p.id")
by_track = {p["track"]: p for p in picks}
ok("[資料] 歌單有歌", len([p for p in picks if p["enabled"]]) > 0, f"{len(picks)} 首（啟用 {sum(p['enabled'] for p in picks)}）")

# ---------- 伺服器輸出：快取安全 ----------
st, hd, html = get("/")
ok("[伺服器輸出] 首頁 200", st == 200)
ok("[伺服器輸出] 還沒挑歌：data-ready=false、沒有 iframe", 'data-ready="false"' in html and "<iframe" not in html)
tr = home_tracks(html)
ok("[伺服器輸出] 帶整份啟用歌單", len(tr) > 0 and set(tr) <= {p["track"] for p in picks if p["enabled"]}, f"{len(tr)} 首")
st2, hd2, html2 = get("/")
ok("[伺服器輸出] 第二次整頁快取 HIT、內容一樣", hd2.get("x-yz-cache") == "HIT" and home_tracks(html2) == tr, hd2.get("x-yz-cache", ""))
ok("[伺服器輸出] 熱門藝人、不感興趣都不在", "熱門藝人" not in html and "不感興趣" not in html and 'class="hot' not in html)

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- 首頁 ----------
    counts = {}
    for w in (1440, 390, 360):
        ctx, pg, errs, sp_errs = open_page(b, w, "/", h=1100 if w < 700 else 1000)
        t = f"[首頁 {w}]"
        pg.wait_for_selector("[data-testid=home-pick][data-ready=true] iframe", timeout=15000)
        try:
            pg.wait_for_selector(".hp-player[data-loaded=true]", timeout=15000)
        except Exception:
            pass
        pg.wait_for_timeout(2500)
        order = pg.evaluate("""() => [...document.querySelectorAll('.home-tagline, [data-testid=home-top], .wall-bar')].map(e => e.matches('.home-tagline') ? 'tagline' : e.matches('.wall-bar') ? 'bar' : 'top')""")
        ok(f"{t} 順序：標語→色帶→排序分頁籤", order == ["tagline", "top", "bar"], str(order))
        g = pg.evaluate("""() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height)}; };
            return {top: r('[data-testid=home-top]'), pick: r('[data-testid=home-pick]'), art: r('[data-testid=home-art]'), sp: r('.hp-sp'), bar: r('.wall-bar'), card: r('.wall .card'),
                    bg: getComputedStyle(document.querySelector('[data-testid=home-top]')).backgroundColor, name: getComputedStyle(document.querySelector('.hp-name')).fontSize}; }""")
        ok(f"{t} 色帶底色 #f1f1ef", g["bg"] == "rgb(241, 241, 239)", g["bg"])
        png = Image.open(io.BytesIO(pg.screenshot())).convert("RGB")
        edge = png.getpixel((2, g["top"]["y"] + g["top"]["h"] // 2))
        ok(f"{t} 色帶滿版到螢幕邊緣", edge == (241, 241, 239), str(edge))
        ok(f"{t} 播放器 152 高、跟歌曲欄同寬", g["sp"]["h"] == 152 and abs(g["sp"]["w"] - g["pick"]["w"]) <= 1, str(g["sp"]))
        if w >= 1000:
            ratio = g["pick"]["w"] / (g["pick"]["w"] + g["art"]["w"])
            ok(f"{t} 左 2/3 歌、右 1/3 藝人", abs(ratio - 2 / 3) < 0.01 and g["art"]["x"] > g["pick"]["x"] and abs(g["art"]["y"] - g["pick"]["y"]) <= 1, f"{ratio:.3f}")
        else:
            ok(f"{t} 藝人分類在歌下面", g["art"]["y"] > g["pick"]["y"] + g["pick"]["h"] - 1)
            sc = pg.evaluate("() => { const r = document.querySelector('.home-art-list'); return {ox: getComputedStyle(r).overflowX, dir: getComputedStyle(r).display, first: [...r.children].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left)[0].dataset.type}; }")
            ok(f"{t} 分類收成一條可橫滑的列、全部藝人排第一", sc["ox"] == "auto" and sc["dir"] == "flex" and sc["first"] == "all", str(sc))
        track = pg.get_attribute(".hp-sp", "data-track")
        src = pg.get_attribute(".hp-sp", "src")
        pk = by_track.get(track)
        ok(f"{t} 播放器是 Spotify 嵌入、歌在歌單裡", pk is not None and src.startswith(f"https://open.spotify.com/embed/track/{track}"), track or "")
        name = pg.inner_text("[data-testid=pick-name]")
        href = pg.get_attribute("[data-testid=pick-name]", "href")
        meta = pg.inner_text("[data-testid=pick-meta]")
        go = pg.inner_text("[data-testid=pick-go]")
        ok(f"{t} 藝人名連藝人頁、跟這首的藝人一致", pk and name == pk["name"] and href == f"/artist/{pk['slug']}", f"{name} {href}")
        ok(f"{t} 類型・地區・N 則收藏", re.fullmatch(r"(男歌手|女歌手|團體)・(國內|國外)・\d+ 則收藏", meta) is not None, meta)
        ok(f"{t} 看其他人XX的相關收藏", go == f"看其他人{name}的相關收藏", go)
        ok(f"{t} 標題「今日推薦單曲」在歌曲欄最上面", pg.evaluate("() => { const h = document.querySelector('.hp-title'); const p = document.querySelector('.hp-player'); return h && h.textContent === '今日推薦單曲' && h.offsetParent !== null && h.getBoundingClientRect().bottom <= p.getBoundingClientRect().top; }"))
        arts = pg.evaluate("() => [...document.querySelectorAll('.home-art-list a')].map(a => ({type: a.dataset.type, href: a.getAttribute('href'), label: a.children[0].textContent, n: +a.children[1].textContent}))")
        ok(f"{t} 藝人分類四項（男歌手／女歌手／團體／全部藝人）", [a["label"] for a in arts] == ["男歌手", "女歌手", "團體", "全部藝人"] and [a["href"] for a in arts] == ["/artists?type=male", "/artists?type=female", "/artists?type=group", "/artists"], str(arts))
        counts = {a["type"]: a["n"] for a in arts}
        tr_ = pg.evaluate(TRUNC, ".hp-name, .hp-meta, .hp-acts .btn, .btn-shuffle, .home-art-list a span, .home-art-title")
        ok(f"{t} 無文字截斷", not tr_, str(tr_))
        ok(f"{t} 整頁沒有橫向溢出", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        ok(f"{t} 熱門藝人、不感興趣都不在", pg.locator(".hot").count() == 0 and pg.get_by_text("不感興趣").count() == 0 and pg.get_by_text("熱門藝人").count() == 0)
        ok(f"{t} 沒有直角以外的圓角（播放器除外）", pg.evaluate("() => [...document.querySelectorAll('[data-testid=home-top] *')].filter(e => !e.matches('iframe')).every(e => getComputedStyle(e).borderRadius === '0px')"))
        pg.screenshot(path=f"{OUT}/首頁_{w}.jpg", type="jpeg", quality=80)
        # 換一首
        h0 = pg.evaluate("() => history.length")
        seen = {track}
        artists_seen = {pk["slug"]} if pk else set()
        consistent = True
        for _ in range(5):
            prev = pg.get_attribute(".hp-sp", "data-track")
            pg.click("[data-testid=pick-shuffle]")
            pg.wait_for_function("p => document.querySelector('.hp-sp') && document.querySelector('.hp-sp').dataset.track !== p", arg=prev, timeout=5000)
            tk = pg.get_attribute(".hp-sp", "data-track")
            q = by_track.get(tk)
            nm = pg.inner_text("[data-testid=pick-name]")
            consistent &= bool(q) and nm == q["name"] and pg.get_attribute("[data-testid=pick-go]", "href") == f"/artist/{q['slug']}"
            seen.add(tk)
            if q:
                artists_seen.add(q["slug"])
        ok(f"{t} 換一首：5 次都換歌、藝人名與連結跟著換", consistent and len(seen) >= 4, f"{len(seen)} 首 {len(artists_seen)} 位")
        ok(f"{t} 換一首不增加上一頁紀錄", pg.evaluate("() => history.length") == h0, f"{h0}→{pg.evaluate('() => history.length')}")
        pg.wait_for_timeout(1500)
        ok(f"{t} console error 0（Spotify iframe 內部另計）", not real(errs), str(real(errs)[:3]))
        if sp_errs:
            print(f"  （Spotify iframe 內部錯誤 {len(sp_errs)} 筆，不算：{sp_errs[:2]}）")
        ctx.close()

    # ---------- /artists?type= ----------
    LABEL = {"male": "男歌手", "female": "女歌手", "group": "團體"}
    for typ in ("male", "female", "group"):
        ctx, pg, errs, _ = open_page(b, 1440, f"/artists?type={typ}")
        rows = pg.evaluate("() => [...document.querySelectorAll('[data-testid=artist-dir] li .sub')].map(e => e.textContent)")
        pressed = pg.get_attribute(f"[data-filter=g-{typ}]", "aria-pressed")
        ok(f"[藝人目錄 type={typ}] 篩選正確、數字跟首頁一致", pressed == "true" and len(rows) == counts.get(typ) and all(r.startswith(LABEL[typ]) for r in rows), f"{len(rows)} vs 首頁 {counts.get(typ)}")
        ok(f"[藝人目錄 type={typ}] console error 0", not real(errs), str(real(errs)[:3]))
        ctx.close()
    ctx, pg, errs, _ = open_page(b, 1440, "/artists")
    ok("[藝人目錄] 全部藝人數跟首頁一致", pg.locator("[data-testid=artist-dir] li").count() == counts.get("all"))
    ctx.close()
    ctx, pg, errs, _ = open_page(b, 1440, "/")
    pg.click(".home-art-list a[data-type=female]")
    pg.wait_for_url(re.compile(r"/artists\?type=female$"))
    pg.wait_for_timeout(500)
    ok("[首頁] 點女歌手進 /artists?type=female 且已篩", pg.get_attribute("[data-filter=g-female]", "aria-pressed") == "true")
    ctx.close()

    # ---------- 頁首：不放「藝人」（2026-09-29 使用者拿掉） ----------
    for w, who in ((1440, "anon"), (1440, "user"), (390, "anon"), (390, "user"), (360, "anon"), (360, "user")):
        ctx, pg, errs, _ = open_page(b, w, "/", user=who == "user")
        pg.wait_for_timeout(500)
        ok(f"[頁首 {w} {who}] 頁首沒有藝人連結", pg.locator("header.nav a[href='/artists']").count() == 0 and pg.locator("[data-testid=nav-artists]").count() == 0)
        if who == "user":
            pg.click("[data-testid=me-avatar]")
            pg.wait_for_timeout(300)
            ok(f"[頁首 {w} {who}] 頭像選單沒有藝人", pg.locator(".menu-panel a[href='/artists']").count() == 0)
        shrink = pg.evaluate("""() => [...document.querySelectorAll('.logo, .nav-icon, .nav-msg, .nav-right .btn, .nav-login, .me-menu summary')].filter(e => e.offsetParent)
              .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className)""")
        ok(f"[頁首 {w} {who}] 頁首元素沒被擠壓", not shrink, str(shrink))
        pg.screenshot(path=f"{OUT}/頁首_{w}_{'登入' if who == 'user' else '訪客'}.jpg", type="jpeg", quality=80, clip={"x": 0, "y": 0, "width": w, "height": 200 if who == "anon" else 520})
        ctx.close()

    # ---------- 隱私權政策 ----------
    ctx, pg, errs, _ = open_page(b, 1440, "/privacy")
    body = pg.inner_text("main")
    ok("[隱私權政策] 有 Spotify 說明", "Spotify：首頁的歌曲播放器" in body and "Spotify 自己的 Cookie" in body)
    ctx.close()

    # ---------- 後台 ----------
    if LOCAL:
        tok = json.loads(urllib.request.urlopen(urllib.request.Request(BASE + "/api/auth/login", data=json.dumps({"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).encode(), headers={"Content-Type": "application/json"}), timeout=30).read())["token"]
        ctx = b.new_context(viewport={"width": 1440, "height": 1000}, user_agent=UA)
        ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(BASE + "/admin/spotify-picks", wait_until="networkidle")
        ok("[後台] 分頁「推薦歌曲」在、目前頁", pg.locator(".admin-tab[aria-current=page]").inner_text() == "推薦歌曲")
        ok("[後台] 列出全部歌", pg.locator("[data-testid=sp-row]").count() == len(picks), f"{pg.locator('[data-testid=sp-row]').count()}")
        pg.screenshot(path=f"{OUT}/後台推薦歌曲_1440.jpg", type="jpeg", quality=80)
        # 壞連結
        pg.fill("[data-testid=sp-url]", "https://example.com/track/abc")
        pg.select_option("[data-testid=sp-artist]", "sunset-rollercoaster")
        pg.click("[data-testid=sp-submit]")
        pg.wait_for_selector(".sp-add .field-error")
        ok("[後台] 不是 Spotify 歌曲連結擋下", "Spotify" in pg.inner_text(".sp-add .field-error"))
        # 新增（落日飛車 Let There Be Light Again，帶 intl 路徑與 ?si=）
        NEW = "4FQUePAIytrm4bxKeFuwjv"
        sql(f"DELETE FROM spotify_picks WHERE track_id = '{NEW}'")
        v0 = sql("SELECT v FROM content_version WHERE id = 1")[0]["v"]
        pg.goto(BASE + "/admin/spotify-picks", wait_until="networkidle")
        pg.fill("[data-testid=sp-url]", f"https://open.spotify.com/intl-zh-tw/track/{NEW}?si=abc123")
        pg.select_option("[data-testid=sp-artist]", "sunset-rollercoaster")
        pg.click("[data-testid=sp-submit]")
        pg.wait_for_selector("[data-testid=sp-added]", timeout=15000)
        added = pg.inner_text("[data-testid=sp-added]")
        row = sql(f"SELECT id, title, enabled FROM spotify_picks WHERE track_id = '{NEW}'")
        ok("[後台] 貼連結新增：解析出 track ID、oEmbed 取到歌名", len(row) == 1 and row[0]["title"] == "Let There Be Light Again", added)
        v1 = sql("SELECT v FROM content_version WHERE id = 1")[0]["v"]
        ok("[後台] 新增讓內容版本加 1", v1 == v0 + 1, f"{v0}→{v1}")
        st, hd, h = get("/")
        ok("[首頁] 新增後生效（歌單有這首、快取 MISS）", NEW in home_tracks(h) and hd.get("x-yz-cache") == "MISS", hd.get("x-yz-cache", ""))
        pg.click(f"[data-testid=sp-row][data-track='{NEW}'] [data-testid=sp-disable]")
        pg.wait_for_selector(f"[data-testid=sp-row][data-track='{NEW}'][data-enabled='0']")
        st, hd, h = get("/")
        ok("[首頁] 停用後生效（歌單沒有這首）", NEW not in home_tracks(h))
        # 既有的一首停用再啟用
        OLD = picks[0]["track"]
        pg.click(f"[data-testid=sp-row][data-track='{OLD}'] [data-testid=sp-disable]")
        pg.wait_for_selector(f"[data-testid=sp-row][data-track='{OLD}'][data-enabled='0']")
        st, hd, h = get("/")
        ok("[首頁] 停用既有的一首後生效", OLD not in home_tracks(h))
        pg.click(f"[data-testid=sp-row][data-track='{OLD}'] [data-testid=sp-enable]")
        pg.wait_for_selector(f"[data-testid=sp-row][data-track='{OLD}'][data-enabled='1']")
        st, hd, h = get("/")
        ok("[首頁] 再啟用後回來", OLD in home_tracks(h))
        pg.click(f"[data-testid=sp-row][data-track='{NEW}'] [data-testid=sp-delete]")
        pg.click(f"[data-testid=sp-row][data-track='{NEW}'] [data-testid=sp-delete-yes]")
        pg.wait_for_selector(f"[data-testid=sp-row][data-track='{NEW}']", state="detached")
        ok("[後台] 刪除後 D1 沒有這列", not sql(f"SELECT id FROM spotify_picks WHERE track_id = '{NEW}'"))
        logs = sql("SELECT action FROM admin_log WHERE action LIKE '%推薦歌曲' ORDER BY id DESC LIMIT 5")
        ok("[後台] 操作都寫進操作紀錄", [l["action"] for l in logs][:5] == ["刪除推薦歌曲", "啟用推薦歌曲", "停用推薦歌曲", "停用推薦歌曲", "新增推薦歌曲"], str(logs))
        ok("[後台] console error 0（刻意觸發的 400 除外）", not [e for e in errs if "400" not in e], str(errs[:3]))
        ctx.close()
        st = urllib.request.Request(BASE + "/api/admin/spotify-picks", data=b'{"action":"delete","id":1}', headers={"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(st, timeout=20)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        ok("[後台 API] 沒登入不能改", code in (401, 403), str(code))
    else:
        try:
            urllib.request.urlopen(urllib.request.Request(BASE + "/api/admin/spotify-picks", headers={"User-Agent": UA}), timeout=20)
            code = 200
        except urllib.error.HTTPError as e:
            code = e.code
        ok("[後台 API] 沒登入 401", code == 401, str(code))
        # 停用一首（D1 直接改）→ 首頁沒有 → 改回 → 首頁有
        OLD = [p for p in picks if p["enabled"]][0]
        sql(f"UPDATE spotify_picks SET enabled = 0 WHERE id = {OLD['id']}")
        time.sleep(1)
        st, hd, h = get("/")
        ok("[首頁] 停用一首後生效（D1 改）", OLD["track"] not in home_tracks(h) and len(home_tracks(h)) == len(tr) - 1, f"{len(home_tracks(h))} 首")
        sql(f"UPDATE spotify_picks SET enabled = 1 WHERE id = {OLD['id']}")
        time.sleep(1)
        st, hd, h = get("/")
        ok("[首頁] 改回後恢復", OLD["track"] in home_tracks(h) and len(home_tracks(h)) == len(tr))
    b.close()

bad = [n for n, c in results if not c]
print(f"\n{len(results) - len(bad)}/{len(results)} 通過")
sys.exit(1 if bad else 0)
