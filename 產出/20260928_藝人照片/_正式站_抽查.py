# 正式站抽查：3 位藝人頁的照片與授權標示、og:image、照片網址（2026-09-28）。唯讀，不建任何資料
import json, re, sys, requests
B = "https://yinzang.dblzm.workers.dev"
res = []
for slug in ["mc-hotdog", "e-so", "li-ying-hong"]:
    h = requests.get(f"{B}/artist/{slug}", timeout=30).text
    m = re.search(r'<figure class="artist-photo"[\s\S]*?</figure>', h)
    fig = re.sub(r"<!-- -->", "", m.group(0)) if m else ""
    src = re.search(r'<img src="([^"]+)"', fig)
    cap = re.sub(r"<[^>]+>", "", re.search(r"<figcaption[\s\S]*?</figcaption>", fig).group(0)) if fig else ""
    og = re.search(r'<meta property="og:image" content="([^"]*)"', h)
    img = requests.get(B + src.group(1), timeout=30) if src else None
    links = re.findall(r'href="([^"]+)"', fig)
    r = {"slug": slug, "caption": cap, "img": src.group(1) if src else None, "img_status": img.status_code if img else None,
         "img_type": img.headers.get("content-type") if img else None, "img_bytes": len(img.content) if img else 0,
         "og_image": og.group(1) if og else None, "links": links}
    r["ok"] = bool(fig and "攝影：" in cap and img is not None and img.status_code == 200 and og and og.group(1).endswith(src.group(1))
                   and any("commons.wikimedia.org/wiki/File:" in l for l in links) and any("creativecommons.org" in l or "公有領域" in cap for l in links + [cap]))
    res.append(r)
    print(("PASS " if r["ok"] else "FAIL ") + json.dumps(r, ensure_ascii=False))
json.dump(res, open("正式站_抽查.json", "w"), ensure_ascii=False, indent=1)
print(f"{sum(x['ok'] for x in res)}/{len(res)}")
