# 用 shots/shots.json 的座標，把截圖組成 750 寬的操作示意（框線＋編號，說明只寫動作名稱）
import json
from pathlib import Path
SRC = Path(__file__).parent
meta = json.load(open(SRC / "shots/shots.json"))
fonts = open(SRC / "fonts.inc").read()
SIDE = {"儲存"}
CW = 686  # 750 − 左右各 32
GROUPS = {"操作示意_發布收藏": ["發布_1", "發布_2", "發布_3", "發布_4"],
          "操作示意_編輯藝人頁": ["編輯_1", "編輯_2"],
          "操作示意_回報": ["回報_1", "回報_2"]}
CSS = """
.canvas{width:750px;padding:56px 32px 40px}
.panel{position:relative;margin-top:60px}
.panel:first-child{margin-top:0}
.shot{display:block;width:686px;height:auto;border:1px solid var(--line)}
.box{position:absolute;border:3px solid var(--text)}
.badge{position:absolute;width:40px;height:40px;background:var(--orange);color:var(--on-orange);
  font-family:var(--font-mono);font-size:24px;font-weight:500;line-height:40px;text-align:center}
.cap{display:flex;flex-wrap:wrap;gap:8px 28px;margin-top:16px}
.cap span{font-size:28px;font-weight:700;line-height:40px;display:inline-flex;align-items:center;gap:12px;white-space:nowrap}
.cap b{width:40px;height:40px;background:var(--orange);color:var(--on-orange);font-family:var(--font-mono);font-size:24px;font-weight:500;line-height:40px;text-align:center}
"""
for name, keys in GROUPS.items():
    h = f'<!DOCTYPE html><html lang="zh-Hant-TW"><head><meta charset="UTF-8">{fonts}<style>{CSS}</style></head><body><div class="canvas" id="c">\n'
    for k in keys:
        m = meta[k]; sc = CW / m["w"]
        h += f'<div class="panel" data-shot="{k}"><div style="position:relative"><img class="shot" src="shots/{k}.png" alt="">\n'
        for t in m["targets"]:
            x, y, w, hh = t["x"] * sc - 6 + 1, t["y"] * sc - 6 + 1, t["w"] * sc + 12, t["h"] * sc + 12
            h += f'<div class="box" style="left:{x:.1f}px;top:{y:.1f}px;width:{w:.1f}px;height:{hh:.1f}px"></div>'
            if t["label"] in SIDE:  # 上方有別的元素、右上有「取消」，編號改放框的右下角外側
                bx, by = x + w, y + hh - 40
            else:                    # 預設放框的右上角外側，避開左對齊的欄位標題
                bx, by = x + w - 40, y - 40
            h += f'<div class="badge" style="left:{bx:.1f}px;top:{by:.1f}px">{t["n"]}</div>\n'
        h += '</div><p class="cap">' + "".join(f'<span><b>{t["n"]}</b>{t["label"]}</span>' for t in m["targets"]) + '</p></div>\n'
    open(SRC / f"{name}.html", "w").write(h + "</div></body></html>\n")
    print(name)
