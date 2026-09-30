"""導覽列 Logo 置中量測（2026-09-30）：量「墨跡」不量元素框。
每種寬度（1440／390／360）× 訪客／登入，對 .logo 截 4 倍解析度圖，插圖與字各自取非白像素的上下緣，算墨跡垂直中心（CSS px）。
另外量頁首每個元素左右緣，確認沒有重疊、沒有超出畫面。
用法：python3 _量測_導覽列置中.py <網址> <輸出前綴>（本機 http://127.0.0.1:8791、正式站 https://lemibox.com）"""
import io, json, sys
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
TAG = sys.argv[2]
IMG = Path(__file__).parent / "img"
IMG.mkdir(exist_ok=True)
import os
DPR = int(os.environ.get("DPR", "4"))
FAKE_ME = {"user": {"id": "u-x", "handle": "demo", "name": "樂迷小王", "avatar": None, "role": "user"}, "state": {"likes": [], "holds": [], "wants": [], "follows": []}, "unread": 0}
out = {}


def ink_rows(img, x0, x1):
    a = np.array(img.convert("RGB")).astype(int)[:, x0:x1]
    ink = (a.min(axis=2) < 200)  # 黑字、黑框、橘色（B 通道 0）都算墨跡；白與反鋸齒淡邊不算
    ys = np.where(ink.any(axis=1))[0]
    return ys[0], ys[-1]


with sync_playwright() as pw:
    br = pw.chromium.launch()
    for w, h, mob in [(1440, 900, False), (390, 844, True), (375, 667, True), (360, 780, True), (320, 640, True)]:
        for login in (False, True):
            c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=DPR, is_mobile=mob, has_touch=mob)
            pg = c.new_page()
            if login:
                pg.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(FAKE_ME)))
            pg.goto(B + "/", wait_until="load")
            pg.evaluate("document.fonts.load('700 20px \"Noto Sans TC\"','樂迷藏')")
            pg.evaluate("document.fonts.ready")
            pg.wait_for_timeout(1500)
            logo = pg.locator("header .logo")
            lb = logo.bounding_box()
            mb = pg.locator("header .logo-mark").bounding_box()
            tb = pg.locator("header .logo-text").bounding_box()
            shot = Image.open(io.BytesIO(logo.screenshot()))
            s = lambda v: int(round(v * DPR))
            m0, m1 = ink_rows(shot, s(mb["x"] - lb["x"]), s(mb["x"] - lb["x"] + mb["width"]))
            t0, t1 = ink_rows(shot, s(tb["x"] - lb["x"]), s(tb["x"] - lb["x"] + tb["width"]))
            mc, tc = (m0 + m1) / 2 / DPR, (t0 + t1) / 2 / DPR
            key = f"{w}_{'登入' if login else '訪客'}"
            # 頁首元素左右緣
            els = pg.evaluate("""() => [...document.querySelectorAll('header .nav-row > *, header .nav-right > *')]
                .filter(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none' && !e.classList.contains('nav-right'))
                .map(e => { const r = e.getBoundingClientRect(); return [e.className || e.tagName, Math.round(r.left * 10) / 10, Math.round(r.right * 10) / 10, Math.round(r.top*10)/10, Math.round(r.bottom*10)/10]; })""")
            xs = sorted(els, key=lambda e: e[1])
            overlap = [(a[0], b[0]) for a, b in zip(xs, xs[1:]) if b[1] < a[2] - 0.5]
            out[key] = {"插圖墨跡上下(px)": [m0 / DPR, m1 / DPR], "字墨跡上下(px)": [t0 / DPR, t1 / DPR], "插圖中心": mc, "字中心": tc, "差(插圖-字)": round(mc - tc, 2),
                        "插圖框": [round(mb["y"] - lb["y"], 2), round(mb["height"], 2)], "字框": [round(tb["y"] - lb["y"], 2), round(tb["height"], 2)],
                        "頁首元素": xs, "重疊": overlap, "超出右緣": max(e[2] for e in xs) > w, "logo寬": round(lb["width"], 1)}
            print(key, "插圖中心", mc, "字中心", tc, "差", round(mc - tc, 2), "重疊", overlap, "logo寬", round(lb["width"], 1), flush=True)
            # 放大圖：logo 區，畫出兩個墨跡中心線（紅＝插圖、藍＝字）
            big = shot.convert("RGB")
            from PIL import ImageDraw
            d = ImageDraw.Draw(big)
            d.line([(0, (m0 + m1) / 2), (big.width, (m0 + m1) / 2)], fill=(220, 0, 0), width=1)
            d.line([(0, (t0 + t1) / 2), (big.width, (t0 + t1) / 2)], fill=(0, 90, 255), width=1)
            big.save(IMG / f"{TAG}_置中量測_{key}.png")
            pg.screenshot(path=str(IMG / f"{TAG}_導覽列_{key}.jpg"), type="jpeg", quality=80, clip={"x": 0, "y": 0, "width": w, "height": 80})
            c.close()
    br.close()
json.dump(out, open(Path(__file__).parent / f"量測_{TAG}.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
