# 用法：python3 measure.py <標籤> <login|guest>；每頁整頁開一次，記錄所有打到 Worker 的請求與 cf-ray
import asyncio, json, sys, time
from playwright.async_api import async_playwright
TAG, MODE = sys.argv[1], sys.argv[2]
PAGES = [("首頁","/"),("藝人","/artist/li-ying-hong"),("系列","/artist/li-ying-hong/1"),("收藏頁","/share/9"),
         ("私訊","/messages"),("願望清單","/me/likes"),("設定","/settings"),("我的頁面","/u/lmbcpuprobe1001")]
async def main():
    out=[]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(user_agent=f"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1 cpuprobe-{TAG}", viewport={"width":390,"height":844})
        if MODE=="login":
            await ctx.add_cookies([{"name":"yz_session","value":open("probe_token.txt").read().strip(),"domain":"lemibox.com","path":"/","secure":True,"httpOnly":True}])
        for name,path in PAGES:
            pg = await ctx.new_page()
            reqs=[]
            def on(r, name=name):
                u=r.url
                if "lemibox.com" not in u or "/_next/static" in u or "/cdn-cgi/" in u or "/brand/" in u or u.endswith((".png",".svg",".webp",".css")) and "/img/" not in u: return
                reqs.append({"page":name,"url":u.split("lemibox.com",1)[1],"status":r.status,"ray":(r.headers.get("cf-ray") or "").split("-")[0],"cache":r.headers.get("x-yz-cache","")})
            pg.on("response", on)
            try:
                await pg.goto("https://lemibox.com"+path, wait_until="load", timeout=30000)
            except Exception as e: reqs.append({"page":name,"url":path,"status":"ERR "+str(e)[:60],"ray":"","cache":""})
            await pg.wait_for_timeout(6000)
            await pg.close()
            out+=reqs
        await b.close()
    json.dump(out, open(f"measure_{TAG}.json","w"), ensure_ascii=False, indent=0)
    print(len(out))
asyncio.run(main())
