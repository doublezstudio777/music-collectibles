# 站內換頁（RSC 請求）也走快取，而且第二次（命中）換頁內容正確。用法：python3 _驗收_換頁.py <網址>
import sys
from playwright.sync_api import sync_playwright
B = sys.argv[1].rstrip("/"); res = []
def check(n, ok, d=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n, d)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); errs = []; rsc = []
    pg.on("console", lambda x: x.type == "error" and errs.append(x.text))
    pg.on("response", lambda r: "_rsc=" in r.url and rsc.append(r.headers.get("x-yz-cache")))
    for rnd in (1, 2):
        pg.goto(B + "/artists", wait_until="networkidle")
        a = pg.locator('main a[href^="/artist/"]').first; href = a.get_attribute("href")
        a.click(); pg.wait_for_url(B + href); pg.wait_for_load_state("networkidle")
        check(f"第 {rnd} 輪：/artists → {href} 換頁", pg.locator("main h1").count() > 0, pg.locator("main h1").first.inner_text())
        s = pg.locator('main a[href^="' + href + '/"]').first
        if s.count():
            sh = s.get_attribute("href"); s.click(); pg.wait_for_url(B + sh); pg.wait_for_load_state("networkidle")
            check(f"第 {rnd} 輪：→ 系列 {sh}", pg.locator("main h1").count() > 0)
    check("站內換頁的 RSC 請求有命中快取", "HIT" in rsc, str(rsc))
    check("console error 0", not errs, str(errs)); br.close()
print(f"\n換頁驗收 {sum(res)}/{len(res)}")
