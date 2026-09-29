# 圖上的數字逐一對照 文案草稿_v2.md（從渲染後的 DOM 取字，不是從產生器的資料取）
import re, json
from pathlib import Path
from playwright.sync_api import sync_playwright
SRC = Path(__file__).parent
md = (SRC.parent.parent / "文案草稿_v2.md").read_text()
tables, cur = [], None
for line in md.splitlines():
    if line.startswith("|"):
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if set("".join(cells)) <= set("-: "): continue
        if cur is None: cur = []; tables.append(cur)
        cur.append(cells)
    else:
        cur = None
lv, sc = tables[0], tables[1]
copy_lv = {r[0]: r[1:] for r in lv[1:]}
copy_sc = [tuple(r) for r in sc[1:]]
special = dict(re.findall(r"^- (打假先鋒|頭號樂迷)：(.+)$", md, re.M))
guan = re.search(r"站長帳號顯示「館長」", md) is not None
rows, fails = [], 0
with sync_playwright() as p:
    b = p.chromium.launch()
    for f in ("等級階梯_桌機", "等級階梯_手機"):
        pg = b.new_page(); pg.goto((SRC / f"{f}.html").as_uri())
        got = pg.evaluate("""[...document.querySelectorAll('.step')].map(s => [s.querySelector('h3').innerText,
            [...s.querySelectorAll('dd')].map(d => d.innerText)])""")
        got = dict(got)
        for t, vals in copy_lv.items():
            for i, v in enumerate(vals):
                g = got.get(t, [None] * 5)[i]
                ok = g == v; fails += not ok
                rows.append(("等級階梯", f, f"{t} Lv.{i+1}", v, g, ok))
        pg.close()
    for f in ("得分方式_桌機", "得分方式_手機"):
        pg = b.new_page(); pg.goto((SRC / f"{f}.html").as_uri())
        got = pg.evaluate("[...document.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim()))")
        for i, (a, s, lim) in enumerate(copy_sc):
            g = got[i] if i < len(got) else [None] * 3
            for k, (want, have) in enumerate(zip((a, s, lim), g)):
                ok = want == have; fails += not ok
                rows.append(("得分方式", f, f"第{i+1}列 {['項目','分數','每日上限'][k]}", want, have, ok))
        hl = pg.evaluate("document.querySelector('tr.hl td').textContent.trim()")
        ok = hl == "編輯藝人頁、專輯頁"; fails += not ok
        rows.append(("得分方式", f, "醒目列", "編輯藝人頁、專輯頁", hl, ok))
        if len(got) != len(copy_sc): fails += 1; rows.append(("得分方式", f, "列數", str(len(copy_sc)), str(len(got)), False))
        pg.close()
    pg = b.new_page(); pg.goto((SRC / "特別稱號.html").as_uri())
    got = dict(pg.evaluate("[...document.querySelectorAll('.row')].map(r => [r.querySelector('.badge').innerText, r.querySelector('.cond').innerText])"))
    for k, v in special.items():
        ok = got.get(k) == v; fails += not ok
        rows.append(("特別稱號", "特別稱號", k, v, got.get(k), ok))
    ok = guan and got.get("館長") == "站長帳號"; fails += not ok
    rows.append(("特別稱號", "特別稱號", "館長", "站長帳號顯示「館長」", got.get("館長"), ok))
    b.close()
json.dump([list(r) for r in rows], open(SRC / "verify_result.json", "w"), ensure_ascii=False, indent=0)
print("比對", len(rows), "項，不符", fails)
print("門檻", len(copy_lv) * 5, "個；得分項", len(copy_sc), "列")
