"""連續瀏覽 N 次數 503，並用 Cloudflare GraphQL 查這段時間的 CPU（cpuTime p50／p90、errors）。
用法：python3 _連續瀏覽.py <base> <次數> <path...>
- 每個網址各打 N 次，網址輪流，每次間隔 0.3 秒，不重試；curl 一律 -m 30
- CPU：需要環境變數 CLOUDFLARE_API_TOKEN／CLOUDFLARE_ACCOUNT_ID（正式站才查）
"""
import datetime, json, os, subprocess, sys, time, urllib.request
from collections import Counter

base, n, paths = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
start = datetime.datetime.now(datetime.timezone.utc)
per = {p: Counter() for p in paths}
cache = {p: Counter() for p in paths}
for k in range(n):
    for p in paths:
        out = subprocess.run(["curl", "-s", "-m", "30", "-o", "/dev/null", "-D", "-", "-A", UA, base + p], capture_output=True, text=True).stdout
        code = out.split(" ")[1] if out.startswith("HTTP") else "逾時"
        per[p][code] += 1
        hit = [l.split(":", 1)[1].strip() for l in out.splitlines() if l.lower().startswith("x-yz-cache:")]
        cache[p][hit[0] if hit else "-"] += 1
        time.sleep(0.3)
end = datetime.datetime.now(datetime.timezone.utc)
total = Counter()
for p in paths:
    total.update(per[p])
    print(f"{p}：{dict(per[p])}  快取 {dict(cache[p])}")
print(f"合計 {sum(total.values())} 次：{dict(total)}；503＝{total.get('503', 0)}")
print(f"時間 {start.isoformat()} ～ {end.isoformat()}")

tok, acc = os.environ.get("CLOUDFLARE_API_TOKEN"), os.environ.get("CLOUDFLARE_ACCOUNT_ID")
if tok and acc and "workers.dev" in base:
    time.sleep(90)  # GraphQL 資料有延遲
    q = """query($acc:String!,$from:Time!,$to:Time!){viewer{accounts(filter:{accountTag:$acc}){
      w:workersInvocationsAdaptive(limit:50,filter:{scriptName:"yinzang",datetime_geq:$from,datetime_leq:$to}){sum{requests errors} quantiles{cpuTimeP50 cpuTimeP90 cpuTimeP99} dimensions{status}}}}}"""
    body = json.dumps({"query": q, "variables": {"acc": acc, "from": start.strftime("%Y-%m-%dT%H:%M:%SZ"), "to": (end + datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ")}}).encode()
    req = urllib.request.Request("https://api.cloudflare.com/client/v4/graphql", data=body, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
    d = json.loads(urllib.request.urlopen(req, timeout=60).read())
    if not d.get("data"):
        print("GraphQL 錯誤：", d.get("errors"))
        sys.exit(1)
    for row in d["data"]["viewer"]["accounts"][0]["w"]:
        q_ = row["quantiles"]
        print(f"CPU（{row['dimensions']['status']}）：請求 {row['sum']['requests']}、錯誤 {row['sum']['errors']}、cpuTime p50 {q_['cpuTimeP50']/1000:.1f}ms p90 {q_['cpuTimeP90']/1000:.1f}ms p99 {q_['cpuTimeP99']/1000:.1f}ms")
