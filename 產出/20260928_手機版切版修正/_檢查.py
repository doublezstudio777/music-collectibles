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
  // 1. 整頁是否橫向溢出
  const html = document.documentElement;
  const bodyOverflow = html.scrollWidth - window.innerWidth;
  results.push({ type: 'page-overflow', diff: bodyOverflow });

  // 2. 逐一檢查會排卡片/清單的容器：容器本身內容是否溢出容器可視寬度（非刻意的橫向捲動）
  const NO_SCROLL_CONTAINERS = ['.tiles', '.hot-list', '.wall', '.item-index'];
  for (const sel of NO_SCROLL_CONTAINERS) {
    document.querySelectorAll(sel).forEach((el, i) => {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') return; // 這幾個現在都不該是捲動容器
      const diff = el.scrollWidth - el.clientWidth;
      if (diff > 2) results.push({ type: 'container-overflow', sel, index: i, diff });
    });
  }

  // 3. Range rect 檢查文字是否被截斷（比對文字實際渲染寬度 vs 容器可視寬度）
  const TEXT_SELECTORS = ['.tile-title', '.hot-name', '.item-link b', '.card-title', '.compare-ver .ver-name', '.contrib-who span:last-child'];
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
      // line-clamp 元素會刻意省略號截斷，不算 bug（card-title 目前設計如此）
      if (clampLines && clampLines !== 'none') return;
      const overflowAmt = maxRight - box.right;
      if (overflowAmt > 1) results.push({ type: 'text-clipped', sel, index: i, overflowAmt: Math.round(overflowAmt), text: el.textContent.trim().slice(0,30) });
    });
  }
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
                if findings:
                    all_findings.append({"page": pname, "width": w, "findings": findings})
                if console_errors:
                    all_findings.append({"page": pname, "width": w, "console_errors": console_errors})
                page.close()
        browser.close()
    print(json.dumps(all_findings, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    run()
