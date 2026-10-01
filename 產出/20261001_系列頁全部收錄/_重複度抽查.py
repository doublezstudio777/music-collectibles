#!/usr/bin/env python3
"""系列頁介紹句與 meta description 重複度抽查（2026-10-01）。

用法：python3 _重複度抽查.py [--base http://127.0.0.1:8797] [--n 20] [--seed 20261001] [--all] [--out 檔名.json]
系列清單從 /sitemaps/series-N.xml 拿（只抽會收錄的頁），每頁抓介紹句（data-testid=series-intro）與 meta description。

算三種：
1. 完全相同：兩頁字串一模一樣的比例
2. 句型骨架：把藝人名、專輯名、版本名、唱片公司、地區、數字換成代號後，相同骨架的頁數占比（最大一組）
3. 字元三連組 Jaccard：兩兩比較的平均與最大值（原文、骨架各算一次）
"""
import argparse, html, itertools, json, random, re, statistics, urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8797")
ap.add_argument("--n", type=int, default=20)
ap.add_argument("--seed", type=int, default=20261001)
ap.add_argument("--all", action="store_true")
ap.add_argument("--out", default="")
a = ap.parse_args()
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"


def get(path):
    req = urllib.request.Request(a.base.rstrip("/") + urllib.parse.quote(path, safe="/?=&%:"), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


import urllib.parse

idx = get("/sitemap.xml")
keys = []
for loc in re.findall(r"<loc>([^<]+)</loc>", idx):
    if "/sitemaps/series-" in loc:
        sm = get(urllib.parse.urlparse(loc).path)
        keys += [urllib.parse.unquote(urllib.parse.urlparse(u).path) for u in re.findall(r"<loc>([^<]+)</loc>", sm)]
keys = sorted(set(keys))
sample = keys if a.all else random.Random(a.seed).sample(keys, min(a.n, len(keys)))
txt = lambda x: html.unescape(re.sub(r"<[^>]+>", "", x)).strip()

rows = []
for p in sample:
    s = get(p)
    intro = txt(re.search(r'data-testid="series-intro">(.*?)</p>', s, re.S).group(1))
    desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', s).group(1))
    credits = txt(re.search(r'<p class="credits">(.*?)</p>', s, re.S).group(1))
    title = re.search(r"《([^》]+)》", intro)
    names = [credits] + [c.strip() for c in credits.split("、")] + ([title.group(1)] if title else [])
    table = re.search(r'data-testid="version-table".*?</table>', s, re.S)
    if table:
        for tr in re.findall(r"<tr>(.*?)</tr>", table.group(0), re.S)[1:]:
            cells = [txt(c) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr, re.S)]
            names += [c for c in cells if c and c != "—"]
            names += [re.sub(r"^\d{4}\s*", "", c) for c in cells if c]
    rows.append({"path": p, "intro": intro, "desc": desc, "names": sorted({n for n in names if len(n) > 1}, key=len, reverse=True)})


def skeleton(t, names):
    for n in names:
        t = t.replace(n, "Ｘ")
    t = re.sub(r"《[^》]*》", "《Ｔ》", t)
    t = re.sub(r"\d+", "Ｎ", t)
    t = re.sub(r"(台灣|香港|日本|韓國|中國|美國|馬來西亞|新加坡|全球)", "Ｒ", t)
    t = re.sub(r"[一兩三四五六七八九十]張碟", "Ｎ張碟", t)
    return t


def grams(t):
    return {t[i : i + 3] for i in range(max(1, len(t) - 2))}


def jac(x, y):
    gx, gy = grams(x), grams(y)
    return len(gx & gy) / len(gx | gy) if gx | gy else 0


def stats(field):
    vals = [r[field] for r in rows]
    sk = [skeleton(r[field], r["names"]) for r in rows]
    exact = len(vals) - len(set(vals))
    groups = {}
    for v in sk:
        groups[v] = groups.get(v, 0) + 1
    pairs = list(itertools.combinations(range(len(rows)), 2))
    raw = [jac(vals[i], vals[j]) for i, j in pairs]
    skj = [jac(sk[i], sk[j]) for i, j in pairs]
    return {
        "頁數": len(vals),
        "完全相同的頁（重複出現次數）": exact,
        "完全相同比例": round(exact / len(vals), 3),
        "不同句型骨架數": len(groups),
        "最大骨架群頁數": max(groups.values()),
        "最大骨架群占比": round(max(groups.values()) / len(vals), 3),
        "原文三連組Jaccard平均": round(statistics.mean(raw), 3),
        "原文三連組Jaccard最大": round(max(raw), 3),
        "骨架三連組Jaccard平均": round(statistics.mean(skj), 3),
        "骨架三連組Jaccard最大": round(max(skj), 3),
        "最大骨架群範例": max(groups, key=groups.get),
    }


res = {"base": a.base, "抽樣": "全部" if a.all else f"隨機 {len(rows)} 頁（seed {a.seed}）", "系列頁總數（sitemap）": len(keys), "介紹句": stats("intro"), "description": stats("desc"), "樣本": [{k: r[k] for k in ("path", "intro", "desc")} for r in rows]}
print(json.dumps({k: v for k, v in res.items() if k != "樣本"}, ensure_ascii=False, indent=1))
if a.out:
    json.dump(res, open(a.out, "w"), ensure_ascii=False, indent=1)
