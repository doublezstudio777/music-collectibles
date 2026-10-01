#!/usr/bin/env python3
"""系列頁全部收錄驗收（2026-10-01）：10 種情況 × WebKit 390／320（3x）＋1440，截圖＋版面量測。

用法：python3 _驗收.py [--base http://127.0.0.1:8797] [--tag 本機] [--indexing 1|0]
  --indexing 1：本機 ALLOW_INDEXING=1 建置，系列頁要沒有 noindex（空殼、待確認除外）
  --indexing 0：正式站（ALLOW_INDEXING=0），每頁都要 noindex
輸出：img/{tag}_{情況}_{寬}.jpg、result_{tag}.json
唯讀，不改資料。
"""
import argparse, html, json, os, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8797")
ap.add_argument("--tag", default="本機")
ap.add_argument("--indexing", default="1")
ap.add_argument("--only", default="")
ap.add_argument("--prod", action="store_true", help="正式站：本機另外建的測試資料（lu1/1 的我有想要、sunset-rollercoaster/2 的成交）不存在，改驗沒有")
a = ap.parse_args()
BASE = a.base.rstrip("/")
UA_PC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

# 情況 → 頁面、預期（market：有沒有站上行情；table：版本比較表列數下限）
CASES = [
    ("多版本", "/artist/sandy-lam/5", {"market": False, "rows_min": 2}),
    ("單版本", "/artist/chen-qi-zhen/13", {"market": False, "rows": 1}),
    ("有行情_開價", "/artist/hyukoh/1", {"market": True, "rows_min": 2}),
    ("有行情_成交", "/artist/sunset-rollercoaster/2", {"market": True}),
    ("沒行情", "/artist/wei-ru-xuan/5", {"market": False}),
    ("單曲", "/artist/sandy-lam/35", {"market": False, "kind": "單曲"}),
    ("EP", "/artist/gordon/4", {"market": False, "kind": "EP"}),
    ("沒發行日", "/artist/amei/34", {"market": False, "noyear": True}),
    ("有收藏", "/artist/lu1/1", {"market": True, "people": True}),
    ("沒收藏", "/artist/chen-shan-ni/3", {"market": False, "people": False}),
    ("只有曲目", "/artist/zhang-zhen-yue/2", {"market": False, "people": False}),
]
if a.prod:
    CASES = [(n, p, {**e, **({"market": False} if n == "有行情_成交" else {}), **({"people": False} if n == "有收藏" else {})}) for n, p, e in CASES]
if a.only:
    CASES = [c for c in CASES if c[0] in a.only.split(",")]
VIEWS = [("390", 390, 844, 3, True), ("320", 320, 640, 3, True), ("1440", 1440, 900, 1, False)]

results = []


def check(cid, name, ok, detail=""):
    results.append({"id": cid, "name": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), cid, name, "" if ok else detail, flush=True)


def raw(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA_PC})
    with urllib.request.urlopen(req, timeout=60) as r:
        return {k.lower(): v for k, v in r.headers.items()}, r.read().decode()


