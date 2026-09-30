#!/usr/bin/env python3
"""SEO 基礎建設正式站驗收（2026-10-01，唯讀，不改任何資料）。

用法：SCHEMA_JSONLD=<schemaorg-current-https.jsonld> python3 _驗收_正式站.py
驗：ALLOW_INDEXING 仍是 0（全站 noindex、robots 不附 sitemap）；抽樣頁的 title／description／canonical／og 在 <head>；
結構化資料過 schema.org 詞彙檢查；sitemap 筆數；舊網址 workers.dev 已關閉；www、http 轉址照舊。
輸出 result_正式站.json、抽驗_輸出_正式站.md
"""
import json, os, re, subprocess, sys, urllib.parse, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.argv = [sys.argv[0], "--phase", "on"]  # 借用本機腳本的解析與驗證函式，不跑它的主流程
BASE = "https://lemibox.com"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"

src = open(os.path.join(HERE, "_驗收_本機.py"), encoding="utf-8").read()
lib = src[: src.index("# ======================================================================")]
lib = lib.replace('DB = [x for x in glob.glob(os.path.join(SITE, ".wrangler/state/v3/d1/**/*.sqlite"), recursive=True) if "metadata" not in x][0]\ndb = sqlite3.connect(DB, isolation_level=None)\n', "")
ns = {"__file__": os.path.join(HERE, "_驗收_本機.py")}
exec(compile(lib, "lib", "exec"), ns)
parse, validate_ld, check, results = ns["parse"], ns["validate_ld"], ns["check"], ns["results"]


def get(path, follow=True):
    url = BASE + urllib.parse.quote(path, safe="/?=&%:")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8", "replace")


report = ["# SEO 抽驗輸出（正式站 lemibox.com，部署後）\n", "| 網址 | 狀態 | title | description | canonical | og:image | robots meta | X-Robots-Tag |", "|---|---|---|---|---|---|---|---|"]
PATHS = ["/", "/about", "/guide", "/artist/hyukoh", "/artist/sunset-rollercoaster", "/artist/a-tt4v", "/artist/hyukoh/1", "/artist/a-tt4v/1", "/artist/lu1/1",
         "/share/10", "/share/8", "/share/9"]
ld_all = {}
for p in PATHS:
    st, hd, html = get(p)
    h = parse(html)
    m = h.meta
    report.append(f"| `{p}` | {st} | {m.get('title','')} | {m.get('description','')} | {m.get('canonical','')} | {m.get('og:image','').replace(BASE,'')} | {m.get('robots','')} | {hd.get('x-robots-tag','')} |")
    check(f"prod-meta{p}", f"{p} title／description／canonical／og 在 <head>，canonical＝正式網域",
          st == 200 and all(k in h.head_tags for k in ("title", "description", "canonical", "og:image", "robots")) and m.get("canonical") == BASE + p,
          f"{st} {sorted(h.head_tags)} {m.get('canonical')}")
    check(f"prod-noindex{p}", f"{p} 仍 noindex（meta＋X-Robots-Tag）", m.get("robots") == "noindex" and "noindex" in hd.get("x-robots-tag", ""), f"{m.get('robots')} {hd.get('x-robots-tag')}")
    types, errs = validate_ld(h.ld)
    ld_all[p] = h.ld
    check(f"prod-ld{p}", f"{p} 結構化資料（{', '.join(map(str, types))}）過 schema.org 檢查", h.ld and not errs, errs[:3])
check("prod-fmt-1", "正式站系列頁標題格式", "理想混蛋《關掉／打開》2022 台灣首版 CD｜曲目、版本與收藏｜樂迷藏" in json.dumps(report, ensure_ascii=False))
check("prod-fmt-2", "正式站收藏頁標題格式", "Hyukoh《23》2020 韓國再版 CD｜民生鄰居的收藏｜樂迷藏" in json.dumps(report, ensure_ascii=False))

st, hd, robots = get("/robots.txt")
check("prod-robots", "robots.txt 維持原狀：不附 Sitemap、允許爬取、擋 /admin 與 /api/、AI 爬蟲整站拒絕", st == 200 and "Sitemap:" not in robots and "Disallow: /admin" in robots and "User-agent: GPTBot\nDisallow: /" in robots)
st, hd, idx = get("/sitemap.xml")
files = re.findall(r"<loc>https://lemibox\.com(/sitemaps/[^<]+)</loc>", idx)
counts = {}
for f in files:
    _, _, x = get(f)
    counts[f] = len(re.findall(r"<url>", x))
check("prod-sitemap", "sitemap.xml 索引＋分檔都 200", st == 200 and files and all(v > 0 for v in counts.values()), counts)
report += ["", "## sitemap", "", "| 檔案 | 筆數 |", "|---|---|"] + [f"| `{k}` | {v} |" for k, v in counts.items()] + [f"| 合計 | {sum(counts.values())} |"]
for p in ["/settings", "/u/dz4277", "/search?q=x", "/me"]:
    st, hd, _ = get(p)
    check(f"prod-priv{p}", f"{p} X-Robots-Tag noindex", "noindex" in hd.get("x-robots-tag", ""), hd.get("x-robots-tag"))

# 舊網址、轉址（curl，看原始回應不跟轉址）
def curl(url):
    r = subprocess.run(["curl", "-sS", "-m", "30", "-A", UA, "-D", "-", "-o", "/dev/null", url], capture_output=True, text=True)
    return (r.stdout.splitlines() or [""])[0].strip(), r.stdout, r.stderr.strip()
line, hdrs, err = curl("https://yinzang.dblzm.workers.dev/")
check("prod-old", "舊網址 yinzang.dblzm.workers.dev 已關閉（不是 200、沒有網站的 x-yz-build）", " 200" not in line and "x-yz-build" not in hdrs.lower(), f"{line} {err}")
line2, hdrs2, _ = curl("https://yinzang.dblzm.workers.dev/share/10")
check("prod-old-2", "舊網址內頁也關閉", " 200" not in line2 and "x-yz-build" not in hdrs2.lower(), line2)
old_evidence = {"root": {"status": line, "headers": hdrs, "stderr": err}, "share10": {"status": line2, "headers": hdrs2}}
line, hdrs, _ = curl("https://www.lemibox.com/artists?x=1")
check("prod-www", "www 仍 301 到 apex", "301" in line and "location: https://lemibox.com/artists?x=1" in hdrs.lower(), line)
line, hdrs, _ = curl("http://lemibox.com/artists?x=1")
check("prod-http", "http 仍 301 到 https", "301" in line and "location: https://lemibox.com/artists?x=1" in hdrs.lower(), line)

json.dump({"results": results, "sitemap": counts, "old_url": old_evidence}, open(os.path.join(HERE, "result_正式站.json"), "w"), ensure_ascii=False, indent=2)
json.dump(ld_all, open(os.path.join(HERE, "結構化資料_輸出_正式站.json"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(HERE, "抽驗_輸出_正式站.md"), "w").write("\n".join(report) + "\n")
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} 通過")
sys.exit(0 if all(r["ok"] for r in results) else 1)
