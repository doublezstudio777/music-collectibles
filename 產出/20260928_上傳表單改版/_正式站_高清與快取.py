# 正式站：訪客 HTML 只有縮圖、首頁與單則頁整頁快取命中、登入者（攔 /api/me 模擬登入，不動真帳號）會去要大圖，
# 大圖要真登入所以 401，要退回縮圖不能破圖。不建任何資料。用法：python3 _正式站_高清與快取.py
import json, re, requests
from playwright.sync_api import sync_playwright
U = "https://yinzang.dblzm.workers.dev"; UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36"}
res = []
def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:300]}); print(("PASS " if ok else "FAIL ") + n, str(d)[:200])
for path in ["/", "/share/3", "/share/4"]:
    hs = [requests.get(U + path, headers=UA, timeout=30).headers.get("x-yz-cache") for _ in range(3)]
    check(f"整頁快取命中 {path}", hs[-1] == "HIT", hs)
html = requests.get(U + "/share/3", headers=UA, timeout=30).text
srcs = re.findall(r'<img[^>]+src="([^"]+)"', html)
check("訪客 HTML 的 <img> 只有縮圖（檔名 _t）", srcs and all(s.split("?")[0].endswith("_t.jpg") or s.split("?")[0].endswith("_t.webp") for s in srcs if "/img/p/" in s), srcs[:4])
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for who in ["訪客", "模擬登入"]:
        c = br.new_context(viewport={"width": 1440, "height": 900}, user_agent=UA["User-Agent"])
        if who == "模擬登入":
            me = {"user": {"id": "x", "handle": "zz-probe", "name": "探針", "admin": False, "emailVerified": True}, "state": {"liked": [], "owned": [], "wanted": [], "follows": [], "reported": [], "appeals": [], "unread": 0, "dismissed": []}, "geo": {"country": "TW", "canTrade": True}}
            c.route("**/api/me", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(me)))
        p = c.new_page(); got = []; errs = []
        p.on("response", lambda r: "/img/" in r.url and got.append((r.url.split("/img/")[1], r.status)))
        p.goto(U + "/share/3"); p.wait_for_load_state("networkidle"); p.wait_for_timeout(1500)
        imgs = p.evaluate("() => [...document.querySelectorAll('.detail-photo img')].map(i => ({src: i.getAttribute('src'), hires: i.dataset.hires || '', ok: i.complete && i.naturalWidth > 0}))")
        res.append({"name": f"{who} 單則頁圖", "ok": True, "detail": json.dumps({"imgs": imgs, "got": got}, ensure_ascii=False)[:600]})
        print(who, imgs, got)
        if who == "訪客":
            check("訪客單則頁沒有要大圖", not any(i["hires"] for i in imgs))
        else:
            check("模擬登入會去要大圖（真登入才給，這裡 401）", any(s == 401 for _, s in got), got)
            check("大圖 401 後退回縮圖、畫面沒有破圖", imgs and all(i["ok"] for i in imgs) and not any(i["hires"] for i in imgs), imgs)
        p.screenshot(path=f"img/H_正式站_{who}_單則頁.jpg", type="jpeg", quality=70); c.close()
    br.close()
print(f"{sum(r['ok'] for r in res)}/{len(res)}")
open("驗收紀錄_正式站.json", "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, indent=1))
