# 第 1 階段修正輪驗收：截圖（JPEG 80）、溢出、console error、逐條互動、grep
# 用法：dev server 跑在 5173 時 python3 _驗收.py，結果寫 result.json
import json, subprocess, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

B = "http://localhost:5173"
HERE = Path(__file__).parent
IMG = HERE / "img"
SITE = HERE.parent.parent / "網站"
q = urllib.parse.quote
PAGES = [
    ("首頁", "/"), ("首頁_開放出價篩選", "/?state=offer"),
    ("單則_賣家開放出價", "/share/8"), ("單則_已售出", "/share/7"),
    ("單則_買家開放出價", "/share/3"), ("單則_買家定價", "/share/9"),
    ("私訊清單", "/messages"), ("私訊_賣家", "/messages/8-angie"), ("私訊_買家", "/messages/3-xiaomeng"),
    ("個人_本人", "/u/xiaomeng"), ("個人_他人", "/u/rin"),
]
WIDTHS = [1440, 390]
R = {"pages": {}, "checks": [], "grep": {}}


def settle(pg):
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name, detail)


with sync_playwright() as p:
    br = p.chromium.launch()

    # 1. 截圖＋溢出＋console（受影響頁）
    for w in WIDTHS:
        ctx = br.new_context(viewport={"width": w, "height": 900})
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for name, url in PAGES:
            errs.clear()
            pg.goto(B + url)
            settle(pg)
            sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), full_page=True, type="jpeg", quality=80)
            R["pages"].setdefault(name, {"url": url})[str(w)] = {"sw": sw, "iw": iw, "errors": list(errs)}
        ctx.close()

    # 2. 逐條實點：1 全站統一開放出價
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    pg.goto(B + "/"); settle(pg)
    check("首頁卡片顯示「開放出價」非「可出價」",
          pg.locator(".card .slot-offer", has_text="開放出價").count() > 0
          and pg.locator(".card .slot-offer", has_text="可出價").count() == 0)
    check("首頁篩選列是「開放出價」", pg.locator(".filter", has_text="開放出價").count() == 1)

    # 3. 成交只留單則頁一條路：私訊頂端沒有成交按鈕
    pg.goto(B + "/messages/8-angie"); settle(pg)
    check("私訊頂端沒有「成交給」按鈕", pg.locator(".pin-acts", has_text="成交給").count() == 0)
    check("私訊頂端只有「看這則」", "看這則" in pg.locator(".pin-acts").inner_text())
    # 私訊仍能打字對話
    pg.fill("#convo-text", "驗收：這句是私訊一般訊息")
    pg.get_by_role("button", name="送出").click()
    pg.wait_for_timeout(300)
    check("私訊可以打字送出一般訊息", "驗收：這句是私訊一般訊息" in pg.locator(".msgs").inner_text())
    pg.reload(); settle(pg)
    check("私訊文字重新整理後仍在", "驗收：這句是私訊一般訊息" in pg.locator(".msgs").inner_text())
    # 出價／我要買仍以結構化訊息呈現
    check("私訊裡出價仍是結構化訊息（.msg-offer）", pg.locator(".msg-offer").count() > 0)

    # 單則頁成交流程：接受→成交給這位，仍是唯一路徑
    pg.goto(B + "/share/8"); settle(pg); pg.wait_for_selector("[data-testid=seller-bar]")
    row = pg.locator(".offer-row", has_text="安琪")
    row.get_by_role("button", name="接受").click()
    check("單則頁：接受後出現「成交給這位」", row.get_by_role("button", name="成交給這位").count() == 1)
    row.get_by_role("button", name="成交給這位").click()
    check("單則頁：成交後標已售出", pg.locator(".detail").get_attribute("data-sale") == "sold")

    # 4a. 已售出可以改回出售中
    check("已售出賣家操作列出現「改回出售中」", pg.locator(".seller-bar", has_text="改回出售中").count() == 1)
    pg.get_by_role("button", name="改回出售中").click()
    pg.wait_for_selector("[data-testid=seller-bar]")
    check("改回出售中後恢復可切換三段", pg.locator("[data-testid=seller-bar] .seg").count() == 1)
    check("改回出售中後單則頁不再是已售出", pg.locator(".detail").get_attribute("data-sale") in ("offer", "sale"))
    pg.reload(); settle(pg)
    check("改回出售中重新整理後仍生效", pg.locator(".detail").get_attribute("data-sale") in ("offer", "sale"))

    # 4b. 買家可以撤回自己的出價
    pg.goto(B + "/share/3"); settle(pg); pg.wait_for_selector(".offers")
    pg.get_by_role("button", name="出價", exact=True).click()
    pg.fill("#offer-amount", "720")
    pg.get_by_role("button", name="送出出價").click()
    pg.wait_for_url("**/messages/3-xiaomeng"); settle(pg)
    pg.goto(B + "/share/3"); settle(pg); pg.wait_for_selector(".offers")
    row720 = pg.locator(".offer-row", has_text="NT$ 720")
    check("出價後公開列表出現 NT$ 720", row720.count() == 1)
    row720.get_by_role("button", name="撤回").click()
    check("撤回後標「已撤回」", row720.locator(".offer-status").inner_text() == "已撤回")
    pg.reload(); settle(pg)
    row720 = pg.locator(".offer-row", has_text="NT$ 720")
    check("撤回重新整理後仍標已撤回", row720.locator(".offer-status").inner_text() == "已撤回")

    # 5. 同一買家再出價＝取代舊的，公開列表只留最新一筆
    pg.get_by_role("button", name="出價", exact=True).click()
    pg.fill("#offer-amount", "760")
    pg.get_by_role("button", name="送出出價").click()
    pg.wait_for_url("**/messages/3-xiaomeng"); settle(pg)
    pg.goto(B + "/share/3"); settle(pg); pg.wait_for_selector(".offers")
    rows_xiaomeng = pg.locator(".offer-row", has_text="小孟")
    check("同一買家再出價後公開列表只剩最新一筆", rows_xiaomeng.count() == 1
          and "NT$ 760" in rows_xiaomeng.inner_text())
    pg.goto(B + "/messages/3-xiaomeng"); settle(pg)
    check("私訊對話串仍保留舊的那筆出價（720）", "NT$ 720" in pg.locator(".msgs").inner_text())
    check("私訊對話串也有新的那筆出價（760）", "NT$ 760" in pg.locator(".msgs").inner_text())

    # 3c. 個人頁「出售中」分頁
    pg.goto(B + "/u/xiaomeng"); settle(pg)
    check("個人頁有「出售中」分頁標題", pg.locator(".block-title", has_text="出售中").count() == 1)
    check("出售中排在炫收藏前面",
          pg.locator(".block-title").nth(0).inner_text() == "出售中"
          and "炫收藏" in pg.locator(".block-title").nth(1).inner_text())
    check("互動全程 console error 0", len(errs) == 0, "; ".join(errs[:5]))
    ctx.close()

    # grep：全站不留「可出價」
    ctx = br.new_context(); pg = ctx.new_page()
    hits = []
    for name, url in PAGES:
        pg.goto(B + url); settle(pg)
        if "可出價" in pg.content():
            hits.append(name)
    R["grep"]["rendered_可出價"] = hits
    ctx.close()
    br.close()

src = subprocess.run(["grep", "-rn", "可出價"], cwd=SITE, capture_output=True, text=True).stdout
R["grep"]["source_可出價"] = src.strip().splitlines()
json.dump(R, open(HERE / "result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("checks", sum(c["ok"] for c in R["checks"]), "/", len(R["checks"]))
print("grep", R["grep"])
bad = [(n, w, v) for n, d in R["pages"].items() for w, v in d.items() if w != "url" and (v["sw"] != v["iw"] or v["errors"])]
print("overflow/errors", bad)
