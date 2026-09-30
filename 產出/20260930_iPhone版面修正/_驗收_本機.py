import json, sys, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; OUT = sys.argv[2]
ME = {"geo": {"country": "TW", "canTrade": True},
      "user": {"id": "u1", "email": "t@example.com", "handle": "tester", "name": "測試", "bio": "", "role": "member",
               "verified": True, "admin": False, "deletionRequested": False, "avatar": None, "nameNextAt": None},
      "state": {"liked": [], "owned": [], "wanted": [], "follows": [], "reported": [], "appeals": [], "unread": 0, "dismissed": []}}
def mocker(delay=0):
    def mock(route):
        if delay: time.sleep(delay)
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(ME))
    return mock
TAG = """() => { const t = document.querySelector('.home-tagline'); const top = document.querySelector('.home-top');
  const cs = getComputedStyle(t); return {state: t.dataset.state, auth: document.documentElement.dataset.auth||'', disp: cs.display, op: cs.opacity,
  gap: Math.round(top.getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom)} }"""
PAGES = ["/", "/artists", "/about", "/guide", "/ranking", "/search", "/share/new"]
fails = 0
with sync_playwright() as p:
    for eng in ("webkit", "chromium"):
        b = getattr(p, eng).launch()
        # Bug1：訪客／登入者（首次）／登入者（上次登入，/api/me 延遲 3 秒量第一個畫面）
        for w in (390, 375, 360, 320):
            for mode in ("anon", "user", "user-hint"):
                ctx = b.new_context(viewport={"width": w, "height": 844}, device_scale_factor=3 if eng == "webkit" else 2)
                pg = ctx.new_page(); errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.on("pageerror", lambda e: errs.append(str(e)))
                if mode != "anon": pg.route("**/api/me", mocker(3 if mode == "user-hint" else 0))
                if mode == "user-hint":
                    ctx.add_init_script("try{localStorage.setItem('lmb_auth','user')}catch(e){}")
                pg.goto(BASE + "/", wait_until="domcontentloaded", timeout=45000)
                early = pg.evaluate(TAG) if mode == "user-hint" else None
                pg.wait_for_timeout(4500 if mode == "user-hint" else 2500)
                r = pg.evaluate(TAG)
                ok = (r["disp"] == "flex" and r["op"] == "1") if mode == "anon" else (r["disp"] == "none")
                if mode == "user-hint": ok = ok and early["disp"] == "none"
                errs = [e for e in errs if "spotify" not in e.lower()]
                if errs: ok = False
                fails += not ok
                print("OK " if ok else "BAD", eng, w, mode, "early=", early, "final=", r, errs[:2])
                if w == 390 and eng == "webkit": pg.screenshot(path=f"{OUT}/home_{eng}_{w}_{mode}.jpg", type="jpeg", quality=80)
                ctx.close()
        # Bug2＋整站寬度
        for w in (390, 375, 360, 320):
            ctx = b.new_context(viewport={"width": w, "height": 844}, device_scale_factor=3 if eng == "webkit" else 2)
            pg = ctx.new_page(); pg.route("**/api/me", mocker())
            for path in PAGES:
                pg.goto(BASE + path, wait_until="load", timeout=45000); pg.wait_for_timeout(1500)
                sw = pg.evaluate("document.documentElement.scrollWidth")
                ok = sw <= w
                extra = ""
                if path == "/share/new":
                    d = pg.evaluate("""() => { const d = document.querySelector('.drop'); const r = d.getBoundingClientRect(); return {x:r.x, right:r.right, bw:getComputedStyle(d).borderLeftWidth} }""")
                    f = f"{OUT}/drop_{eng}_{w}.png"; pg.locator(".drop").screenshot(path=f)
                    from PIL import Image
                    im = Image.open(f).convert("RGB"); W, H = im.size
                    dark = lambda xs: max(sum(1 for y in range(H) if sum(im.getpixel((x, y))) < 500) for x in xs)
                    L, R = dark(range(4)), dark(range(W - 4, W))
                    ok = ok and L > H * 0.3 and R > H * 0.3
                    extra = f"drop={d} 左邊深色像素 {L}/{H} 右邊 {R}/{H}"
                fails += not ok
                print("OK " if ok else "BAD", eng, w, path, "scrollW", sw, extra)
                if eng == "webkit" and w in (390, 320): pg.screenshot(path=f"{OUT}/page_{eng}_{w}{path.replace('/','_') or '_home'}.jpg", type="jpeg", quality=80)
            ctx.close()
        b.close()
print("FAILS", fails)