MEASURE = r"""() => {
  const out = {};
  const t = document.querySelector('.ver-table');
  if (t) {
    const rows = [...t.querySelectorAll('tbody tr')];
    out.rowHeights = [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height * 100) / 100))];
    out.headH = Math.round(t.querySelector('thead tr').getBoundingClientRect().height * 100) / 100;
    out.colWidths = [...t.querySelectorAll('thead th')].map(th => Math.round(th.getBoundingClientRect().width * 10) / 10);
    out.layout = getComputedStyle(t).tableLayout;
    // 截斷：每格文字真實寬度（Range）不能超過格子內容寬
    const cut = [];
    t.querySelectorAll('th, td').forEach(c => {
      const cs = getComputedStyle(c);
      const r = document.createRange(); r.selectNodeContents(c);
      const w = r.getBoundingClientRect().width;
      const avail = c.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const lines = r.getClientRects().length;
      if (w > avail + 0.5) cut.push(c.textContent.trim().slice(0, 30) + ' 需 ' + w.toFixed(1) + ' 只有 ' + avail.toFixed(1));
    });
    out.cut = cut;
    const sc = t.closest('.ver-table-scroll');
    out.scroll = { client: sc.clientWidth, scroll: sc.scrollWidth };
  }
  out.pageOverflow = document.documentElement.scrollWidth - window.innerWidth;
  // 這次新加的三區（介紹句、版本比較、站上行情）有沒有東西超出畫面；版本比較表在自己的捲動框裡，量捲動框本身
  const els = [document.querySelector('.ver-table-scroll'), document.querySelector('.market'), ...document.querySelectorAll('.market *')].filter(Boolean);
  let right = Math.max(0, ...els.map(e => e.getBoundingClientRect().right));
  const lead = document.querySelector('[data-testid=series-intro]');
  if (lead) { const r = document.createRange(); r.selectNodeContents(lead); right = Math.max(right, ...[...r.getClientRects()].map(x => x.right)); }
  out.newOverflow = Math.round((right - window.innerWidth) * 10) / 10;
  // 整頁溢出的來源（只列沒有自己捲動框的元素）
  out.overflowFrom = [...document.querySelectorAll('main *')].filter(e => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && !e.children.length).slice(0, 3).map(e => e.parentElement.className + ' > ' + e.tagName + ' ' + e.textContent.trim().slice(0, 20));
  // 介紹句逐行右緣：非末行右側空白（量 text-wrap 改 wrap 後的效果）
  const p = document.querySelector('[data-testid=series-intro]');
  if (p) {
    const r = document.createRange(); r.selectNodeContents(p);
    const rects = [...r.getClientRects()];
    const box = p.getBoundingClientRect();
    const lines = {};
    rects.forEach(x => { const k = Math.round(x.top); lines[k] = Math.max(lines[k] || 0, x.right); });
    const keys = Object.keys(lines).map(Number).sort((a, b) => a - b);
    out.introLines = keys.length;
    out.introGaps = keys.slice(0, -1).map(k => Math.round((box.right - lines[k]) * 10) / 10);
    out.introWrap = getComputedStyle(p).textWrap || getComputedStyle(p).textWrapMode || '';
  }
  return out;
}"""

