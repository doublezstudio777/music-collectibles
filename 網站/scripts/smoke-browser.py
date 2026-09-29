#!/usr/bin/env python3
"""部署後瀏覽器煙霧測試（上線後第一批，2026-09-28）。

curl 只看得到伺服器回 200，看不到「頁面連結點了沒反應」這種只在瀏覽器端壞的問題（2026-09-27 正式站 Link 全失效就是這樣）。
這支用 Playwright 開真的瀏覽器：
  1. 開首頁，等網路靜止（最多 10 秒，見 settle）
  2. 點第一個看得到的站內連結（不含首頁、登入），確認網址換了、頁面內容跟著換
  3. 點 logo 回首頁，確認網址換回 /
  4. 整段 console error 與未捕捉例外必須是 0
任何一項不過就 exit 1。

失敗時逐筆列出（2026-09-28 部署快取批次）：console error 附來源網址與行號；另外記錄每一個 HTTP 400 以上的回應
（網址、狀態碼、資源類型、x-yz-cache／cf-cache-status 表頭），HTML 回應另記 x-yz-build，用來判斷是不是舊 HTML 指到不存在的檔案。

用法：python3 scripts/smoke-browser.py https://yinzang.dblzm.workers.dev
需要：pip3 install playwright && python3 -m playwright install chromium
"""
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

base = (sys.argv[1] if len(sys.argv) > 1 else "https://yinzang.dblzm.workers.dev").rstrip("/")
fail = []
errors = []


def path(u):
    return urlparse(u).path or "/"


def settle(page):
    """等網路靜止，最多 10 秒。首頁有 Spotify 嵌入播放器（2026-09-29），播放器會一直有連線，永遠等不到 networkidle"""
    try:
        page.wait_for_load_state("networkidle", timeout=10000)
    except Exception:
        pass


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 900})
    bad = []

    def on_console(m):
        if m.type != "error":
            return
        loc = m.location or {}
        where = f"{loc.get('url', '')}:{loc.get('lineNumber', '')}" if loc.get("url") else "（沒有來源網址）"
        errors.append(f"console: {m.text[:300]}  @ {where}")

    def on_response(r):
        if r.status >= 400:
            h = r.headers
            bad.append(f"HTTP {r.status} {r.request.resource_type} {r.url}  x-yz-cache={h.get('x-yz-cache', '-')} cf-cache-status={h.get('cf-cache-status', '-')}")

    def on_failed(rq):
        bad.append(f"請求失敗 {rq.resource_type} {rq.url}：{rq.failure}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {str(e)[:300]}"))
    page.on("response", on_response)
    page.on("requestfailed", on_failed)
    try:
        first = page.goto(base + "/", wait_until="load", timeout=30000)
        settle(page)
        if first is not None:
            fh = first.headers
            print(f"首頁 HTML：x-yz-cache={fh.get('x-yz-cache', '-')} x-yz-build={fh.get('x-yz-build', '-')} cf-cache-status={fh.get('cf-cache-status', '-')}")
        page.evaluate("document.fonts.ready")
        page.wait_for_timeout(800)
        print(f"首頁載入：{page.url}")

        before = page.locator("main").inner_text(timeout=5000)
        # 找第一個看得到、會換到別頁的站內連結（排除首頁本身、錨點、API、登入）
        target = None
        links = page.locator('a[href^="/"]:visible')
        for i in range(links.count()):
            href = links.nth(i).get_attribute("href") or ""
            if path(href) not in ("/", "/login") and not href.startswith("/api") and not href.startswith("/#"):
                target = links.nth(i)
                break
        if target is None:
            fail.append("首頁找不到可以點的站內連結")
        else:
            want = path(target.get_attribute("href"))
            target.click()
            try:
                page.wait_for_url(lambda u: path(u) == want, timeout=10000)
            except Exception:
                fail.append(f"點 {want} 後網址沒換（仍是 {page.url}）")
            settle(page)
            after = page.locator("main").inner_text(timeout=5000)
            if path(page.url) == want:
                print(f"點連結換頁：{page.url}")
                if after == before:
                    fail.append("網址換了但頁面內容沒換")

        page.locator("header a.logo").first.click()
        try:
            page.wait_for_url(lambda u: path(u) == "/", timeout=10000)
            print(f"點 logo 回首頁：{page.url}")
        except Exception:
            fail.append(f"點 logo 後網址沒回首頁（仍是 {page.url}）")
        settle(page)
        page.wait_for_timeout(800)
    except Exception as e:  # 開不起來、找不到元素
        fail.append(f"執行失敗：{e}")
    finally:
        browser.close()

print(f"console error：{len(errors)}")
for e in errors:
    print("  " + e)
print(f"HTTP 錯誤回應／失敗請求：{len(bad)}")
for b in bad:
    print("  " + b)
if errors:
    fail.append(f"console error {len(errors)} 筆")
if fail:
    print("瀏覽器煙霧測試失敗：" + "；".join(fail))
    sys.exit(1)
print("瀏覽器煙霧測試通過")
