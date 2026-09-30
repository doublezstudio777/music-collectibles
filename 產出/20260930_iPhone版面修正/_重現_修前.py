import json, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else "https://lemibox.com"
OUT = sys.argv[2] if len(sys.argv) > 2 else "before"
ME = {"geo": {"country": "TW", "canTrade": True},
      "user": {"id": "u1", "email": "t@example.com", "handle": "tester", "name": "測試", "bio": "", "role": "member",
               "verified": True, "admin": False, "deletionRequested": False, "avatar": None, "nameNextAt": None},
      "state": {"liked": [], "owned": [], "wanted": [], "follows": [], "reported": [], "appeals": [], "unread": 0, "dismissed": []}}
def mock(route):
    if route.request.url.split("?")[0].endswith("/api/me"):
        return route.fulfill(status=200, content_type="application/json", body=json.dumps(ME))
    return route.continue_()
with sync_playwright() as p:
    for eng in ("webkit", "chromium"):
        b = getattr(p, eng).launch()
        for w in (390, 375, 360, 320):
            for login in (False, True):
                ctx = b.new_context(viewport={"width": w, "height": 844}, device_scale_factor=3 if eng == "webkit" else 1)
                pg = ctx.new_page()
                if login: pg.route("**/api/me*", mock)
                pg.goto(BASE + "/", wait_until="load", timeout=45000)
                pg.wait_for_timeout(2500)
                r = pg.evaluate("""() => { const t = document.querySelector('.home-tagline'); const top = document.querySelector('.home-top');
                  const cs = getComputedStyle(t); const r = t.getBoundingClientRect();
                  return {vis: t.dataset.visible, disp: cs.display, op: cs.opacity, h: r.height, topY: top.getBoundingClientRect().top,
                          scrollW: document.documentElement.scrollWidth} }""")
                print(eng, w, "login" if login else "anon", r)
                if w == 390 and eng == "webkit": pg.screenshot(path=f"{OUT}_home_{eng}_{w}_{'login' if login else 'anon'}.jpg", type="jpeg", quality=80)
                if login:
                    pg.goto(BASE + "/share/new", wait_until="load", timeout=45000)
                    pg.wait_for_timeout(2500)
                    d = pg.evaluate("""() => { const d = document.querySelector('.drop'); if (!d) return null; const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);
                      const par = d.parentElement.getBoundingClientRect();
                      return {x: r.x, w: r.width, right: r.right, vw: innerWidth, bl: cs.borderLeftWidth, bs: cs.borderLeftStyle, parX: par.x, parR: par.right} }""")
                    print("   drop", d)
                    if eng == "webkit" and d:
                        pg.locator(".drop").screenshot(path=f"{OUT}_drop_{eng}_{w}.png")
                ctx.close()
        b.close()
