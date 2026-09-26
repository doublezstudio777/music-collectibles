# 第 1.5 階段驗收：截圖（JPEG 80）、溢出、console error、逐條實點
# 用法：dev server 跑在 5173 時 python3 _驗收.py，結果寫 result.json
import json, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

B = "http://localhost:5173"
HERE = Path(__file__).parent
IMG = HERE / "img"
IMG.mkdir(exist_ok=True)
PHOTO = HERE / "_測試照片.jpg"
q = urllib.parse.quote
PAGES = [
    ("首頁_追蹤中", "/"), ("首頁_最新", "/?sort=new"), ("首頁_只看在賣", "/?state=selling"),
    ("藝人_山線電台", "/artist/mountain-radio"), ("藝人_潮汐公路", "/artist/tide-highway"),
    ("系列_專輯發行", "/artist/mountain-radio/1"), ("系列_巡迴演唱會", "/artist/tide-highway/3"),
    ("系列_爭議版本", "/artist/faint-signal/1"), ("系列_音樂祭", "/artist/harbor-fest/1"),
    ("單則_被鎖本人", "/share/8"), ("單則_爭議版本買家", "/share/6"), ("單則_有已知仿冒", "/share/7"),
    ("單則_一般", "/share/1"), ("單則_演唱會毛巾", "/share/92"),
    ("表單", "/share/new"), ("個人_本人", "/u/xiaomeng"), ("個人_未認證", "/u/kai"),
    ("管理後台", "/admin"), ("搜尋", "/search?q=" + q("海潮")),
]
WIDTHS = [1440, 390]
R = {"pages": {}, "checks": []}


def settle(pg):
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(300)


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)})
    print(("PASS " if ok else "FAIL ") + name, detail)


def menu(pg, label):
    pg.locator("summary.ava").click()
    pg.locator(".menu-panel").get_by_role("button", name=label).click()
    pg.wait_for_timeout(200)


