# 後台「待確認的新增」看得到版本（本機，管理員）；按鈕用字「儲存」「修改名稱」
import sys, time, requests
from pathlib import Path
from playwright.sync_api import sync_playwright
B = sys.argv[1].rstrip("/"); OUT = Path(__file__).parent; HOST = B.split("//")[1].split(":")[0]
tok = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}, timeout=30).json()["token"]
ok = []
with sync_playwright() as pw:
    br = pw.chromium.launch(); c = br.new_context(viewport={"width": 1440, "height": 900})
    c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
    p = c.new_page(); p.goto(B + "/admin/additions"); p.wait_for_selector("[data-testid=add-item][data-type=version]", timeout=20000)
    row = p.locator("[data-testid=add-item][data-type=version]").first
    t = row.inner_text(); print(t.replace("\n", " | "))
    ok.append(("版本列出現、標「版本」、有系列與品項", "版本" in t and "My jinji・CD" in t))
    row.locator("[data-testid=add-rename]").click()
    ok.append(("按鈕寫「修改名稱」「儲存」", row.locator("[data-testid=add-rename-save]").inner_text().strip() == "儲存"))
    row.scroll_into_view_if_needed(); time.sleep(0.3)
    p.screenshot(path=str(OUT / "img" / "A1440_13_後台_待確認的新增_版本.jpg"), type="jpeg", quality=80)
    br.close()
for n, v in ok: print(("PASS " if v else "FAIL ") + n)
