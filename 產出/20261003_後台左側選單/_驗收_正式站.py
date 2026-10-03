"""正式站驗收（未登入能驗的部分）：/admin 未登入行為、計數 API 擋人、條款公告關閉（WebKit iPhone 尺寸）。不建任何資料。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "https://lemibox.com"
OUT = Path(__file__).parent
res = []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": d})
    print(("PASS " if ok else "FAIL ") + n + (f"  {d}" if d else ""))


with sync_playwright() as p:
    b = p.webkit.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    for path in ["/admin", "/admin/status", "/admin/feedback"]:
        r = pg.goto(BASE + path)
        pg.wait_for_load_state("load")
        pg.wait_for_timeout(800)
        check(f"未登入 {path}：只有管理員進得去、沒有選單", pg.locator('[data-testid="admin-denied"]').count() == 1 and pg.locator("#admin-side").count() == 0, f"HTTP {r.status}")
    page_errs = list(errs)  # 之後是故意打的 401／400，不算
    for api in ["/api/admin/nav-counts", "/api/admin/usage"]:
        s = pg.evaluate(f"fetch('{api}').then(r => r.status)")
        check(f"未登入 {api} 401", s == 401, str(s))
    s = pg.evaluate("fetch('/api/notice', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({version:'1.1'})}).then(r => r.status)")
    check("/api/notice 舊版本號拒收 400", s == 400, str(s))
    ctx.close()

    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3)
    pg = ctx.new_page()
    def vis(path="/"):
        pg.goto(BASE + path); pg.wait_for_load_state("load"); pg.wait_for_timeout(2500)
        return pg.locator('[data-testid="terms-notice"]').count() > 0
    check("公告：訪客第一次看得到", vis())
    with pg.expect_response("**/api/notice") as rr:
        pg.locator(".terms-notice-x").click()
    sc = rr.value.headers.get("set-cookie", "")
    check("公告：伺服器發 lmb_tn=1.2（一年、Secure）", "lmb_tn=1.2" in sc and "Max-Age=31536000" in sc and "Secure" in sc, sc)
    check("公告：重新整理不出現", not vis())
    check("公告：換頁不出現", not vis("/artists"))
    pg.close(); pg = ctx.new_page()
    check("公告：關分頁重開不出現", not vis())
    pg.evaluate("localStorage.clear()")
    check("公告：清 localStorage 只留 cookie 不出現", not vis())
    ctx.close(); b.close()
    check("console error 0（/admin 未登入頁）", not page_errs, str(page_errs[:3]))
(OUT / "驗收結果_正式站.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"{sum(r['ok'] for r in res)}/{len(res)}")