with sync_playwright() as pw:
    browser = pw.webkit.launch()
    for name, path, exp in CASES:
        hdr, s = raw(path)
        intro = html.unescape(re.sub(r"<[^>]+>", "", re.search(r'data-testid="series-intro">(.*?)</p>', s, re.S).group(1)))
        desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', s).group(1))
        ld = " ".join(re.findall(r'<script type="application/ld\+json">(.*?)</script>', s, re.S))
        head = s.split("</head>")[0]
        robots = re.findall(r'<meta name="robots" content="([^"]*)"', head)
        body_only = re.sub(r"《[^》]*》", "", intro)
        check(f"{name}-intro", "介紹句存在、沒有破折號（專輯名本身除外）", intro and "—" not in body_only and "──" not in body_only, intro)
        check(f"{name}-desc", "description 跟介紹句同源、不含價格、在 head", desc and "NT$" not in desc and not re.search(r"\d+\s*元", desc) and 'name="description"' in head, desc)
        check(f"{name}-ld", "結構化資料沒有 Product／Offer／價格", not re.search(r'"@type":"(Product|Offer|AggregateOffer)"|"price"', ld), "")
        if a.indexing == "1":
            check(f"{name}-robots", "ALLOW_INDEXING=1：這頁可收錄（沒有 noindex）", not robots, str(robots))
        else:
            check(f"{name}-robots", "ALLOW_INDEXING=0：仍是 noindex（meta＋表頭）", robots == ["noindex"] and "noindex" in hdr.get("x-robots-tag", ""), f"{robots} {hdr.get('x-robots-tag')}")
        has_market = 'data-testid="series-market"' in s
        check(f"{name}-market", f"站上行情{'有' if exp['market'] else '沒有'}顯示", has_market == exp["market"], "")
        if has_market:
            check(f"{name}-nosnippet", "站上行情帶 data-nosnippet", re.search(r'data-testid="series-market"[^>]*data-nosnippet', s) is not None, "")
        if "kind" in exp:
            check(f"{name}-kind", f"介紹句寫出{exp['kind']}", exp["kind"] in intro, intro)
        if exp.get("noyear"):
            check(f"{name}-noyear", "沒有發行日的寫法", "發行年份" in intro and not re.search(r"\d{4}年", intro), intro)
        if "people" in exp:
            ok = ("登記擁有" in intro or "想要" in intro) if exp["people"] else ("登記擁有" not in intro and "想要" not in intro)
            check(f"{name}-people", f"收藏與想要人數{'有' if exp['people'] else '沒有'}寫進介紹句", ok, intro)
        rows = len(re.findall(r"<tr>", (re.search(r'data-testid="version-table".*?</table>', s, re.S) or [""])[0])) - 1 if 'data-testid="version-table"' in s else 0
        if "rows" in exp:
            check(f"{name}-rows", f"版本比較表 {exp['rows']} 列", rows == exp["rows"], str(rows))
        if "rows_min" in exp:
            check(f"{name}-rows", f"版本比較表至少 {exp['rows_min']} 列", rows >= exp["rows_min"], str(rows))
        check(f"{name}-noid", "版本比較表沒有目錄號、條碼", not re.search(r"目錄號|條碼", (re.search(r'data-testid="version-table".*?</table>', s, re.S) or [""])[0]), "")

        for vw, w, h, dpr, mobile in VIEWS:
            ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=dpr, is_mobile=False, has_touch=mobile, user_agent=UA_PC)
            page = ctx.new_page()
            errs = []
            page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errs.append(str(e)))
            page.goto(BASE + path, wait_until="load", timeout=90000)
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(1500)
            m = page.evaluate(MEASURE)
            cid = f"{name}-{vw}"
            check(cid + "-overflow", "新加的三區沒有超出畫面", m["newOverflow"] <= 0, str(m["newOverflow"]))
            if m["pageOverflow"] > 0:
                # 整頁溢出另外記，來源若不在這次改動範圍（例如品項的單一版本規格清單），列進 README 的「發現但沒動」
                results.append({"id": cid + "-page-overflow", "name": "整頁橫向溢出（記錄）", "ok": True, "detail": f"{m['pageOverflow']}px，來源 {m['overflowFrom']}"})
            if "rowHeights" in m:
                check(cid + "-rowh", "版本比較表列高一致", len(m["rowHeights"]) == 1, str(m["rowHeights"]))
                check(cid + "-cut", "版本比較表沒有截斷", not m["cut"], "; ".join(m["cut"]))
                check(cid + "-fixed", "table-layout: fixed", m["layout"] == "fixed", m["layout"])
            check(cid + "-console", "console error 0", not errs, " | ".join(errs)[:300])
            # 截圖：頁首到曲目區上緣（版本比較、站上行情都在裡面）
            end = page.evaluate("""() => { const el = document.querySelector('#tracks') || document.querySelector('.item-block'); return el ? el.getBoundingClientRect().top + window.scrollY + 40 : document.body.scrollHeight; }""")
            out = os.path.join(HERE, "img", f"{a.tag}_{name}_{vw}.jpg")
            page.screenshot(path=out, type="jpeg", quality=80, full_page=True, clip={"x": 0, "y": 0, "width": w, "height": min(end, 6000)})
            results[-1].setdefault("measure", m)
            results.append({"id": cid + "-measure", "name": "量測", "ok": True, "detail": json.dumps(m, ensure_ascii=False)})
            ctx.close()
    browser.close()

fails = [r for r in results if not r["ok"]]
json.dump({"base": BASE, "at": time.strftime("%Y-%m-%d %H:%M"), "pass": len([r for r in results if r["ok"] and r["name"] != "量測"]), "fail": len(fails), "results": results}, open(os.path.join(HERE, f"result_{a.tag}.json"), "w"), ensure_ascii=False, indent=1)
print(f"\n{a.tag}: PASS {len([r for r in results if r['ok'] and r['name'] != '量測'])} / FAIL {len(fails)}")
sys.exit(1 if fails else 0)
