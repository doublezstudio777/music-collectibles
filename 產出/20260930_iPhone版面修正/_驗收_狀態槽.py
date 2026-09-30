import sys
from playwright.sync_api import sync_playwright
from PIL import Image
BASE, OUT = sys.argv[1], sys.argv[2]
# 同一張「開放出價」卡，把槽位換成四種狀態各量一次（CSS 渲染檢查，不動資料）
VARIANTS = {"offer": None,
            "paused": '<span class="slot slot-paused">交易暫停</span>',
            "sold": '<span class="slot slot-sold">已售出</span><span class="slot slot-soldprice">NT$ 550</span>',
            "price": '<span class="slot slot-price">NT$ 550</span>'}
bad = 0
with sync_playwright() as p:
    for eng in ("webkit", "chromium"):
        b = getattr(p, eng).launch()
        for w in (390, 320):
            pg = b.new_page(viewport={"width": w, "height": 844}, device_scale_factor=3 if eng == "webkit" else 2)
            pg.goto(BASE + "/", wait_until="commit", timeout=60000); pg.wait_for_load_state("domcontentloaded")
            pg.wait_for_selector(".slot-offer", timeout=30000); pg.wait_for_timeout(2500)
            pg.evaluate("document.querySelector('.slot-offer').scrollIntoView({block:'center'})"); pg.wait_for_timeout(800)
            for name, html in VARIANTS.items():
                if html: pg.evaluate("h => { const s = document.querySelector('.slot-offer, .slot-paused, .slot-sold, .slot-price-x').closest('.slots'); s.innerHTML = h; s.querySelector('.slot').classList.add('slot-price-x') }", html)
                el = pg.locator(".slots").filter(has=pg.locator(".slot-price-x" if html else ".slot-offer")).first
                bx = el.bounding_box(); ph = pg.evaluate("e => { const r = e.closest('.card-photo, a').getBoundingClientRect(); return {b: r.bottom, l: r.left} }", el.element_handle())
                f = f"{OUT}/slot_{eng}_{w}_{name}.png"
                first = el.locator(".slot").first
                first.screenshot(path=f)
                im = Image.open(f).convert("RGB"); W, H = im.size
                def edge(pts):
                    return sum(1 for (x, y) in pts if max(im.getpixel((x, y))) < 235) / len(pts)
                e = {"top": edge([(x, 0) for x in range(W)]), "bottom": edge([(x, H - 1) for x in range(W)]),
                     "left": edge([(0, y) for y in range(H)]), "right": edge([(W - 1, y) for y in range(H)])}
                sb = first.bounding_box()
                info = f"slot h={sb['height']:.2f} bottom={sb['y']+sb['height']:.2f} photoBottom={ph['b']:.2f} left={sb['x']:.2f} photoLeft={ph['l']:.2f}"
                framed = name in ("offer", "paused")
                ok = (min(e.values()) > .9) if framed else True
                bad += not ok
                print("OK " if ok else "BAD", eng, w, name, {k: round(v, 2) for k, v in e.items()}, info)
            pg.close()
        b.close()
print("BAD", bad)
