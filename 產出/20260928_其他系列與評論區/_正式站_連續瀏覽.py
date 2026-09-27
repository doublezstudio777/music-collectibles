# 正式站：連續瀏覽 100 次（10 個網址隨機、每次間隔 0.4 秒、不重試），再每頁 8 次帶不同查詢字串繞過快取（沒命中）。
# 間隔從上一輪的 0.3 秒改 0.4 秒：0.3 秒＝10 秒 33 頁，會碰到這批新加的 IP 限流（10 秒 30 頁），那是故意擋的速度。
# 用法：python3 _正式站_連續瀏覽.py <輸出資料夾>；CPU 另外從 wrangler tail 的紀錄算（_正式站_CPU.py）
import random, sys, time, requests
from pathlib import Path
U = "https://yinzang.dblzm.workers.dev"; out = Path(sys.argv[1])
URLS = ["/", "/artists", "/artist/mc-hotdog", "/artist/gordon", "/artist/zhang-zhen-yue", "/artist/wan-zhi-xuan", "/artist/mc-hotdog/1", "/artist/gordon/1", "/share/2", "/login", "/artist/gordon/2", "/artist/mc-hotdog/3"]
lines = []; stat = {}
t0 = time.time()
for i in range(100):
    p = random.choice(URLS)
    try:
        r = requests.get(U + p, timeout=20); c = r.status_code; dt = r.elapsed.total_seconds()
    except Exception as e:
        c, dt = "ERR", 0
    stat[c] = stat.get(c, 0) + 1; lines.append(f"{p} {c} {dt:.6f}"); time.sleep(0.4)
(out / "browse100.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
print("連續瀏覽 100 次", stat, f"{time.time()-t0:.0f} 秒")
time.sleep(12)
miss = []
for p in ["/", "/artists", "/artist/mc-hotdog", "/artist/mc-hotdog/1", "/login"]:
    for k in range(8):
        r = requests.get(f"{U}{p}?m=b{int(time.time()*1000)}", timeout=20); miss.append(f"{p} {r.status_code} {r.headers.get('x-yz-cache')}"); time.sleep(1.2)
(out / "miss40.txt").write_text("\n".join(miss) + "\n", encoding="utf-8")
print("沒命中 40 次", {s: sum(1 for m in miss if f' {s} ' in m) for s in (200, 404, 429, 503)})
