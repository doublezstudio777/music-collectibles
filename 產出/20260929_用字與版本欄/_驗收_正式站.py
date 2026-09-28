# 正式站驗證（只讀，不登入、不發文、不建任何資料）
# 用法：python3 _驗收_正式站.py
# 1. 連續瀏覽 100 次（瀏覽器 UA、間隔 0.4 秒、不重試）數 503
# 2. 訪客開 /share/new：落日飛車 → CD → My jinji，版本題直接出現（不點「新增版本」，那一步要登入）
# 3. 卡片等級標籤：390 只留稱號、1440 完整；同列三列對齊 ≤1px；名字與標籤不截斷
# 4. 單則頁（第 4 則，使用者本人的收藏，只看不動）發文者旁有等級，快取 HTML 就帶著
import json, random, re, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

U = "https://yinzang.dblzm.workers.dev"
OUT = Path(__file__).parent
IMG = OUT / "img"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
res = []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:500]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


URLS = ["/", "/artists", "/artist/sunset-rollercoaster", "/artist/sunset-rollercoaster/2", "/artist/gordon", "/artist/gordon/5", "/share/3", "/share/4", "/share/new", "/about", "/tag/簽名", "/artist/mc-hotdog"]
lines, stat = [], {}
for i in range(100):
    p = random.choice(URLS)
    try:
        r = requests.get(U + p, headers={"User-Agent": UA}, timeout=20)
        c, dt, hit = r.status_code, r.elapsed.total_seconds(), r.headers.get("x-yz-cache")
    except Exception as e:  # noqa: BLE001
        c, dt, hit = "ERR", 0, str(e)[:40]
    stat[c] = stat.get(c, 0) + 1
    lines.append(f"{p} {c} {dt:.3f} {hit}")
    time.sleep(0.4)
