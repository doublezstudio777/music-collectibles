# 第 1 階段驗收：截圖（JPEG 80）、溢出、console error、computed style、橘面積、互動、grep
# 用法：dev server 跑在 5173 時 python3 _驗收.py，結果寫 result.json
import json, os, re, subprocess, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

B = "http://localhost:5173"
HERE = Path(__file__).parent
IMG = HERE / "img"
SITE = HERE.parent.parent / "網站"
q = urllib.parse.quote
PAGES = [
    ("首頁", "/"), ("首頁_第2頁", "/?page=2"), ("首頁_定價出售", "/?state=sale"), ("首頁_開放出價", "/?state=offer"),
    ("單則_賣家定價", "/share/1"), ("單則_賣家開放出價", "/share/8"), ("單則_買家開放出價", "/share/3"),
    ("單則_買家定價", "/share/9"), ("單則_已售出", "/share/7"), ("單則_純分享", "/share/2"),
    ("表單", "/share/new"), ("私訊清單", "/messages"), ("私訊_賣家", "/messages/1-aze"), ("私訊_買家", "/messages/3-xiaomeng"),
    ("標籤", "/tag/" + q("山線電台")), ("藝人", "/artist/mountain-radio"), ("藝人_發行單位", "/artist/harbor-fest"),
    ("作品", "/artist/mountain-radio/1"), ("作品_共同署名", "/artist/tide-highway/2"),
    ("個人_本人", "/u/xiaomeng"), ("個人_他人", "/u/rin"), ("喜愛清單", "/me/likes"), ("搜尋", "/search?q=" + q("山線")),
]
WIDTHS = [1440, 1000, 700, 390]
R = {"pages": {}, "styles": {}, "orange": {}, "checks": [], "grep": {}}

def settle(pg):
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)

def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name, detail)

