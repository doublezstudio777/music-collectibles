# 把 _src/*.html 轉成 1x／2x 的 PNG 與 WebP，並量文字溢出／截斷
# 用法：python3 render.py [檔名（不含 .html）...]
import json, sys, glob, os
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
SRC = Path(__file__).parent; OUT = SRC.parent
names = sys.argv[1:] or [Path(f).stem for f in sorted(glob.glob(str(SRC / "*.html")))]
CHECK = """() => {
  const c = document.getElementById('c'), cr = c.getBoundingClientRect(), bad = [];
  const fonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family);
  const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
  let n, count = 0;
  while ((n = walker.nextNode())) {
    if (!n.textContent.trim()) continue; count++;
    const r = document.createRange(); r.selectNodeContents(n);
    const el = n.parentElement, er = el.getBoundingClientRect();
    for (const t of r.getClientRects()) {
      if (t.left < cr.left - .5 || t.right > cr.right + .5 || t.top < cr.top - .5 || t.bottom > cr.bottom + .5)
        bad.push(['超出畫布', n.textContent.trim()]);
      // 文字框超出所屬元素（被截或擠出）
      if (t.right > er.right + .5 || t.left < er.left - .5) bad.push(['超出元素', n.textContent.trim()]);
    }
    const cs = getComputedStyle(el);
    if (cs.overflow !== 'visible' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1))
      bad.push(['被截斷', n.textContent.trim()]);
  }
  return {w: cr.width, h: cr.height, texts: count, bad, fonts: [...new Set(fonts)],
          ff: getComputedStyle(c).fontFamily.split(',')[0]};
}"""
ORANGE = """() => {  // 橘色面積（元素背景、邊框）估算
  let a = 0; const c = document.getElementById('c'), cr = c.getBoundingClientRect();
  for (const e of c.querySelectorAll('*')) { const s = getComputedStyle(e), r = e.getBoundingClientRect();
    if (s.backgroundColor === 'rgb(255, 106, 0)') for (const q of e.getClientRects()) a += q.width * q.height; }
  return a / (cr.width * cr.height);
}"""
report = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for nm in names:
        for s in (1, 2):
            pg = b.new_page(viewport={"width": 1400, "height": 900}, device_scale_factor=s)
            pg.goto((SRC / f"{nm}.html").as_uri()); pg.wait_for_load_state("networkidle")
            pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)
            suf = "" if s == 1 else "@2x"
            png = OUT / f"{nm}{suf}.png"
            pg.locator("#c").screenshot(path=str(png))
            Image.open(png).save(OUT / f"{nm}{suf}.webp", "WEBP", quality=90, method=6)
            if s == 1:
                r = pg.evaluate(CHECK); r["orange"] = round(pg.evaluate(ORANGE) * 100, 2)
                report[nm] = r
            pg.close()
    b.close()
old = json.load(open(SRC / "render_report.json")) if (SRC / "render_report.json").exists() else {}
old.update(report); json.dump(old, open(SRC / "render_report.json", "w"), ensure_ascii=False, indent=1)
for k, v in report.items():
    print(k, f"{v['w']:.0f}x{v['h']:.0f}", "文字節點", v["texts"], "問題", v["bad"], "橘%", v["orange"], "字型", v["ff"], v["fonts"])
