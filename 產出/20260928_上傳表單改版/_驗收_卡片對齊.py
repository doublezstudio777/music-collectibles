# 收藏卡片固定版型驗收（2026-09-28 追加第 9 項）
# 用法：python3 _驗收_卡片對齊.py <網址> <照片資料夾> [--no-create]
# 本機：先用表單發兩則對照組（自訂標題＝正式站那兩則的長度：一行「My jinji 日版・CD」、兩行「Dr. Paper Vol.3 Sunday Night Slow Jams・2016 CD」），
# 正式站：加 --no-create 只量不建資料
import json, re, sys, time
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
PH = Path(sys.argv[2]) if len(sys.argv) > 2 else None
CREATE = "--no-create" not in sys.argv
OUT = Path(__file__).parent
IMG = OUT / "img"
HOST = B.split("//")[1].split(":")[0]
ST = str(int(time.time()))[-5:]
TAG = f"卡片對照{ST}"
TITLES = ["My jinji 日版・CD", "Dr. Paper Vol.3 Sunday Night Slow Jams・2016 CD"]
res = []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:600]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:300], flush=True)


MEASURE = """() => { const cards = [...document.querySelectorAll('.wall .card')].slice(0, 12);
  const top = (e) => e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null;
  const rows = {};
  cards.forEach(c => { const k = Math.round(c.getBoundingClientRect().top); (rows[k] = rows[k] || []).push({
    title: c.querySelector('.card-title').innerText.trim(), card: top(c), h: Math.round(c.getBoundingClientRect().height*10)/10,
    t: top(c.querySelector('.card-title')), tags: (() => { const e = c.querySelector('.tags'); return e && getComputedStyle(e).display !== 'none' ? top(e) : null })(),
    foot: top(c.querySelector('.card-foot')), bottom: Math.round(c.getBoundingClientRect().bottom*10)/10,
    footBottom: Math.round(c.querySelector('.card-foot').getBoundingClientRect().bottom*10)/10 }); });
  return Object.values(rows).filter(r => r.length > 1); }"""

tok = None
if CREATE:
    tok = requests.post(B + "/api/auth/login", json={"email": "r01@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}, timeout=30).json()["token"]

with sync_playwright() as pw:
    br = pw.chromium.launch()
    if CREATE:
        c = br.new_context(viewport={"width": 1440, "height": 900})
        c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
        p = c.new_page()
        for t in TITLES:
            p.goto(B + "/share/new")
            p.wait_for_load_state("networkidle")
            p.set_input_files("[data-testid=pp-input]", str(PH / "cd.jpg"))
            p.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=40000)
            time.sleep(1)
            p.fill("[data-testid=artist-search]", "國蛋")
            p.click("[data-testid=artist-opt][data-slug=gordon]")
            p.click("[data-testid=pick-kind] button:text-is('CD')")
            p.fill("#share-form-tags", f"{TAG}、國蛋收藏")
            p.click("[data-testid=bar-title-change]")
            p.fill("[data-testid=title-input]", t)
            p.click("[data-testid=share-submit]")
            p.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
        c.close()
        pages = ["/", "/artist/gordon", f"/tag/{TAG}", "/u/r01"]
    else:
        pages = ["/"]
    for w, mobile in [(390, True), (1440, False)]:
        c = br.new_context(viewport={"width": w, "height": 900}, is_mobile=mobile, has_touch=mobile)
        p = c.new_page()
        for path in pages:
            p.goto(B + path)
            p.wait_for_load_state("networkidle")
            p.evaluate("document.fonts.ready")
            time.sleep(0.5)
            rows = p.evaluate(MEASURE)
            pair = next((r for r in rows if {x["title"] for x in r} >= set(TITLES)), None)
            check(f"{w} {path} 對照組兩則在同一列", pair is not None, [[x["title"] for x in r] for r in rows][:3])
            bad = []
            for r in rows:
                for k in ["t", "tags", "foot", "bottom"]:
                    vals = [x[k] for x in r if x[k] is not None]
                    if len(vals) > 1 and max(vals) - min(vals) > 1:
                        bad.append((k, vals))
                fb = [x["bottom"] - x["footBottom"] for x in r]
                if max(fb) > 1:
                    bad.append(("foot 沒貼底", fb))
            check(f"{w} {path} 同列標題／標籤／發佈人列頂部差距 ≤1px、發佈人列貼底", not bad, bad[:4] or [(x["title"][:14], x["t"], x["tags"], x["foot"]) for x in (pair or [])])
            if pair:
                el = p.locator(".wall .card", has_text=TITLES[1]).first
                el.scroll_into_view_if_needed()
                safe = path.strip("/").replace("/", "_") or "home"
                p.screenshot(path=str(IMG / f"G{w}_卡片_{safe[:20]}.jpg"), type="jpeg", quality=80, full_page=False)
        c.close()
    br.close()
print(f"\n{sum(r['ok'] for r in res)}/{len(res)}")
(OUT / ("驗收紀錄_卡片對齊.json" if CREATE else "驗收紀錄_卡片對齊_正式站.json")).write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
