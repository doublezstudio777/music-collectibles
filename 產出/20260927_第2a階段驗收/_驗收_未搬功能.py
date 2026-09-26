# 還沒搬進 D1 的功能（出價、私訊、檢舉示範、清掉追蹤）照舊能動。用示範帳號小孟登入跑
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

B = "http://localhost:5173"
HERE = Path(__file__).parent
res = []


def check(name, ok, detail=""):
    res.append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name, detail)


with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "challenges.cloudflare.com" not in (m.location or {}).get("url", "") else None)
    pg.goto(B + "/login"); pg.wait_for_load_state("load")
    pg.locator("#page-email").fill("aze@demo.yinzang.test"); pg.locator("#page-password").fill("yinzang-demo")
    pg.wait_for_function("() => [...document.querySelectorAll('input[name=cf-turnstile-response]')].some(i => i.value)", timeout=20000)
    pg.locator(".auth-submit").click(); pg.wait_for_url(B + "/"); pg.wait_for_load_state("networkidle")
    check("G 示範帳號（seed）可登入", pg.locator("summary.ava").inner_text() == "阿")
    pg.goto(B + "/?state=selling&sort=new"); pg.wait_for_load_state("networkidle")
    href = pg.locator(".card", has=pg.locator(".slot-offer")).first.locator("a").first.get_attribute("href")
    pg.goto(B + href); pg.wait_for_load_state("networkidle")
    pg.locator(".deal").get_by_role("button", name="出價").click()
    pg.locator("#offer-amount").fill("777"); pg.get_by_role("button", name="送出出價").click()
    pg.wait_for_url("**/messages/**"); pg.wait_for_load_state("networkidle")
    check("G 出價（localStorage）照舊：送出後進私訊、出價訊息在", pg.locator(".msg-offer", has_text="777").count() >= 1, href)
    pg.locator(".composer textarea, .composer input").first.fill("請問還在嗎")
    pg.locator(".composer").get_by_role("button", name="送出").click(); pg.wait_for_timeout(300)
    check("G 私訊打字照舊", pg.locator(".msg", has_text="請問還在嗎").count() == 1)
    pg.goto(B + "/share/11"); pg.wait_for_load_state("networkidle")
    pg.get_by_role("button", name="檢舉這則").click()
    check("G 檢舉示範（小孟已認證）照舊出表單", pg.locator(".report-form").count() == 1)
    pg.goto(B + "/"); pg.wait_for_load_state("networkidle")
    pg.locator("summary.ava").click(); pg.locator(".menu-panel").get_by_role("button", name="清掉追蹤").click()
    pg.wait_for_timeout(600); pg.reload(); pg.wait_for_load_state("networkidle")
    check("G 清掉追蹤改走 API、重新整理後首頁出現熱門藝人", pg.locator(".hot .hot-item").count() >= 3)
    check("G 這段沒有 console error", not errs, errs)
    br.close()

r = json.loads((HERE / "result.json").read_text())
r["regression"] = res
(HERE / "result.json").write_text(json.dumps(r, ensure_ascii=False, indent=2))
