# 第 2a 階段驗收：帳號、D1、API、登入面板、狀態搬家、截圖溢出
# 用法：dev server 跑在 5173（npm run dev，輸出導到 LOG），python3 _驗收.py [LOG 路徑]
# 驗證碼從 dev server 的終端機輸出抓（本機寄信＝印在 console）
import json, re, subprocess, sys, tempfile, time, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

B = "http://localhost:5173"
HERE = Path(__file__).parent
SITE = HERE.parent.parent / "網站"
IMG = HERE / "img"; IMG.mkdir(exist_ok=True)
LOG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dev.log")
STAMP = str(int(time.time()))[-6:]
EMAIL = f"fan{STAMP}@example.com"; HANDLE = f"fan{STAMP}"; PW = "listen-2026"
R = {"checks": [], "pages": {}, "stamp": STAMP}


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name, detail)


def api(path, body=None, headers=None, method=None):
    req = urllib.request.Request(B + path, data=None if body is None else json.dumps(body).encode(),
                                 method=method or ("GET" if body is None else "POST"))
    req.add_header("content-type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def code_for(email, purpose="驗證碼是"):
    for _ in range(40):
        m = re.findall(rf"to={re.escape(email)} .*?\n.*?{purpose} (\d{{6}})", LOG.read_text(errors="ignore"))
        if m:
            return m[-1]
        time.sleep(0.25)
    return None


def settle(pg):
    # 有 Turnstile 小框的頁面（/login）iframe 會一直連線，networkidle 等不到，最多等 8 秒
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pg.wait_for_load_state("load")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)


def wait_turnstile(scope):
    scope.locator("input[name=cf-turnstile-response]").first.wait_for(state="attached", timeout=20000)
    scope.page.wait_for_function(
        "() => [...document.querySelectorAll('input[name=cf-turnstile-response]')].some(i => i.value)", timeout=20000)


def pressed(loc):
    loc.wait_for(state="visible")
    for _ in range(40):
        v = loc.get_attribute("aria-pressed")
        if v is not None:
            return v
        time.sleep(0.1)
    return None


def panel_login(pg, email, pw):
    p = pg.locator("[data-testid=auth-panel]")
    p.locator("#panel-email").fill(email)
    p.locator("#panel-password").fill(pw)
    wait_turnstile(p)
    p.locator(".auth-submit").click()


# ---------- A. 遷移：空資料庫跑到最新，再跑一次無變更 ----------
empty = tempfile.mkdtemp(prefix="yinzang-empty-d1-")
w = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
     "d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", str(empty)]
o1 = subprocess.run(w, cwd=SITE, capture_output=True, text=True)
o2 = subprocess.run(w, cwd=SITE, capture_output=True, text=True)
check("A 空資料庫套遷移成功", o1.returncode == 0 and "0000_account.sql" in o1.stdout and "✅" in o1.stdout,
      re.findall(r"\d+ commands executed successfully", o1.stdout))
check("A 再跑一次無變更", o2.returncode == 0 and "No migrations to apply" in o2.stdout, o2.stdout.strip().splitlines()[-1:])
tables = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
                         "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", str(empty),
                         "--json", "--command", "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"],
                        cwd=SITE, capture_output=True, text=True)
names = [r["name"] for r in json.loads(tables.stdout)[0]["results"]] if tables.returncode == 0 else []
users_n = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
                          "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", str(empty),
                          "--json", "--command", "SELECT count(*) AS n FROM users"], cwd=SITE, capture_output=True, text=True)
check("A 遷移只建結構、沒有示範資料（users 0 列）", json.loads(users_n.stdout)[0]["results"][0]["n"] == 0, names)
R["tables"] = names

