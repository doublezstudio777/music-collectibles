import glob
from PIL import Image
def frac(im, pts): return sum(1 for p in pts if max(im.getpixel(p)) < 235) / len(pts)
bad = 0
for d in ("slots_before", "slots_after"):
    for f in sorted(glob.glob(d + "/slot_*_offer.png") + glob.glob(d + "/slot_*_paused.png")):
        im = Image.open(f).convert("RGB"); W, H = im.size
        # 每一邊取最外 4 條像素線裡最像框線的那條（截圖會多帶 1～3 條頁面背景）
        m = 4
        e = {"top": max(frac(im, [(x, y) for x in range(m, W - m)]) for y in range(m)),
             "bottom": max(frac(im, [(x, y) for x in range(m, W - m)]) for y in range(H - m, H)),
             "left": max(frac(im, [(x, y) for y in range(m, H - m)]) for x in range(m)),
             "right": max(frac(im, [(x, y) for y in range(m, H - m)]) for x in range(W - m, W))}
        ok = min(e.values()) > .95
        if d == "slots_after": bad += not ok
        print("OK " if ok else "BAD", f, {k: round(v, 2) for k, v in e.items()})
print("after BAD", bad)
