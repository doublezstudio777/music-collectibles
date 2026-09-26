# Turnstile 真的失敗（siteverify 回 false）：dev server 要用失敗密鑰冷啟動
#   TURNSTILE_SECRET=2x0000000000000000000000000000000AA npm run dev
# 然後 python3 _驗收_turnstile失敗.py，結果併進 result.json 的 turnstile_fail
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 900})
    pg.goto("http://localhost:5173/login"); pg.wait_for_load_state("load")
    pg.locator("#page-email").fill("xiaomeng@demo.yinzang.test"); pg.locator("#page-password").fill("yinzang-demo")
    pg.wait_for_function("() => [...document.querySelectorAll('input[name=cf-turnstile-response]')].some(i => i.value)", timeout=20000)
    pg.locator(".auth-submit").click(); pg.locator(".field-error").wait_for()
    msg = pg.locator(".field-error").inner_text()
    pg.screenshot(path=str(HERE / "img" / "登入頁_Turnstile失敗_1440.jpg"), type="jpeg", quality=80)
    still_anon = pg.locator(".nav-login").count() == 1
    br.close()
ok = msg == "機器人驗證沒過，重新整理再試一次" and still_anon
print(("PASS" if ok else "FAIL"), "E Turnstile 失敗（siteverify 回 false）：畫面顯示錯誤、沒登入", msg)
r = json.loads((HERE / "result.json").read_text())
r["turnstile_fail"] = {"ok": ok, "message": msg}
(HERE / "result.json").write_text(json.dumps(r, ensure_ascii=False, indent=2))
