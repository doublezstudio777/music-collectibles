# 從 wrangler tail --format json 的紀錄算 CPU：連續瀏覽（沒帶查詢字串）與沒命中（?m=b…）分開，每個網址 p50／p90。
import json, sys, statistics
from urllib.parse import urlparse
raw = open(sys.argv[1], encoding="utf-8").read(); dec = json.JSONDecoder(); i = 0; ev = []
while i < len(raw):
    while i < len(raw) and raw[i] in " \r\n\t": i += 1
    if i >= len(raw): break
    try: o, i = dec.raw_decode(raw, i); ev.append(o)
    except Exception: i = raw.find("\n{", i) + 1 or len(raw)
def pct(xs, q): xs = sorted(xs); return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))] if xs else None
rows = []
for o in ev:
    req = (o.get("event") or {}).get("request") or {}
    u = urlparse(req.get("url", ""))
    if req.get("method") != "GET" or not u.path or u.path.startswith(("/api", "/img", "/assets")) or "admin" in u.path: continue
    rows.append((u.path, "miss" if "m=b" in u.query else ("browse" if not u.query else "other"), o.get("cpuTime"), o.get("outcome")))
for kind in ("browse", "miss"):
    xs = [r for r in rows if r[1] == kind and r[2] is not None]
    cpu = [r[2] for r in xs]; outc = {}
    for r in xs: outc[r[3]] = outc.get(r[3], 0) + 1
    print(f"[{kind}] n={len(xs)} cpu p50={pct(cpu,.5)} p90={pct(cpu,.9)} max={max(cpu) if cpu else None} >10ms={sum(1 for c in cpu if c > 10)} {outc}")
    for p in sorted({r[0] for r in xs}):
        c = [r[2] for r in xs if r[0] == p]; print(f"   {p:28s} n={len(c):3d} p50={pct(c,.5)} p90={pct(c,.9)} max={max(c)}")
