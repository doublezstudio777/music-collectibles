import json, sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8791"
WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1440]
PAGES = {
    "artist": "/artist/mountain-radio",
    "series": "/artist/mountain-radio/1",
    "home": "/",
    "share": "/share/1",
}
OUT = "/home/dz/AboutAI/專案/music-collectibles/產出/20260928_手機版切版修正/img"

JS_CHECK = """
() => {
  const results = [];
  const html = document.documentElement;
  results.push({ type: 'page-overflow', diff: html.scrollWidth - window.innerWidth });

  // 不該是捲動容器的：容器本身內容不能溢出可視寬度
  const NO_SCROLL_CONTAINERS = ['.hot-list', '.wall', '.item-index'];
  for (const sel of NO_SCROLL_CONTAINERS) {
    document.querySelectorAll(sel).forEach((el, i) => {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return;
      const diff = el.scrollWidth - el.clientWidth;
      if (diff > 2) results.push({ type: 'container-overflow', sel, index: i, diff });
    });
  }

  // .tiles：刻意的橫向捲動（系列、其他系列），左緣要對齊正文左緣，右側出血到螢幕邊緣
  const page = document.querySelector('main.page');
  document.querySelectorAll('.tiles').forEach((el, i) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const pageBox = page ? page.getBoundingClientRect() : null;
    const w = window.innerWidth;
    if (cs.display === 'flex' && (cs.overflowX === 'auto' || cs.overflowX === 'scroll')) {
      // 行動版捲動模式：左緣對正文左緣（<=2px）、右緣貼視窗邊緣（出血，容許 <=2px）
      const leftGap = pageBox ? Math.abs(box.left - (pageBox.left + 18)) : 0;
      if (leftGap > 2) results.push({ type: 'tiles-left-misaligned', index: i, leftGap: Math.round(leftGap) });
      const rightGap = w - box.right;
      if (Math.abs(rightGap) > 2) results.push({ type: 'tiles-not-bled-to-edge', index: i, rightGap: Math.round(rightGap) });
    } else {
      // 桌機格狀模式：不應該有橫向溢出
      const diff = el.scrollWidth - el.clientWidth;
      if (diff > 2) results.push({ type: 'tiles-grid-overflow', index: i, diff });
    }
  });

  // Range rect 檢查文字是否被截斷
  const TEXT_SELECTORS = ['.tile-title', '.hot-name', '.item-link b', '.card-title', '.compare-ver .ver-name', '.contrib-who span:last-child', '.prose p'];
  for (const sel of TEXT_SELECTORS) {
    document.querySelectorAll(sel).forEach((el, i) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node; let maxRight = 0;
      while ((node = walker.nextNode())) {
        const r = document.createRange();
        r.selectNodeContents(node);
        const rects = r.getClientRects();
        for (const rect of rects) maxRight = Math.max(maxRight, rect.right);
      }
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const clampLines = cs.webkitLineClamp;
      if (clampLines && clampLines !== 'none') return;
      // .tile 在捲動模式下容器右緣可能在視窗外（出血），改比對「元素自己的內距框」是否溢出自己
      const overflowAmt = maxRight - box.right;
      if (overflowAmt > 1) results.push({ type: 'text-clipped', sel, index: i, overflowAmt: Math.round(overflowAmt), text: el.textContent.trim().slice(0,30) });
    });
  }

  // 正文區塊（.prose）左右邊距要對稱、跟同一欄其他區塊左緣一致
  document.querySelectorAll('.prose').forEach((el, i) => {
    const box = el.getBoundingClientRect();
    const pageBox = page ? page.getBoundingClientRect() : null;
    if (!pageBox) return;
    const leftGap = Math.abs(box.left - (pageBox.left + parseFloat(getComputedStyle(page).paddingLeft)));
    if (leftGap > 2) results.push({ type: 'prose-left-misaligned', index: i, leftGap: Math.round(leftGap) });
  });

  return results;
}
"""

def run():
    all_findings = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for pname, path in PAGES.items():
            for w in WIDTHS:
                page = browser.new_page(viewport={"width": w, "height": 900})
                console_errors = []
                page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
                page.on("pageerror", lambda exc: console_errors.append(str(exc)))
                page.goto(BASE + path, wait_until="networkidle")
                page.wait_for_timeout(400)
                findings = page.evaluate(JS_CHECK)
                shot = f"{OUT}/{pname}_{w}.jpg"
                page.screenshot(path=shot, full_page=True, type="jpeg", quality=80)
                real_findings = [f for f in findings if f["type"] != "page-overflow"]
                if real_findings:
                    all_findings.append({"page": pname, "width": w, "findings": real_findings})
                if console_errors:
                    all_findings.append({"page": pname, "width": w, "console_errors": console_errors})
                page.close()
        browser.close()
    print(json.dumps(all_findings, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    run()