(OUT / "browse100.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
check("1 正式站連續瀏覽 100 次，503 為 0", stat.get(503, 0) == 0 and stat.get("ERR", 0) == 0, stat)

MEASURE = """() => { const cards = [...document.querySelectorAll('.wall .card')].slice(0, 24);
  const top = (e) => e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null;
  const rows = {};
  cards.forEach(c => { const k = Math.round(c.getBoundingClientRect().top); (rows[k] = rows[k] || []).push({
    t: top(c.querySelector('.card-title')), tags: (() => { const e = c.querySelector('.tags'); return e && getComputedStyle(e).display !== 'none' ? top(e) : null })(),
    foot: top(c.querySelector('.card-foot')), bottom: Math.round(c.getBoundingClientRect().bottom * 10) / 10,
    footBottom: Math.round(c.querySelector('.card-foot').getBoundingClientRect().bottom * 10) / 10 }); });
  return Object.values(rows).filter(r => r.length > 1); }"""
BADGES = """() => [...document.querySelectorAll('.wall .card')].slice(0, 24).map(c => { const t = c.querySelector('[data-testid=lv-tag]'); const nm = c.querySelector('.who-name');
  const rr = (e) => { const r = document.createRange(); r.selectNodeContents(e); return r.getBoundingClientRect(); }; const card = c.getBoundingClientRect();
  return { text: t ? t.innerText.trim() : null, clipped: t ? (t.scrollWidth > t.clientWidth + 0.5 || rr(t).right > card.right + 0.5) : null,
    nameClipped: nm ? (nm.scrollWidth > nm.clientWidth + 0.5 || rr(nm).right > card.right + 0.5) : null }; })"""

with sync_playwright() as pw:
    br = pw.chromium.launch()
    for w, mobile in [(390, True), (1440, False)]:
        c = br.new_context(viewport={"width": w, "height": 900}, is_mobile=mobile, has_touch=mobile, user_agent=UA)
        p = c.new_page()
        cerr = []
        p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
        for path in ["/", "/artist/gordon"]:
            p.goto(U + path)
            p.wait_for_load_state("networkidle")
            p.evaluate("document.fonts.ready")
            time.sleep(0.6)
            rows = p.evaluate(MEASURE)
            bad = []
            for r in rows:
                for k in ["t", "tags", "foot", "bottom"]:
                    vals = [x[k] for x in r if x[k] is not None]
                    if len(vals) > 1 and max(vals) - min(vals) > 1:
                        bad.append((k, vals))
                if max(x["bottom"] - x["footBottom"] for x in r) > 1:
                    bad.append(("foot 沒貼底", [x["bottom"] - x["footBottom"] for x in r]))
            if rows:
                check(f"3 {w} {path} 同列三列差距 ≤1px、發佈人列貼底（{len(rows)} 列）", not bad, bad[:4])
            else:
                print(f"略過 3 {w} {path} 對齊：這頁只有 1 張卡片，沒有同列可比")
            bs = p.evaluate(BADGES)
            texts = [b["text"] for b in bs]
            check(f"3 {w} {path} 每張卡片都有等級", bs and all(texts), sorted(set(t or "" for t in texts)))
            if mobile:
                check(f"3 {w} {path} 窄卡片只留稱號", all("Lv" not in (t or "") for t in texts), sorted(set(t or "" for t in texts)))
            else:
                check(f"3 {w} {path} 寬卡片完整標籤", all(re.fullmatch(r"\S+ Lv\.\d|館長", t or "") for t in texts), sorted(set(t or "" for t in texts)))
            check(f"3 {w} {path} 名字與等級不截斷", all(b["clipped"] is False and b["nameClipped"] is False for b in bs), [b for b in bs if b["clipped"] or b["nameClipped"]][:3])
            if path == "/":
                p.evaluate("window.scrollTo(0, document.querySelector('.wall').getBoundingClientRect().top + scrollY - 80)")
                time.sleep(0.3)
                p.screenshot(path=str(IMG / f"P{w}_正式站_首頁卡片.jpg"), type="jpeg", quality=80)
        p.goto(U + "/share/4")
        p.wait_for_load_state("networkidle")
        time.sleep(0.4)
        check(f"4 {w} 單則頁發文者旁有等級", p.locator(".detail-by [data-testid=lv-tag]").count() == 1, p.inner_text(".detail-by").replace("\n", " "))
        p.screenshot(path=str(IMG / f"P{w}_正式站_單則頁.jpg"), type="jpeg", quality=80)
        # 訪客開表單：選到專輯就出現版本題（不按新增、不發文）
        p.goto(U + "/share/new")
        p.wait_for_load_state("networkidle")
        p.fill("[data-testid=artist-search]", "落日飛車")
        p.wait_for_selector("[data-testid=artist-opt][data-slug=sunset-rollercoaster]", timeout=15000)
        p.click("[data-testid=artist-opt][data-slug=sunset-rollercoaster]")
        p.click("[data-testid=pick-kind] button:text-is('CD')")
        p.click("[data-testid=where-opt][data-key='sunset-rollercoaster/2']")
        time.sleep(0.4)
        vf = p.locator("[data-testid=version-field]")
        check(f"2 {w} 正式站選好 My jinji 版本題直接出現（不確定、新增版本）", vf.is_visible() and p.locator("[data-testid=version-unsure]").is_visible() and p.locator("[data-testid=version-new]").is_visible())
        btn = p.evaluate("() => [...document.querySelectorAll('.sf-change')].map(b => [b.innerText.trim(), Math.round(b.getBoundingClientRect().height)])")
        check(f"2 {w} 正式站修改按鈕寫「修改」且 ≥44px", btn and all(t == "修改" and h >= 44 for t, h in btn), btn)
        vf.scroll_into_view_if_needed()
        p.screenshot(path=str(IMG / f"P{w}_正式站_表單版本題.jpg"), type="jpeg", quality=80)
        check(f"5 {w} console error 0", not cerr, cerr[:3])
        c.close()
    br.close()

r1 = requests.get(U + "/share/4", headers={"User-Agent": UA}, timeout=20)
r2 = requests.get(U + "/share/4", headers={"User-Agent": UA}, timeout=20)
check("4 單則頁快取命中、HTML 就帶等級", r2.headers.get("x-yz-cache") == "HIT" and 'data-testid="lv-tag"' in r2.text, (r1.headers.get("x-yz-cache"), r2.headers.get("x-yz-cache"), r2.headers.get("x-yz-build")))
print(f"\n{sum(r['ok'] for r in res)}/{len(res)}")
(OUT / "驗收紀錄_正式站.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
