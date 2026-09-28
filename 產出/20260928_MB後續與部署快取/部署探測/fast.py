#!/usr/bin/env python3
# fast.py <before.json> <秒數> <out.json>：每 0.4 秒抓首頁 HTML（記 x-yz-build、x-yz-cache、資產集合是舊是新），每 3 秒查 3 個舊版獨有資產的狀態
import json, re, sys, time, threading, urllib.request, urllib.error
BASE="https://yinzang.dblzm.workers.dev"; UA="Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0 Safari/537.36"
def get(p):
    try:
        with urllib.request.urlopen(urllib.request.Request(BASE+p,headers={"User-Agent":UA}),timeout=15) as r: return r.status, dict(r.headers), r.read().decode("utf8","replace")
    except urllib.error.HTTPError as e: return e.code, dict(e.headers), ""
    except Exception as e: return -1, {}, str(e)
before=set(json.load(open(sys.argv[1]))["assets"]); end=time.time()+float(sys.argv[2]); log=[]; olds=[]; news=[]
def assetloop():
    while time.time()<end:
        if olds:
            log.append({"t":time.time(),"kind":"asset","st":{a:get(a)[0] for a in olds[:3]},"new":{a:get(a)[0] for a in news[:3]}})
        time.sleep(1)
threading.Thread(target=assetloop,daemon=True).start()
while time.time()<end:
    st,h,b=get("/"); cur=set(re.findall(r'(?:src|href)="(/_next/static/[^"]+)"',b))
    if cur and not olds and cur!=before: olds[:]=sorted(before-cur); news[:]=sorted(cur-before)
    log.append({"t":time.time(),"kind":"html","st":st,"build":h.get("x-yz-build"),"cache":h.get("x-yz-cache"),"old_html":cur==before})
    time.sleep(0.4)
json.dump(log,open(sys.argv[3],"w"))
# 摘要：新 HTML 第一次出現後，還有幾次舊 HTML；舊資產 404 的時段
h=[x for x in log if x["kind"]=="html"]; first_new=next((x["t"] for x in h if not x["old_html"]),None)
late_old=[x for x in h if first_new and x["t"]>first_new and x["old_html"]]
a=[x for x in log if x["kind"]=="asset"]
print(f"HTML 抓了 {len(h)} 次；新 HTML 第一次出現 {time.strftime('%H:%M:%S',time.localtime(first_new)) if first_new else '無'}；之後又拿到舊 HTML {len(late_old)} 次",
      [(time.strftime('%H:%M:%S',time.localtime(x['t'])),x['build'],x['cache']) for x in late_old][:10])
print("舊／新資產狀態：",[(time.strftime('%H:%M:%S',time.localtime(x['t'])),sorted(set(x['st'].values())),sorted(set(x['new'].values()))) for x in a][:15]); print('有 404 的時點', [(time.strftime('%H:%M:%S',time.localtime(x['t'])),x) for x in a if 404 in list(x['st'].values())+list(x['new'].values())][:10])
