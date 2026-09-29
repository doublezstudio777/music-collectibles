import re, time, requests
from playwright.sync_api import sync_playwright
B = "https://yinzang.dblzm.workers.dev"
OUT = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad/wm/prod"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for w, h, name in [(1280, 900, "桌機"), (390, 844, "手機")]:
        c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, is_mobile=w < 500, user_agent=UA)
        p = c.new_page(); errs = []
        p.on("console", lambda m: m.type == "error" and errs.append(m.text))
        p.goto(B + "/share/4", wait_until="networkidle")
        box = p.locator(".gallery-count").bounding_box(); ph = p.locator(".gallery-main").bounding_box()
        print(name, "張數標示在右上", box and ph and box["y"] - ph["y"] < 20, "wm節點", p.locator(".wm,.wm-center").count(), "console error", len(errs))
        p.screenshot(path=f"{OUT}/第4則_{name}_張數右上.jpg", type="jpeg", quality=80)
        c.close()
    br.close()
pages = ["/", "/artists", "/share/3", "/share/4", "/share/5", "/artist/sunset-rollercoaster", "/artist/gordon", "/guide", "/about", "/ranking"]
cnt = {}
for i in range(100):
    r = requests.get(B + pages[i % len(pages)], headers={"User-Agent": UA}, timeout=30)
    cnt[r.status_code] = cnt.get(r.status_code, 0) + 1
print("100 次", cnt, "503×", cnt.get(503, 0))
