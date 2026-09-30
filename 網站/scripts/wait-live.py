#!/usr/bin/env python3
"""部署後等新版本真的生效再做瀏覽器煙霧測試（2026-09-28 部署快取批次）。

wrangler deploy 回來時，新版本還在傳到各機器：這段時間同一個網址可能一下由舊版本回、一下由新版本回，
而靜態資產（JS／CSS）也是逐台切換，會出現「HTML 指到的檔這台還沒有／已經沒有」的 404。
這支每秒抓一次首頁（帶瀏覽器 UA），直到：
  1. 回應表頭 x-yz-build 等於這次的版本號前 8 碼（worker.ts 加的），連續 3 次
  2. 首頁 HTML 引用的每個 /_next/static/ 檔都回 200
過程中看到的每一筆 404、舊版本回應都逐筆印出（時間、網址、狀態），不是只給數量。
90 秒內沒達成就 exit 1。

用法：python3 scripts/wait-live.py https://lemibox.com <版本號>（舊網址一樣可以）
"""
import re, sys, time, urllib.error, urllib.request

base, vid = sys.argv[1].rstrip("/"), sys.argv[2][:8]
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def get(path):
    req = urllib.request.Request(base + path, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.headers, r.read().decode("utf8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers, ""
    except Exception as e:  # 連線錯誤
        return -1, {}, str(e)


start = time.time()
streak = 0
seen = []
while time.time() - start < 90:
    t = time.strftime("%H:%M:%S")
    st, h, body = get("/")
    build = h.get("x-yz-build") if h else None
    if st != 200 or build != vid:
        seen.append(f"{t} 首頁 {st} 版本 {build or '（沒有表頭＝舊版本）'}")
        streak = 0
    else:
        assets = sorted(set(re.findall(r'(?:src|href)="(/_next/static/[^"]+)"', body)))
        bad = [(a, get(a)[0]) for a in assets]
        bad = [(a, s) for a, s in bad if s != 200]
        for a, s in bad:
            seen.append(f"{t} 資產 {s} {a}")
        streak = streak + 1 if not bad and assets else 0
        if streak >= 3:
            print(f"新版本 {vid} 已生效：{round(time.time() - start)} 秒，首頁引用 {len(assets)} 個資產全部 200")
            break
    time.sleep(1)
else:
    print(f"90 秒內新版本 {vid} 沒有穩定生效")
for s in seen:
    print("  過渡期：" + s)
if streak < 3:
    sys.exit(1)