with sync_playwright() as p:
    br = p.chromium.launch()

    # 截圖＋溢出＋console（全新狀態）
    for w in WIDTHS:
        ctx = br.new_context(viewport={"width": w, "height": 900})
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        shots = PAGES + [("首頁_沒追蹤", "__nofollow__")]
        for name, url in shots:
            errs.clear()
            if url == "__nofollow__":
                pg.goto(B + "/"); settle(pg)
                menu(pg, "清掉追蹤"); settle(pg)
                url = "/"
            else:
                pg.goto(B + url); settle(pg)
            sw, iw = pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), full_page=True, type="jpeg", quality=80)
            R["pages"].setdefault(name, {"url": url})[str(w)] = {"sw": sw, "iw": iw, "errors": list(errs)}
        ctx.close()

    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    # 1 追蹤藝人
    pg.goto(B + "/artist/before-rain-stops"); settle(pg)
    btn = pg.locator(".head-actions .follow")
    check("1 藝人頁有追蹤按鈕", btn.inner_text() == "追蹤")
    btn.click(); pg.wait_for_timeout(200)
    check("1 點了變追蹤中", btn.inner_text() == "追蹤中" and btn.get_attribute("aria-pressed") == "true")
    pg.goto(B + "/u/xiaomeng"); settle(pg)
    fl = pg.locator("[data-testid=follow-list]")
    names = fl.locator(".follow-row .row-main").all_inner_texts()
    check("1 個人頁列出追蹤的藝人（預設 2 位＋剛追的）", names == ["山線電台", "潮汐公路", "雨停以前"], names)
    fl.locator(".follow-row", has_text="雨停以前").locator(".follow").click(); pg.wait_for_timeout(200)
    pg.reload(); settle(pg)
    check("1 個人頁取消追蹤後重新整理仍生效", pg.locator("[data-testid=follow-list] .follow-row").count() == 2)

    # 2 首頁追蹤中
    pg.goto(B + "/"); settle(pg)
    cur = pg.locator(".filters .filter[aria-current=page]").inner_text()
    tabs = pg.locator(".filters .filter").all_inner_texts()
    check("2 分頁籤順序 追蹤中／最新／最多讚，預設追蹤中", tabs == ["追蹤中", "最新", "最多讚"] and cur == "追蹤中", tabs)
    tags = pg.locator(".card").evaluate_all("els => els.map(e => [...e.querySelectorAll('.tags a')].map(a => a.textContent))")
    ok = all(any(t in ("山線電台", "潮汐公路", "Mountain Radio", "Tide Highway") for t in ts) for ts in tags)
    check("2 追蹤中只列已追蹤藝人相關的收藏", ok and len(tags) > 0, f"{len(tags)} 則")
    order = pg.locator(".card .card-title a").evaluate_all("els => els.slice(0,3).map(a => a.getAttribute('href'))")
    check("2 追蹤中最新在前", order[:2] == ["/share/1", "/share/92"], order)
    check("2 只看在賣開關保留", pg.locator(".sell-toggle", has_text="只看在賣").count() == 1)
    menu(pg, "清掉追蹤"); settle(pg)
    check("2 沒追蹤時出現熱門藝人", pg.locator(".hot .hot-item").count() >= 3)
    n_latest = pg.locator(".card").count()
    check("2 沒追蹤時下方顯示最新（整頁 24 則）", n_latest == 24, n_latest)
    pg.locator(".hot-item", has_text="雨停以前").locator(".follow").click(); pg.wait_for_timeout(300)
    tags = pg.locator(".card").evaluate_all("els => els.map(e => [...e.querySelectorAll('.tags a')].map(a => a.textContent))")
    check("2 追蹤第一位後首頁自動變追蹤中", pg.locator(".hot").count() == 0 and len(tags) > 0
          and all("雨停以前" in ts for ts in tags), f"{len(tags)} 則")
    pg.goto(B + "/u/xiaomeng"); settle(pg)
    for b in pg.locator("[data-testid=follow-list] .follow").all():
        b.click(); pg.wait_for_timeout(100)
    pg.goto(B + "/artist/mountain-radio"); settle(pg); pg.locator(".head-actions .follow").click()
    pg.goto(B + "/artist/tide-highway"); settle(pg); pg.locator(".head-actions .follow").click()

    # 3 正版辨識
    pg.goto(B + "/artist/mountain-radio/1"); settle(pg)
    v1 = pg.locator("#cd-v1")
    check("3 版本區塊有正版辨識清單（條碼、目錄號、包裝…）", v1.locator(".marks .mark").count() >= 4,
          v1.locator(".mark-text b").all_inner_texts())
    check("3 辨識項目附照片（灰色塊）", v1.locator(".mark .ph-block").count() >= 2)
    check("3 收藏者勾選的參考照片出現在版本區塊", v1.locator(".refs .ref-thumb").count() >= 1)

    # 4 已知仿冒
    v2 = pg.locator("#cd-v2")
    check("4 版本有已知仿冒條目，正版與仿冒並排", v2.locator(".fake").count() == 1
          and v2.locator(".fake-photos figcaption").all_inner_texts() == ["正版", "仿冒"]
          and v2.locator(".fake-tbl thead th").all_inner_texts() == ["特徵", "正版", "仿冒"])
    pg.goto(B + "/?sort=new"); settle(pg)
    check("4 商品卡出現「有已知仿冒」小標示", pg.locator(".card[data-fake=true] .flag-fake").count() >= 1)
    pg.goto(B + "/share/7"); settle(pg)
    check("4 單則頁出現「有已知仿冒」與對照連結", pg.locator(".fake-note .flag-fake").count() == 1
          and pg.locator(".fake-note a").get_attribute("href").endswith("#cd-v2-fakes"))

    # 5 表單：點選流程＋辨識參考勾選
    pg.goto(B + "/share/new"); settle(pg)
    combos = {}
    for g in ["男歌手", "女歌手", "團體"]:
        for r in ["國內", "國外"]:
            pg.locator("[data-testid=pick-gender] .pick", has_text=g).click()
            pg.locator("[data-testid=pick-region] .pick", has_text=r).click()
            combos[g + r] = pg.locator("[data-testid=pick-artist] .pick").all_inner_texts()
            pg.locator("[data-testid=pick-gender] .pick", has_text=g).click()
            pg.locator("[data-testid=pick-region] .pick", has_text=r).click()
    check("5 分類 3×2 每個組合至少 1 位藝人", all(len(v) >= 1 for v in combos.values()), combos)
    check("5 分類點選會縮小範圍（女歌手＋國外＝森遙）", combos["女歌手國外"] == ["森遙"], combos["女歌手國外"])
    check("5 沒選系列時是物件類型點選", pg.locator("[data-testid=pick-kind] .pick").all_inner_texts()
          == ["CD", "黑膠", "卡帶", "藍光／DVD", "毛巾", "T 恤", "海報", "場刊", "其他周邊"])
    pg.locator("[data-testid=pick-kind] .pick", has_text="其他周邊").click()
    check("5 選其他周邊才出現補充文字", pg.locator("#share-form-kind-note").count() == 1)
    pg.locator("[data-testid=pick-kind] .pick", has_text="其他周邊").click()
    check("5 取消其他周邊補充欄消失", pg.locator("#share-form-kind-note").count() == 0)
    pg.locator("#share-form-about").fill("Tide")
    check("5 打字搜尋仍可用", pg.locator(".suggest", has_text="潮汐公路").count() == 1)
    pg.locator("#share-form-about").fill("")
    pg.locator("[data-testid=pick-gender] .pick", has_text="團體").click()
    pg.locator("[data-testid=pick-artist] .pick", has_text="山線電台").click()
    series = pg.locator("[data-testid=pick-series] > .pick").all_inner_texts()
    check("5 選藝人後列出他的系列（共同署名也在）", "2018《夜行採集》專輯發行" in series and "2024《海線對話》EP 發行" in series, series)
    pg.locator("[data-testid=pick-series] .pick-add").click()
    check("5 系列「這裡沒有，我要新增」只顯示下一階段", pg.locator("[data-testid=pick-series] .next-phase-note").inner_text() == "下一階段")
    pg.locator("[data-testid=pick-series] > .pick", has_text="夜行採集").click()
    items = pg.locator("[data-testid=pick-item] > .pick").all_inner_texts()
    check("5 點系列後列出品項", items == ["CD", "卡帶", "黑膠"], items)
    pg.locator("[data-testid=pick-item] > .pick", has_text="CD").click()
    vers = pg.locator("[data-testid=pick-version] .pick").all_inner_texts()
    check("5 點品項後列出版本＋不確定（預設不確定）", vers == ["首批紙套版", "日版附側標", "2023 再版", "不確定"]
          and pg.locator("[data-testid=pick-version] .pick[aria-pressed=true]").inner_text() == "不確定", vers)
    pg.locator("[data-testid=pick-version] .pick", has_text="日版附側標").click()
    pg.set_input_files("input[type=file]", str(PHOTO))
    pg.wait_for_timeout(500)
    check("5 表單有「照片可當辨識參考」勾選", pg.locator("label.check", has_text="照片可當辨識參考").count() == 1)
    pg.check("#share-form-ref")
    pg.get_by_role("button", name="發布").click()
    pg.wait_for_url("**/share/1*"); settle(pg)
    check("5 發布後單則頁：類型、連結到系列品項版本、辨識參考",
          pg.locator(".detail-kind").inner_text().startswith("CD") and "照片可當辨識參考" in pg.locator(".detail-kind").inner_text()
          and pg.locator(".detail-link a").inner_text() == "夜行採集 › CD › 日版附側標", pg.locator(".detail-link a").inner_text())
    check("5 發到日版的新收藏也出現已知仿冒提醒", pg.locator(".fake-note").count() == 1)

    # 6 檢舉
    pg.goto(B + "/share/9"); settle(pg)
    pg.get_by_role("button", name="檢舉這則").click()
    rs = pg.locator(".report-form .radio span").all_inner_texts()
    check("6 單則收藏檢舉理由：盜版／仿冒、其他", rs == ["盜版／仿冒", "其他"], rs)
    pg.get_by_role("button", name="送出檢舉").click(); pg.wait_for_timeout(200)
    check("6 送出後顯示已檢舉", pg.locator("[data-testid=report-done]").count() == 1)
    pg.reload(); settle(pg)
    check("6 每個帳號對同一對象一次（重新整理仍是已檢舉、沒有按鈕）", pg.locator("[data-testid=report-done]").count() == 1
          and pg.get_by_role("button", name="檢舉這則").count() == 0)
    pg.goto(B + "/artist/tide-highway/3"); settle(pg)
    pg.get_by_role("button", name="檢舉這個品項（毛巾）").click()
    rs = pg.locator("#towel .report-form .radio span").all_inner_texts()
    check("6 品項檢舉理由：官方沒出過這個品項、其他", rs == ["官方沒出過這個品項", "其他"], rs)
    pg.locator("#towel .report-form").get_by_role("button", name="取消").click()
    pg.locator("#towel-v2").get_by_role("button", name="檢舉這個版本").click()
    rs = pg.locator("#towel-v2 .report-form .radio span").all_inner_texts()
    check("6 版本檢舉理由：官方沒出過這個版本、其他", rs == ["官方沒出過這個版本", "其他"], rs)
    pg.locator("#towel-v2 .radio", has_text="其他").click()
    pg.locator("#towel-v2").get_by_role("button", name="送出檢舉").click()
    check("6 選其他沒寫原因會擋", pg.locator("#towel-v2 .field-error").inner_text() == "寫一句原因")
    menu(pg, "切換到阿凱（未認證）")
    pg.goto(B + "/share/11"); settle(pg)
    pg.get_by_role("button", name="檢舉這則").click()
    check("6 未認證帳號顯示「認證後才能檢舉」", pg.locator(".report-note").inner_text() == "認證後才能檢舉"
          and pg.locator(".report-form").count() == 0)
    menu(pg, "切換到小孟（已認證）")

    # 7 達門檻
    pg.goto(B + "/share/8"); settle(pg)
    check("7 被鎖收藏醒目標示「多人檢舉：疑似盜版」", pg.locator(".lock-banner b").inner_text() == "多人檢舉：疑似盜版")
    check("7 不能定價（沒有賣家操作列）", pg.locator("[data-testid=seller-bar]").count() == 0)
    st = pg.locator(".offer-row .offer-status").all_inner_texts()
    check("7 既有出價顯示凍結、沒有接受拒絕", "凍結" in st and pg.get_by_role("button", name="接受").count() == 0, st)
    check("7 內容仍可瀏覽（標題、故事、標籤）", pg.locator(".detail-info .page-title").count() == 1
          and pg.locator(".detail-info .prose").count() == 1)
    pg.goto(B + "/share/6"); settle(pg)
    check("7 爭議版本標示「爭議版本：官方未證實發行」", pg.locator(".lock-banner b").inner_text() == "爭議版本：官方未證實發行")
    check("7 爭議版本底下的收藏不能出價或我要買", pg.get_by_role("button", name="我要買").count() == 0
          and pg.get_by_role("button", name="出價").count() == 0 and pg.locator("[data-testid=frozen]").count() == 1)
    pg.goto(B + "/artist/faint-signal/1"); settle(pg)
    check("7 系列頁版本區塊有爭議標示，底下兩則收藏都標交易暫停",
          pg.locator("#cd-v1 .lock-banner").count() == 1 and pg.locator("#cd-v1 .card[data-locked=true]").count() >= 3)
    pg.goto(B + "/?sort=new"); settle(pg)
    check("7 商品卡被鎖的標「疑似盜版」＋交易暫停", pg.locator(".card[data-locked=true] .flag-lock").count() >= 1
          and pg.locator(".card[data-locked=true] .slot-paused").count() >= 1)
    pg.goto(B + "/?sort=new&state=selling"); settle(pg)
    hrefs = pg.locator(".card .card-title a").evaluate_all("els => els.map(a => a.getAttribute('href'))")
    check("7 只看在賣不列被鎖的", "/share/8" not in hrefs and "/share/6" not in hrefs)

    # 8 申訴
    pg.goto(B + "/share/8"); settle(pg)
    pg.get_by_role("button", name="向音藏申訴").click()
    pg.get_by_role("button", name="送出申訴").click()
    check("8 沒寫說明會擋", pg.locator(".appeal-form .field-error").count() == 1)
    pg.set_input_files(".appeal-form input[type=file]", str(PHOTO)); pg.wait_for_timeout(500)
    check("8 證據照片可附", pg.locator(".appeal-form .evidence-ph").count() == 1)
    pg.fill(".appeal-form textarea", "書店老闆可以作證，附上當年寄賣單。")
    pg.get_by_role("button", name="送出申訴").click(); pg.wait_for_timeout(200)
    check("8 送出後顯示審核中", pg.locator("[data-testid=appeal-status]").inner_text() == "申訴審核中")

    # 9 管理後台
    pg.goto(B + "/admin"); settle(pg)
    check("9 門檻預設 10", pg.input_value("#threshold") == "10")
    rows = pg.locator("[data-testid=report-table] tbody tr")
    check("9 檢舉列表有收藏、品項、版本三種層級", set(rows.locator("td:nth-child(2)").all_inner_texts()) == {"收藏", "品項", "版本"})
    check("9 share:8 已鎖定", "已鎖定" in pg.locator("tr[data-target='share:8']").inner_text())
    ap = pg.locator(".appeal")
    check("9 申訴列表：示範 1 則＋剛送的 1 則，看得到證據", ap.count() == 2 and pg.locator(".appeal .evidence-ph").count() == 3)
    pg.locator(".appeal[data-target='share:8']").get_by_role("button", name="解鎖").click()
    pg.locator(".appeal[data-target='version:faint-signal/1#cd-v1']").get_by_role("button", name="維持鎖定").click()
    check("9 裁決後狀態改變", pg.locator(".appeal[data-target='share:8'] .appeal-st").inner_text() == "已解鎖"
          and pg.locator(".appeal[data-target='version:faint-signal/1#cd-v1'] .appeal-st").inner_text() == "維持鎖定")
    pg.goto(B + "/share/8"); settle(pg)
    check("9 解鎖後單則頁不再鎖、發文者看到申訴通過", pg.locator(".lock-banner").count() == 0
          and pg.locator("[data-testid=seller-bar]").count() == 1
          and pg.locator("[data-testid=appeal-status]").count() == 0)
    pg.goto(B + "/admin"); settle(pg)
    pg.fill("#threshold", "5"); pg.get_by_role("button", name="儲存").click(); pg.wait_for_timeout(200)
    pg.goto(B + "/share/9"); settle(pg)
    check("9 門檻調到 5，第 9 則（4＋我 1 票）被鎖", pg.locator(".lock-banner b").inner_text() == "多人檢舉：疑似盜版")
    pg.goto(B + "/admin"); settle(pg)
    pg.fill("#threshold", "10"); pg.get_by_role("button", name="儲存").click(); pg.wait_for_timeout(200)
    pg.goto(B + "/share/9"); settle(pg)
    check("9 門檻調回 10 解除", pg.locator(".lock-banner").count() == 0)

    # 系列層
    pg.goto(B + "/artist/tide-highway/3"); settle(pg)
    check("系列 演唱會系列只有毛巾、T 恤、場刊", pg.locator(".item-index .item-link b").all_inner_texts() == ["毛巾", "T 恤", "場刊"])
    check("系列 品項一覽在最上面（header 之後第一個區塊）",
          pg.evaluate("document.querySelector('.work-head').nextElementSibling.classList.contains('item-index')"))
    check("系列 毛巾兩個版本才出現比較表，T 恤單一版本沒有",
          pg.locator("#towel .compare").count() == 1 and pg.locator("#tee .compare").count() == 0 and pg.locator("#tee .spec").count() == 1)
    check("系列 同一頁有毛巾、T 恤、場刊的炫收藏", all(pg.locator(f"#{i} .card").count() >= 1 for i in ["towel", "tee", "program"]))
    pg.goto(B + "/artist/mountain-radio/1"); settle(pg)
    check("系列 專輯系列：CD 三版比較＋卡帶＋黑膠", pg.locator("#cd .compare thead th.compare-ver").count() == 3
          and pg.locator(".item-index .item-link b").all_inner_texts() == ["CD", "卡帶", "黑膠"])
    pg.goto(B + "/artist/mountain-radio"); settle(pg)
    tiles = pg.locator(".tiles .tile-title").all_inner_texts()
    check("系列 藝人頁主要作品改列系列（含共同署名）", "2018《夜行採集》專輯發行" in tiles and "2024《海線對話》EP 發行" in tiles, tiles)
    pg.goto(B + "/share/1"); settle(pg)
    heads = pg.locator(".related .block-title").all_inner_texts()
    check("系列 單則頁底部同系列優先，其次同藝人", len(heads) == 2 and "夜行採集" in heads[0] and heads[1].startswith("跟山線電台"), heads)
    r = pg.goto(B + "/artist/harbor-fest/2")
    check("系列 舊作品網址 /artist/harbor-fest/2 不留相容", r.status == 404, r.status)
    r = pg.goto(B + "/artist/tide-highway/3#towel-v2"); settle(pg)
    check("系列 版本錨點 #towel-v2 存在", pg.locator("#towel-v2").count() == 1)

    R["interaction_errors"] = [e for e in errs if "404" not in e]
    ctx.close()
    br.close()

ok = sum(c["ok"] for c in R["checks"])
over = [n for n, v in R["pages"].items() for w in ("1440", "390") if v[w]["sw"] != v[w]["iw"]]
cerr = [(n, w, v[w]["errors"]) for n, v in R["pages"].items() for w in ("1440", "390") if v[w]["errors"]]
R["summary"] = {"checks": f"{ok}/{len(R['checks'])}", "screens": len(R["pages"]) * 2, "overflow": over, "console_errors": cerr}
print(json.dumps(R["summary"], ensure_ascii=False))
(HERE / "result.json").write_text(json.dumps(R, ensure_ascii=False, indent=1), encoding="utf-8")
