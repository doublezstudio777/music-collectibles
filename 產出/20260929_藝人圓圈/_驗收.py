"""藝人圓圈驗收（首頁一排、/artists 格狀、頁首藝人連結）。
用法：python3 _驗收.py [網址] [截圖子資料夾]，預設本機 8791、img/本機
"""
import json, os, re, sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "img", sys.argv[2] if len(sys.argv) > 2 else "本機")
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
results = []

def ok(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  {info}" if info else ""))

def me(follows):
    return {"geo": {"country": "TW", "canTrade": True},
            "user": {"id": "x", "email": "a@b.c", "handle": "tester", "name": "測試帳號", "bio": "", "role": "member", "verified": True, "admin": False, "deletionRequested": False, "avatar": None},
            "state": {"liked": [], "owned": [], "wanted": [], "follows": follows, "reported": [], "appeals": [], "unread": 0, "dismissed": []}}

TRUNC = """(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null)
  .filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map(e => e.textContent)"""

def real(errs):
    return [e for e in errs if not e.startswith("Failed to load resource")]

def open_page(b, w, path, follows=None):
    ctx = b.new_context(viewport={"width": w, "height": 900}, user_agent=UA)
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    # 模擬登入時假帳號 tester 的個人頁預先載入會 404（帳號不存在），不算；其他 4xx/5xx 照算
    pg.on("response", lambda r: errs.append(f"{r.status} {r.url}") if r.status >= 400 and "/u/tester" not in r.url else None)
    if follows is not None:
        pg.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(me(follows))))
    pg.goto(BASE + path, wait_until="networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(600)
    return ctx, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- 首頁 ----------
    for w in (1440, 390, 360):
        ctx, pg, errs = open_page(b, w, "/")
        t = f"[首頁 {w}]"
        row = pg.locator("[data-testid=artist-row]")
        ok(f"{t} 藝人圓圈列存在", row.count() == 1)
        order = pg.evaluate("""() => { const q = s => document.querySelector(s); const all = [...document.querySelectorAll('.home-tagline, [data-testid=artist-row], .wall-bar')];
            return all.map(e => e.matches('.home-tagline') ? 'tagline' : e.matches('.wall-bar') ? 'bar' : 'row'); }""")
        ok(f"{t} 順序：標語→圓圈→排序分頁籤", order == ["tagline", "row", "bar"], str(order))
        ok(f"{t} 熱門藝人區塊已拿掉", pg.locator(".hot").count() == 0 and pg.get_by_text("不感興趣").count() == 0 and pg.get_by_text("熱門藝人").count() == 0)
        faces = pg.evaluate("""() => [...document.querySelectorAll('.faces-row .face')].map(li => { const i = li.querySelector('.face-img'); const r = i.getBoundingClientRect();
            return {slug: li.dataset.artist || '', kind: i.dataset.face || 'more', w: Math.round(r.width), h: Math.round(r.height), rad: getComputedStyle(i).borderRadius,
                    loaded: i.tagName !== 'IMG' || r.right > innerWidth || (i.complete && i.naturalWidth > 0), name: li.querySelector('.face-name').textContent,
                    href: li.querySelector('a').getAttribute('href')}; })""")
        kinds = {k: sum(1 for f in faces if f["kind"] == k) for k in ("artist", "share", "none")}
        ok(f"{t} 最多 24 位＋全部藝人", 1 < len(faces) <= 25, f"{len(faces)} 格 {kinds}")
        ok(f"{t} 最後一格是全部藝人→/artists", faces[-1]["name"] == "全部藝人" and faces[-1]["href"] == "/artists")
        ok(f"{t} 圓圈是正圓", all(f["w"] == f["h"] and f["rad"] == "50%" for f in faces), str({(f['w'], f['rad']) for f in faces}))
        ok(f"{t} 畫面內的照片都載入", all(f["loaded"] for f in faces))
        ok(f"{t} 沒有官方封面（圖只來自 /img/）", pg.evaluate("() => [...document.querySelectorAll('.faces-row img')].every(i => new URL(i.src).pathname.startsWith('/img/'))"))
        cnt = pg.evaluate("""() => [...document.querySelectorAll('.faces-row .face[data-artist]')].map(li => li.dataset.artist)""")
        tr = pg.evaluate(TRUNC, ".face-name")
        ok(f"{t} 名字無截斷", not tr, str(tr))
        sc = pg.evaluate("() => { const r = document.querySelector('.faces-row'); return {sw: r.scrollWidth, cw: r.clientWidth, ox: getComputedStyle(r).overflowX}; }")
        ok(f"{t} 放不下時可左右滑", sc["sw"] <= sc["cw"] or sc["ox"] == "auto", str(sc))
        ok(f"{t} 整頁沒有橫向溢出", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        ok(f"{t} console error 0", not real(errs), str(real(errs)[:3]))
        pg.screenshot(path=f"{OUT}/首頁_{w}.jpg", type="jpeg", quality=80)
        ctx.close()

    # 追蹤排序：已追蹤的移到最前（瀏覽器端）
    ctx, pg, errs = open_page(b, 1440, "/", follows=[])
    base_order = pg.evaluate("() => [...document.querySelectorAll('.faces-row .face[data-artist]')].map(li => li.dataset.artist)")
    ctx.close()
    target = base_order[-1]
    ctx, pg, errs = open_page(b, 1440, "/", follows=[target])
    fo = pg.evaluate("() => [...document.querySelectorAll('.faces-row .face[data-artist]')].map(li => li.dataset.artist)")
    ok("[首頁] 已追蹤的藝人排最前", fo[0] == target and fo[1:] == [x for x in base_order if x != target][: len(fo) - 1], f"{target}")
    html = pg.content()
    ok("[首頁] console error 0（登入狀態）", not real(errs), str(real(errs)[:3]))
    ctx.close()
    raw = b.new_context(user_agent=UA).request.get(BASE + "/").text()
    first = re.findall(r'class="face" data-artist="([^"]+)"', raw)
    ok("[首頁] 伺服器輸出依收藏數排（快取 HTML 不因人而異）", first[:3] == base_order[:3], str(first[:3]))

    # ---------- /artists ----------
    for w in (1440, 390, 360):
        ctx, pg, errs = open_page(b, w, "/artists")
        t = f"[藝人目錄 {w}]"
        cols = pg.evaluate("""() => { const li = [...document.querySelectorAll('.face-grid .face')]; if (!li.length) return 0; const top = li[0].getBoundingClientRect().top;
            return li.filter(e => Math.abs(e.getBoundingClientRect().top - top) < 2).length; }""")
        want = 6 if w >= 1000 else 3
        ok(f"{t} 一排 {want} 位", cols == want, f"{cols}")
        kinds = pg.evaluate("() => ['artist','share','none'].map(k => document.querySelectorAll(`.face-grid [data-face=${k}]`).length)")
        ok(f"{t} 三種圓圈都有", all(kinds), str(kinds))
        ok(f"{t} 每格有名字與收藏數", pg.evaluate("() => [...document.querySelectorAll('.face-grid .face')].every(li => li.querySelector('.face-name').textContent && /\\d+ 則收藏/.test(li.querySelector('.sub').textContent))"))
        ok(f"{t} 沒有追蹤按鈕", pg.locator(".face-grid .follow").count() == 0)
        ok(f"{t} 篩選是分頁籤樣式（非灰色小方塊）", pg.locator(".dir-bar a.filter").count() == 5 and pg.locator(".filter-picks, .dir-bar .pick").count() == 0)
        tr = pg.evaluate(TRUNC, ".face-grid .face-name, .face-grid .sub, .dir-bar .filter")
        ok(f"{t} 無文字截斷", not tr, str(tr))
        ok(f"{t} 整頁沒有橫向溢出", pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth"))
        ok(f"{t} console error 0", not real(errs), str(real(errs)[:3]))
        pg.screenshot(path=f"{OUT}/藝人目錄_{w}.jpg", type="jpeg", quality=80, full_page=True)
        ctx.close()
    ctx, pg, errs = open_page(b, 1440, "/artists")
    total = pg.locator(".face-grid .face").count()
    pg.click("[data-filter=g-female]")
    pg.wait_for_url(re.compile(r"g=female"))
    pg.wait_for_timeout(500)
    fem = pg.locator(".face-grid .face").count()
    ok("[藝人目錄] 女歌手篩選有結果且當前項有底線", 0 < fem < total and pg.locator("[data-filter=g-female][aria-current=page]").count() == 1, f"{fem}/{total}")
    pg.click("[data-filter=g-female]")
    pg.wait_for_url(re.compile(r"/artists$"))
    pg.wait_for_timeout(500)
    ok("[藝人目錄] 再點一次取消", pg.locator(".face-grid .face").count() == total)
    ctx.close()

    # ---------- 頁首 ----------
    ctx, pg, errs = open_page(b, 1440, "/")
    pos = pg.evaluate("""() => { const r = s => document.querySelector(s).getBoundingClientRect(); return {search: r('.nav-search').right, link: r('[data-testid=nav-artists]').left, linkR: r('[data-testid=nav-artists]').right, msg: r('.nav-msg').left}; }""")
    ok("[頁首 1440] 藝人在搜尋框右邊、私訊之前", pos["search"] <= pos["link"] and pos["linkR"] <= pos["msg"], str(pos))
    pg.click("[data-testid=nav-artists]")
    pg.wait_for_url(re.compile(r"/artists$"))
    ok("[頁首 1440] 點了進 /artists", True)
    ctx.close()
    for w, who in ((360, "anon"), (360, "user"), (390, "anon"), (390, "user")):
        ctx, pg, errs = open_page(b, w, "/", follows=None if who == "anon" else [])
        link_vis = pg.locator("[data-testid=nav-artists]").is_visible()
        shrink = pg.evaluate("""() => [...document.querySelectorAll('.logo, .nav-link, .nav-icon, .nav-msg, .nav-right .btn, .nav-login, .me-menu summary')].filter(e => e.offsetParent)
              .filter(e => e.scrollWidth > e.clientWidth + 1 || (e.matches('.nav-icon, .nav-msg') && e.getBoundingClientRect().width < 44)).map(e => e.className)""")
        ok(f"[頁首 {w} {who}] 頁首元素沒被擠壓", not shrink, str(shrink))
        if w == 360 and who == "user":
            ok(f"[頁首 {w} {who}] 頁首放不下，藝人改在頭像選單第一項", not link_vis)
            pg.click("[data-testid=me-avatar]")
            pg.wait_for_timeout(300)
            first = pg.evaluate("() => [...document.querySelectorAll('.menu-panel > a, .menu-panel > button')].find(e => e.offsetParent)?.textContent")
            ok(f"[頁首 {w} {who}] 選單第一項是藝人", first == "藝人", str(first))
            pg.screenshot(path=f"{OUT}/頁首選單_{w}_登入.jpg", type="jpeg", quality=80, clip={"x": 0, "y": 0, "width": w, "height": 520})
        else:
            ok(f"[頁首 {w} {who}] 藝人在頁首", link_vis)
            if who == "user":
                pg.click("[data-testid=me-avatar]")
                pg.wait_for_timeout(300)
                ok(f"[頁首 {w} {who}] 選單裡沒有重複的藝人", not pg.locator("[data-testid=menu-artists]").is_visible())
        pg.screenshot(path=f"{OUT}/頁首_{w}_{'登入' if who == 'user' else '訪客'}.jpg", type="jpeg", quality=80, clip={"x": 0, "y": 0, "width": w, "height": 200})
        ok(f"[頁首 {w} {who}] console error 0", not real(errs), str(real(errs)[:3]))
        ctx.close()
    b.close()

bad = [n for n, c in results if not c]
print(f"\n{len(results) - len(bad)}/{len(results)} 通過")
sys.exit(1 if bad else 0)