with sync_playwright() as p:
    br = p.chromium.launch()
    errs = []

    def new_ctx(w=1440, h=900):
        ctx = br.new_context(viewport={"width": w, "height": h})
        pg = ctx.new_page()
        pg.on("console", lambda m: errs.append((pg.url, m.text, (m.location or {}).get("url", ""))) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append((pg.url, str(e), "")))
        return ctx, pg

    # ---------- B. 註冊 → 驗證 → 登出 → 登入 → 點讚／追蹤／我有 → 重新整理、換 context ----------
    ctx, pg = new_ctx()
    pg.goto(B + "/"); settle(pg)
    pg.locator(".nav-login").click()
    panel = pg.locator("[data-testid=auth-panel]")
    panel.get_by_role("button", name="註冊").click()
    panel.locator("#panel-email").fill(EMAIL)
    panel.locator("#panel-password").fill(PW)
    panel.locator("#panel-handle").fill(HANDLE)
    panel.locator("#panel-name").fill("阿樂")
    wait_turnstile(panel)
    pg.screenshot(path=str(IMG / "面板_註冊_1440.jpg"), type="jpeg", quality=80)
    panel.locator(".auth-submit").click()
    panel.locator(".auth-form[data-mode=verify]").wait_for()
    check("B 註冊後進驗證碼步驟、提示已寄出", EMAIL in panel.locator(".auth-note").inner_text())
    code = code_for(EMAIL)
    check("B console 拿到 6 位數驗證碼", bool(code), code)
    panel.locator("#panel-code").fill(code)
    panel.locator(".auth-submit").click()
    panel.wait_for(state="detached")
    settle(pg)
    check("B 驗證後直接登入（導覽列出現頭像）", pg.locator("summary.ava").inner_text() == "阿")
    pg.locator("summary.ava").click()
    pg.locator(".menu-panel").get_by_role("button", name="登出").click()
    pg.locator(".nav-login").wait_for()
    check("B 登出後導覽列回到「登入」", pg.locator(".nav-login").is_visible())
    pg.locator(".nav-login").click()
    panel_login(pg, EMAIL, PW)
    panel.wait_for(state="detached"); settle(pg)
    check("B 重新登入成功", pg.locator("summary.ava").count() == 1)

    pg.goto(B + "/share/1"); settle(pg)
    like = pg.locator(".detail .like").first
    before = int(like.locator(".num").inner_text())
    like.click(); pg.wait_for_timeout(600)
    check("B 單則頁點讚亮起、讚數 +1", pressed(like) == "true" and int(like.locator(".num").inner_text()) == before + 1)
    pg.goto(B + "/artist/mountain-radio"); settle(pg)
    fol = pg.locator(".head-actions .follow")
    fol.click(); pg.wait_for_timeout(600)
    check("B 藝人頁追蹤亮起", pressed(fol) == "true" and fol.inner_text() == "追蹤中")
    pg.goto(B + "/artist/mountain-radio/1"); settle(pg)
    own = pg.locator("#cd .hold").first
    own.click(); pg.wait_for_timeout(600)
    check("B 版本「我有」亮起", pressed(own) == "true")

    pg.reload(); settle(pg)
    check("B 重新整理後「我有」仍在", pressed(pg.locator("#cd .hold").first) == "true")
    pg.goto(B + "/share/1"); settle(pg)
    check("B 重新整理後點讚仍在", pressed(pg.locator(".detail .like").first) == "true")
    pg.goto(B + "/u/" + HANDLE); settle(pg)
    check("B 個人頁列出追蹤藝人與我有", pg.locator("[data-testid=follow-list] .row-main").all_inner_texts() == ["山線電台"]
          and pg.locator("#owned tbody tr").count() == 1)
    pg.goto(B + "/me/likes"); settle(pg)
    check("B 喜愛清單有這一則", pg.locator(".wall .card").count() == 1)
    ctx.close()

    ctx2, pg2 = new_ctx()
    pg2.goto(B + "/login?next=/artist/mountain-radio"); settle(pg2)
    pg2.locator("#page-email").fill(EMAIL); pg2.locator("#page-password").fill(PW)
    wait_turnstile(pg2.locator(".auth-page")); pg2.locator(".auth-submit").click()
    pg2.wait_for_url("**/artist/mountain-radio"); settle(pg2)
    check("B 另一個瀏覽器 context 登入後回到 next 頁，追蹤仍在", pressed(pg2.locator(".head-actions .follow")) == "true")
    pg2.goto(B + "/share/1"); settle(pg2)
    check("B 另一個 context 點讚仍在", pressed(pg2.locator(".detail .like").first) == "true")
    pg2.goto(B + "/artist/mountain-radio/1"); settle(pg2)
    check("B 另一個 context 我有仍在", pressed(pg2.locator("#cd .hold").first) == "true")
    ctx2.close()

    # ---------- C. 未登入點讚 → 面板 → 登入 → 原頁愛心亮起 ----------
    ctx3, pg3 = new_ctx(390, 844)
    pg3.goto(B + "/share/2"); settle(pg3)
    pg3.locator(".detail .like").first.click()
    p3 = pg3.locator("[data-testid=auth-panel]")
    p3.wait_for()
    check("C 未登入點讚彈出登入面板、不跳頁", pg3.url.endswith("/share/2") and "登入後才能點讚" in p3.inner_text())
    wait_turnstile(p3)
    pg3.screenshot(path=str(IMG / "面板_未登入點讚_390.jpg"), type="jpeg", quality=80)
    panel_login(pg3, EMAIL, PW)
    p3.wait_for(state="detached"); pg3.wait_for_timeout(800)
    check("C 登入後留在原頁、愛心亮起", pg3.url.endswith("/share/2") and pressed(pg3.locator(".detail .like").first) == "true")
    pg3.reload(); settle(pg3)
    check("C 重新整理後仍亮（真的寫進 D1）", pressed(pg3.locator(".detail .like").first) == "true")
    ctx3.close()

    # ---------- D. App 路徑：Bearer token ----------
    st, body = api("/api/auth/login", {"email": EMAIL, "password": PW, "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"})
    tok = body.get("token")
    check("D App 登入回 token（不發 cookie）", st == 200 and bool(tok))
    st, s = api("/api/me/state", headers={"authorization": f"Bearer {tok}"})
    check("D Bearer 讀 /api/me/state", st == 200 and s.get("liked") == [1, 2] and s.get("follows") == ["mountain-radio"], s)
    st, _ = api("/api/me/follows", {"artist": "tide-highway", "on": True}, headers={"authorization": f"Bearer {tok}"})
    st2, s2 = api("/api/me/state", headers={"authorization": f"Bearer {tok}"})
    check("D Bearer 寫入追蹤", st == 200 and "tide-highway" in s2.get("follows", []))
    api("/api/me/follows", {"artist": "tide-highway", "on": False}, headers={"authorization": f"Bearer {tok}"})
    st, e = api("/api/me/state")
    check("D 沒帶 token 回 401 UNAUTHENTICATED", st == 401 and e["error"]["code"] == "UNAUTHENTICATED")
    st, e = api("/api/me/likes", {"share": 5, "on": True}, headers={"cookie": f"yz_session={tok}"})
    check("D cookie 寫入沒帶同站 Origin 擋下（CSRF）", st == 403 and e["error"]["code"] == "BAD_ORIGIN")
    st, pub = api("/api/users/" + HANDLE)
    check("D 公開個人資料只給我有／想要，不給追蹤與點讚", st == 200 and "follows" not in pub and "liked" not in pub and len(pub["owned"]) == 1)
    R["curl"] = f'curl -H "Authorization: Bearer <token>" {B}/api/me/state'

    # ---------- E. 錯誤情境 ----------
    ctx4, pg4 = new_ctx()
    pg4.goto(B + "/login"); settle(pg4)
    pg4.locator("#page-email").fill(EMAIL); pg4.locator("#page-password").fill("wrong-password")
    wait_turnstile(pg4.locator(".auth-page")); pg4.locator(".auth-submit").click()
    pg4.locator(".field-error").wait_for()
    check("E 錯密碼：顯示「Email 或密碼不對」", pg4.locator(".field-error").inner_text() == "Email 或密碼不對")
    pg4.screenshot(path=str(IMG / "登入頁_錯密碼_1440.jpg"), type="jpeg", quality=80)

    st, _ = api("/api/auth/register", {"email": "u" + EMAIL, "password": PW, "handle": "u" + HANDLE, "name": "未驗證",
                                       "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"})
    pg4.goto(B + "/login"); settle(pg4)
    pg4.locator("#page-email").fill("u" + EMAIL); pg4.locator("#page-password").fill(PW)
    wait_turnstile(pg4.locator(".auth-page")); pg4.locator(".auth-submit").click()
    pg4.locator(".auth-form[data-mode=verify]").wait_for()
    check("E 未驗證 Email 登入：擋下並轉到驗證碼步驟", st == 201 and "還沒驗證" in pg4.locator(".auth-note").inner_text())

    pg4.goto(B + "/login?mode=register"); settle(pg4)
    pg4.locator("#page-email").fill(EMAIL); pg4.locator("#page-password").fill(PW)
    pg4.locator("#page-handle").fill("dup" + STAMP); pg4.locator("#page-name").fill("重複")
    wait_turnstile(pg4.locator(".auth-page")); pg4.locator(".auth-submit").click()
    pg4.locator(".field-error").wait_for()
    check("E 重複註冊：顯示已註冊過", "已經註冊過" in pg4.locator(".field-error").inner_text())
    st, e = api("/api/auth/register", {"email": "x" + EMAIL, "password": PW, "handle": HANDLE, "name": "x",
                                       "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"})
    check("E 帳號名重複：409 HANDLE_TAKEN", st == 409 and e["error"]["code"] == "HANDLE_TAKEN")
    st, e = api("/api/auth/login", {"email": EMAIL, "password": PW, "turnstileToken": ""})
    check("E Turnstile 沒通過（無 token）：400 TURNSTILE_FAILED", st == 400 and e["error"]["code"] == "TURNSTILE_FAILED")
    st, e = api("/api/auth/verify-email", {"email": "u" + EMAIL, "code": "000000"})
    check("E 驗證碼錯：400 CODE_INVALID", st == 400 and e["error"]["code"] in ("CODE_INVALID",))

    # 忘記密碼 → 重設 → 舊 session 失效
    st, _ = api("/api/auth/forgot-password", {"email": EMAIL, "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"})
    rc = code_for(EMAIL, "重設密碼的驗證碼是")
    st2, rs = api("/api/auth/reset-password", {"email": EMAIL, "code": rc, "password": PW + "!", "client": "app"})
    st3, _ = api("/api/me/state", headers={"authorization": f"Bearer {tok}"})
    st4, _ = api("/api/auth/login", {"email": EMAIL, "password": PW + "!", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"})
    check("E 忘記密碼：寄重設碼→重設成功→舊 token 失效→新密碼可登入", st == 200 and bool(rc) and st2 == 200 and st3 == 401 and st4 == 200,
          (st, rc, st2, st3, st4))
    PW2 = PW + "!"
    ctx4.close()

    # ---------- F. 受影響頁 1440／390：溢出、console error ----------
    PAGES = [("首頁", "/"), ("單則", "/share/1"), ("藝人", "/artist/mountain-radio"), ("系列", "/artist/mountain-radio/1"),
             ("個人_本人", "/u/" + HANDLE), ("個人_示範", "/u/xiaomeng"), ("喜愛清單", "/me/likes"), ("登入頁", "/login"),
             ("表單_未搬", "/share/new"), ("私訊_未搬", "/messages"), ("後台_未搬", "/admin")]
    for who in ("訪客", "登入"):
        for wdt in (1440, 390):
            c, pg = new_ctx(wdt, 900)
            if who == "登入":
                api_st, lb = 0, None
                pg.goto(B + "/login"); settle(pg)
                pg.locator("#page-email").fill(EMAIL); pg.locator("#page-password").fill(PW2)
                wait_turnstile(pg.locator(".auth-page")); pg.locator(".auth-submit").click()
                pg.wait_for_url(B + "/"); settle(pg)
            for name, url in PAGES:
                if who == "登入" and name == "登入頁":
                    continue
                start = len(errs)
                pg.goto(B + url); settle(pg)
                sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
                pg.screenshot(path=str(IMG / f"{who}_{name}_{wdt}.jpg"), full_page=True, type="jpeg", quality=80)
                own_errs = [e for e in errs[start:] if "challenges.cloudflare.com" not in e[2]]
                R["pages"][f"{who}_{name}_{wdt}"] = {"url": url, "sw": sw, "iw": iw, "errors": own_errs}
            if who == "登入":
                pg.goto(B + "/"); settle(pg)
                pg.locator("summary.ava").click()
                pg.screenshot(path=str(IMG / f"登入_選單_{wdt}.jpg"), type="jpeg", quality=80)
            else:
                pg.goto(B + "/share/1"); settle(pg)
                pg.locator(".detail .like").first.click()
                wait_turnstile(pg.locator("[data-testid=auth-panel]"))
                sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
                pg.screenshot(path=str(IMG / f"訪客_登入面板_{wdt}.jpg"), type="jpeg", quality=80)
                R["pages"][f"訪客_登入面板_{wdt}"] = {"url": "/share/1", "sw": sw, "iw": iw, "errors": []}
            c.close()
    over = [k for k, v in R["pages"].items() if v["sw"] > v["iw"]]
    bad = {k: v["errors"] for k, v in R["pages"].items() if v["errors"]}
    check(f"F {len(R['pages'])} 個畫面無橫向溢出", not over, over)
    check("F console error 0（不含 Turnstile iframe 自己的訊息）", not bad, bad)
    R["turnstile_console"] = sorted({e[1][:160] for e in errs if "challenges.cloudflare.com" in e[2]})
    br.close()

ok = sum(c["ok"] for c in R["checks"])
R["summary"] = f"{ok}/{len(R['checks'])}"
print("通過", R["summary"])
(HERE / "result.json").write_text(json.dumps(R, ensure_ascii=False, indent=2))