with sync_playwright() as p:
    br = p.chromium.launch()
    # 1. 截圖＋溢出＋console
    for w in WIDTHS:
        ctx = br.new_context(viewport={"width": w, "height": 900})
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        for name, url in PAGES:
            errs.clear()
            pg.goto(B + url); settle(pg)
            sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), full_page=True, type="jpeg", quality=80)
            R["pages"].setdefault(name, {"url": url})[str(w)] = {"sw": sw, "iw": iw, "errors": list(errs)}
        ctx.close()

    # 2. computed style 抽三頁
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    js = """() => { const g=(s,p)=>{const e=document.querySelector(s);return e?getComputedStyle(e)[p]:null};
      return {body_bg:g('body','backgroundColor'), body_color:g('body','color'),
        nav_btn_bg:g('.nav .btn-p','backgroundColor'), nav_btn_color:g('.nav .btn-p','color'),
        slot_price_bg:g('.slot-price','backgroundColor'), slot_price_color:g('.slot-price','color'),
        filter_on_border:g('.filter[aria-current=page]','borderBottomColor'),
        deal_price_color:g('.deal-price','color'), send_btn_bg:g('.composer .btn-p','backgroundColor'),
        font:g('body','fontFamily')} }"""
    for name, url in [("首頁", "/"), ("單則_賣家定價", "/share/1"), ("私訊_賣家", "/messages/1-aze")]:
        pg.goto(B + url); settle(pg); R["styles"][name] = pg.evaluate(js)
    # 3. 橘面積：整頁截圖數像素
    from PIL import Image
    for name, url, w in [("首頁", "/", 1440), ("首頁", "/", 390), ("單則_買家定價", "/share/9", 1440)]:
        c = br.new_context(viewport={"width": w, "height": 900}); pp = c.new_page()
        pp.goto(B + url); settle(pp)
        f = HERE / "_tmp.png"; pp.screenshot(path=str(f), full_page=True)
        im = Image.open(f).convert("RGB"); px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else im.getdata()
        n = sum(1 for r, g, b in px if abs(r - 255) < 12 and abs(g - 106) < 18 and b < 30)
        R["orange"][f"{name}_{w}"] = round(n / (im.width * im.height) * 100, 2)
        f.unlink(); c.close()
    ctx.close()

    # 4. 互動（全新環境）
    ctx = br.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); settle(pg)
    check("首頁第 1 頁 24 則", pg.locator(".wall .card").count() == 24, str(pg.locator(".wall .card").count()))
    pg.goto(B + "/?page=3"); settle(pg)
    check("第 3 頁 12 則（60 則示範資料）", pg.locator(".wall .card").count() == 12, str(pg.locator(".wall .card").count()))
    pg.goto(B + "/?state=sale"); settle(pg)
    st = pg.eval_on_selector_all(".wall .card", "e=>e.map(x=>x.dataset.sale)")
    check("篩選定價出售只剩定價", st and set(st) == {"sale"}, f"{len(st)} 則")
    pg.goto(B + "/?state=offer"); settle(pg)
    st = pg.eval_on_selector_all(".wall .card", "e=>e.map(x=>x.dataset.sale)")
    check("篩選開放出價只剩開放出價", st and set(st) == {"offer"}, f"{len(st)} 則")
    allst = []
    for i in (1, 2, 3):
        pg.goto(B + f"/?page={i}"); settle(pg)
        allst += pg.eval_on_selector_all(".wall .card", "e=>e.map(x=>x.dataset.sale)")
    check("已售出留在全部", allst.count("sold") > 0, f"全部 {len(allst)} 則含已售出 {allst.count('sold')} 則")

    # 賣家：拒絕、接受、成交
    pg.goto(B + "/share/8"); settle(pg); pg.wait_for_selector("[data-testid=seller-bar]")
    row = pg.locator(".offer-row", has_text="阿哲")
    row.get_by_role("button", name="拒絕").click()
    check("賣家拒絕阿哲 NT$ 500 → 已拒絕", row.locator(".offer-status").inner_text() == "已拒絕")
    row = pg.locator(".offer-row", has_text="安琪")
    row.get_by_role("button", name="接受").click()
    check("賣家接受安琪 NT$ 800 → 出現成交給這位", row.get_by_role("button", name="成交給這位").count() == 1)
    row.get_by_role("button", name="成交給這位").click()
    check("成交後單則頁標已售出", pg.locator(".detail").get_attribute("data-sale") == "sold")
    pg.reload(); settle(pg); pg.wait_for_selector(".seller-bar")
    check("重新整理後仍已售出、拒絕仍在",
          pg.locator(".detail").get_attribute("data-sale") == "sold"
          and pg.locator(".offer-row", has_text="阿哲").locator(".offer-status").inner_text() == "已拒絕",
          pg.locator(".seller-bar").inner_text().replace("\n", " "))
    pg.goto(B + "/"); settle(pg); pg.wait_for_timeout(300)
    card = pg.locator(".card", has=pg.locator('a[href="/share/8"]')).first
    check("首頁卡片跨頁顯示已售出", card.get_attribute("data-sale") == "sold" and "NT$ 800" in card.inner_text())
    pg.goto(B + "/messages/8-angie"); settle(pg)
    check("成交那條私訊有「已成交 NT$ 800」", "已成交 NT$ 800" in pg.locator(".msgs").inner_text())
    pg.goto(B + "/messages/8-azhe"); settle(pg)
    t = pg.locator(".msgs").inner_text()
    check("其他條私訊有「賣家拒絕了」「這件已售出」", "賣家拒絕了 NT$ 500" in t and "這件已售出" in t)

    # 買家：出價、我要買
    pg.goto(B + "/share/3"); settle(pg); pg.wait_for_selector(".offers")
    pg.get_by_role("button", name="出價", exact=True).click()
    pg.fill("#offer-amount", "650"); pg.get_by_role("button", name="送出出價").click()
    pg.wait_for_url("**/messages/3-xiaomeng"); settle(pg)
    check("出價後進私訊，結構化訊息 NT$ 650", pg.locator(".msg-offer", has_text="NT$ 650").count() == 1)
    pg.goto(B + "/share/3"); settle(pg); pg.wait_for_selector(".offers")
    check("出價公開列表出現小孟 NT$ 650", pg.locator(".offer-row", has_text="NT$ 650").count() == 1)
    pg.reload(); settle(pg); pg.wait_for_selector(".offers")
    check("重新整理後出價仍在", pg.locator(".offer-row", has_text="NT$ 650").count() == 1)
    pg.goto(B + "/share/9"); settle(pg)
    pg.get_by_role("button", name="我要買").click(); pg.wait_for_url("**/messages/9-xiaomeng"); settle(pg)
    check("我要買 → 私訊出現「我要買 NT$ 1,800」", pg.locator(".msg-offer", has_text="NT$ 1,800").count() == 1)
    pg.fill("#convo-text", "週六台南可以面交嗎"); pg.get_by_role("button", name="送出").click()
    pg.reload(); settle(pg)
    check("私訊文字重新整理後仍在", "週六台南可以面交嗎" in pg.locator(".msgs").inner_text())

    # 賣家改狀態
    pg.goto(B + "/share/10"); settle(pg); pg.wait_for_selector("[data-testid=seller-bar]")
    pg.get_by_role("button", name="定價出售").click(); pg.fill("#seller-price", "999")
    pg.get_by_role("button", name="開始出售").click()
    pg.goto(B + "/?state=sale"); settle(pg); pg.wait_for_timeout(300)
    c = pg.locator(".card", has=pg.locator('a[href="/share/10"]'))
    check("賣家改定價 999 → 首頁定價篩選出現、膠囊 NT$ 999", c.count() == 1 and "NT$ 999" in c.first.inner_text())

    # 點讚、我有、想要
    pg.goto(B + "/share/2"); settle(pg)
    like = pg.locator(".detail .like"); pg.wait_for_selector(".detail .like[aria-pressed]")
    before = like.inner_text(); like.click()
    pg.goto(B + "/"); settle(pg); pg.wait_for_timeout(300)
    cl = pg.locator(".card", has=pg.locator('a[href="/share/2"]')).first.locator(".like")
    check("點讚跨頁保留", cl.get_attribute("aria-pressed") == "true", f"{before}→{cl.inner_text()}")
    pg.reload(); settle(pg); pg.wait_for_timeout(300)
    check("點讚重新整理後保留", pg.locator(".card", has=pg.locator('a[href="/share/2"]')).first.locator(".like").get_attribute("aria-pressed") == "true")
    pg.goto(B + "/artist/mountain-radio/1"); settle(pg); pg.wait_for_selector(".hold[aria-pressed]")
    blk = pg.locator(".compare th", has_text="2023 再版")
    blk.get_by_role("button", name=re.compile("我有")).click()
    blk.get_by_role("button", name=re.compile("想要")).click()
    pg.reload(); settle(pg); pg.wait_for_selector(".hold[aria-pressed]")
    check("我有、想要重新整理後保留",
          blk.get_by_role("button", name=re.compile("我有")).get_attribute("aria-pressed") == "true"
          and blk.get_by_role("button", name=re.compile("想要")).get_attribute("aria-pressed") == "true")
    pg.goto(B + "/u/xiaomeng"); settle(pg); pg.wait_for_timeout(300)
    check("個人頁我有含 2023 再版", "2023 再版" in pg.locator("main").inner_text())

    # 表單
    pg.goto(B + "/share/new"); settle(pg)
    pg.get_by_role("button", name="發布").click()
    check("空送出三格必填都報錯", pg.locator(".field-error").count() == 3)
    check("要不要賣預設純分享", pg.get_by_role("button", name="純分享").get_attribute("aria-pressed") == "true"
          and pg.locator("#share-form-price").count() == 0)
    pg.set_input_files('input[type=file]', str(SITE / "public/images/fictional-music-collection.jpg"))
    pg.fill("#share-form-what", "測試：山線電台簽名卡帶")
    pg.fill("#share-form-about", "mountain"); pg.locator(".suggest button").first.click()
    pg.get_by_role("button", name="定價出售").click()
    check("選定價才出現 NT$ 欄", pg.locator("#share-form-price").count() == 1)
    pg.get_by_role("button", name="發布").click()
    check("定價沒填擋下", pg.locator(".field-error", has_text="金額").count() == 1)
    pg.fill("#share-form-price", "500"); pg.get_by_role("button", name="發布").click()
    pg.wait_for_url("**/share/1001"); settle(pg)
    check("發布後單則頁是定價 NT$ 500", pg.locator(".detail").get_attribute("data-sale") == "sale"
          and "NT$ 500" in pg.locator(".deal").inner_text())
    check("互動全程 console error 0", len(errs) == 0, "; ".join(errs[:3]))
    ctx.close()

    # 手機分頁
    ctx = br.new_context(viewport={"width": 390, "height": 900}); pg = ctx.new_page()
    pg.goto(B + "/?page=2"); settle(pg)
    check("手機分頁收成 ‹ 2 / 3 ›", pg.locator(".pg-mini").inner_text().replace(" ", "") == "2/3"
          and pg.locator(".pg-full").first.is_hidden())
    cols = pg.evaluate("getComputedStyle(document.querySelector('.wall')).gridTemplateColumns.split(' ').length")
    check("手機牆兩欄", cols == 2, str(cols))
    ctx.close()

    # 渲染後 HTML 的 grep
    ctx = br.new_context(); pg = ctx.new_page()
    words = ["付款", "結帳", "運費", "其他炫收藏"]
    hits = {w: [] for w in words}
    for name, url in PAGES:
        pg.goto(B + url); settle(pg)
        html = pg.content()
        for w in words:
            if w in html: hits[w].append(name)
    R["grep"]["rendered"] = hits
    ctx.close()
    br.close()

src = subprocess.run(["grep", "-rn", "-E", "付款|結帳|運費|其他炫收藏", "app", "components", "lib"],
                     cwd=SITE, capture_output=True, text=True).stdout
R["grep"]["source"] = src.strip().splitlines()
json.dump(R, open(HERE / "result.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("checks", sum(c["ok"] for c in R["checks"]), "/", len(R["checks"]))
print("orange", R["orange"]); print("grep", R["grep"])
bad = [(n, w, v) for n, d in R["pages"].items() for w, v in d.items() if w != "url" and (v["sw"] != v["iw"] or v["errors"])]
print("overflow/errors", bad)
