# 會員選單修正驗收：頭像暱稱六種長度 × 1440／390、選單每一項實點（桌機滑鼠、手機觸控）、console error。
# 用法：python3 _驗收.py local <網址> <網站資料夾>   本機：真登入測試管理員，暱稱用 SQL 改本機 D1（跑完還原）
#       python3 _驗收.py prod  <網址>               正式站：不登入、不寫任何資料，用 Playwright 攔截 /api/me 回假帳號
import json, subprocess, sys, requests
from pathlib import Path
from playwright.sync_api import sync_playwright

MODE, B = sys.argv[1], sys.argv[2].rstrip("/")
SITE = Path(sys.argv[3]) if len(sys.argv) > 3 else None
IMG = Path(__file__).parent / "img"; IMG.mkdir(exist_ok=True)
NAMES = [("2字", "阿哲"), ("4字", "音藏樂迷"), ("5字", "音藏小樂迷"), ("6字", "喜歡收藏唱片"), ("8字", "黑膠唱片收藏達人"), ("英文10", "vinyllover")]
EXPECT = {"阿哲": ["阿哲"], "音藏樂迷": ["音藏", "樂迷"], "音藏小樂迷": ["音藏小", "樂迷"], "喜歡收藏唱片": ["喜歡收", "藏唱片"],
          "黑膠唱片收藏達人": ["黑膠唱", "片…"], "vinyllover": ["vinyl", "lover"]}
SMALL = {"音藏小樂迷", "喜歡收藏唱片", "黑膠唱片收藏達人", "vinyllover"}
ITEMS = [("我的頁", None), ("喜愛清單", "/me/likes"), ("私訊", "/messages"), ("管理後台", "/admin"), ("設定", "/settings")]
res = []
def check(n, ok, d=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, str(d)[:200])

def sql(cmd):
    subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                    "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--command", cmd], cwd=SITE, capture_output=True, check=True)

ME = {"id": "fake", "email": "fake@example.com", "handle": "yztestuser", "name": "", "bio": "", "role": "user", "verified": True, "admin": True, "deletionRequested": False}
STATE = {"liked": [], "owned": [], "wanted": [], "follows": [], "dismissed": [], "reported": [], "appeals": [], "unread": 0}
tok = None
if MODE == "local":
    tok = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]

def context(p, mobile, name):
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 390, "height": 844} if mobile else {"width": 1440, "height": 900}, has_touch=mobile, is_mobile=mobile, device_scale_factor=2 if mobile else 1)
    if tok:
        from urllib.parse import urlparse
        ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": urlparse(B).hostname, "path": "/", "httpOnly": True, "secure": B.startswith("https")}])
    else:
        body = json.dumps({"user": dict(ME, name=name), "state": STATE})
        ctx.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=body) if r.request.method == "GET" else r.continue_())
    return br, ctx

def settle(pg):
    try: pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception: pg.wait_for_load_state("load")
    pg.evaluate("document.fonts.ready"); pg.wait_for_selector("summary.ava", timeout=10000); pg.wait_for_timeout(300)

MEASURE = """() => { const s = document.querySelector('summary.ava'); const r = s.getBoundingClientRect();
  const spans = [...s.querySelectorAll('span')].map(e => { const g = document.createRange(); g.selectNodeContents(e); const q = g.getBoundingClientRect();
    return {t: e.textContent, l: q.left, r: q.right, top: q.top, b: q.bottom}; });
  return {w: r.width, h: r.height, l: r.left, r: r.right, top: r.top, b: r.bottom, fs: getComputedStyle(s).fontSize, title: s.title,
          aria: s.getAttribute('aria-label'), spans, sw: document.documentElement.scrollWidth, iw: innerWidth}; }"""

with sync_playwright() as p:
    for tag, name in NAMES:
        if MODE == "local": sql(f"update users set name='{name}' where email='admin@demo.yinzang.test'")
        for mobile in (False, True):
            br, ctx = context(p, mobile, name); pg = ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            # 正式站的假帳號 handle 不存在，「我的頁」/u/yztestuser 回 404 是預期；未登入打 /api/* 的 401 也是預期。其餘 4xx/5xx 都算錯
            pg.on("response", lambda r: r.status >= 400 and not ("/u/yztestuser" in r.url or (r.status == 401 and "/api/" in r.url)) and errs.append(f"{r.status} {r.url}"))
            pg.on("console", lambda m: m.type == "error" and "Failed to load resource" not in m.text and errs.append(m.text[:160]))
            pg.goto(B + "/"); settle(pg); m = pg.evaluate(MEASURE)
            vw = "390" if mobile else "1440"
            inside = all(s["l"] >= m["l"] - .5 and s["r"] <= m["r"] + .5 and s["top"] >= m["top"] - .5 and s["b"] <= m["b"] + .5 for s in m["spans"])
            check(f"{MODE} {tag} {vw} 框 40×40、字在框內、不破版", round(m["w"]) == 40 and round(m["h"]) == 40 and inside and m["sw"] <= m["iw"],
                  f"{m['w']}×{m['h']} fs={m['fs']} sw={m['sw']}/{m['iw']} spans={[(s['t'], round(s['r']-s['l'],1)) for s in m['spans']]}")
            check(f"{MODE} {tag} {vw} 文字與字級", [s["t"] for s in m["spans"]] == EXPECT[name] and (m["fs"] == "11px") == (name in SMALL), f"{[s['t'] for s in m['spans']]} {m['fs']}")
            check(f"{MODE} {tag} {vw} title／aria-label 是全名", m["title"] == name and name in (m["aria"] or ""), f"{m['title']} | {m['aria']}")
            hdr = {"x": 0, "y": 0, "width": 1440 if not mobile else 390, "height": 64}
            pg.screenshot(path=str(IMG / f"{MODE}_{tag}_{vw}.jpg"), type="jpeg", quality=80, clip=hdr)
            if tag == "4字":
                pg.locator("summary.ava").click(); pg.wait_for_timeout(300)
                pg.screenshot(path=str(IMG / f"{MODE}_選單展開_{vw}.jpg"), type="jpeg", quality=80)
                for label, path in ITEMS:
                    pg.goto(B + "/"); settle(pg)
                    s = pg.locator("summary.ava"); s.tap() if mobile else s.click(); pg.wait_for_timeout(300)
                    a = pg.locator(".menu-panel a", has_text=label); href = a.get_attribute("href")
                    a.tap() if mobile else a.click()
                    try: pg.wait_for_url(lambda u: u.split("?")[0].endswith(href), timeout=8000); ok = True
                    except Exception: ok = False
                    pg.wait_for_timeout(300)
                    closed = pg.evaluate("!document.querySelector('.me-menu')?.open")
                    check(f"{MODE} 選單「{label}」{vw} {'觸控' if mobile else '滑鼠'}點了會換頁、選單收起", ok and closed, f"{href} → {pg.url}")
            check(f"{MODE} {tag} {vw} 沒有 console error", not errs, errs[:3])
            br.close()
    if MODE == "local":
        # 登出按鈕最後測（會讓這組 token 失效）
        br, ctx = context(p, False, ""); pg = ctx.new_page(); pg.goto(B + "/"); settle(pg)
        pg.locator("summary.ava").click(); pg.locator(".menu-item", has_text="登出").click()
        pg.wait_for_selector(".nav-login", timeout=8000); check("local 選單「登出」點了會登出", True); br.close()
        sql("update users set name='音藏管理員' where email='admin@demo.yinzang.test'")
print(f"\n{sum(res)}/{len(res)} 通過")
