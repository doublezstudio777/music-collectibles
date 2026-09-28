#!/usr/bin/env python3
"""部署前後探測首頁 HTML 引用的資產。
用法：probe.py snapshot <out.json>        記下目前首頁的資產清單
      probe.py watch <before.json> <秒數> <out.json>   每 2 秒抓首頁與資產，記狀態
"""
import json, re, sys, time, urllib.request, urllib.error
BASE = "https://yinzang.dblzm.workers.dev"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
def get(path, head=False):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept": "text/html,*/*"}, method="GET")
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read() if not head else b""
            return r.status, dict(r.headers), body, time.time() - t
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b"", time.time() - t
    except Exception as e:
        return -1, {}, str(e).encode(), time.time() - t
def assets(html):
    return sorted(set(re.findall(r'(?:src|href)="(/_next/static/[^"]+)"', html)))
def page(path="/"):
    st, h, b, dt = get(path)
    html = b.decode("utf8", "replace")
    return {"t": time.strftime("%H:%M:%S"), "status": st, "x-yz-cache": h.get("x-yz-cache"), "x-yz-build": h.get("x-yz-build"), "cf-cache-status": h.get("cf-cache-status"), "assets": assets(html)}
if sys.argv[1] == "snapshot":
    p = page(); json.dump(p, open(sys.argv[2], "w"), indent=1); print(p["t"], p["status"], p["x-yz-cache"], len(p["assets"]), "assets")
else:
    before = set(json.load(open(sys.argv[2]))["assets"]); end = time.time() + float(sys.argv[3]); log = []
    while time.time() < end:
        p = page()
        cur = set(p["assets"])
        p["html_is_old"] = bool(cur) and cur <= before and cur == before
        p["asset_status"] = {}
        for a in sorted(cur | before):
            st, h, _, _ = get(a, head=True)
            p["asset_status"][a] = st
        bad_cur = [a for a in cur if p["asset_status"][a] != 200]
        bad_old = [a for a in before - cur if p["asset_status"][a] != 200]
        print(p["t"], "HTML", p["status"], "cache", p["x-yz-cache"], "build", p["x-yz-build"], "old-html" if p["html_is_old"] else "new-html", f"cur-assets-bad {len(bad_cur)}/{len(cur)}", f"old-only-bad {len(bad_old)}/{len(before-cur)}", flush=True)
        p["bad_cur"] = bad_cur; log.append(p); json.dump(log, open(sys.argv[4], "w"), indent=1)
        time.sleep(2)
