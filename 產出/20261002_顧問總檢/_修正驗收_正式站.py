"""設計大師總檢 37 項修正 正式站驗收（只驗公開頁，不登入、不寫資料）。

用法：python3 _修正驗收_正式站.py [https://lemibox.com] [輸出資料夾]
截圖 JPEG 80 到 img_修正後/正式_*.jpg，結果 result_修正_正式站.json。
"""

import json
import re
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://lemibox.com").rstrip("/")
HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "img_修正後"
OUT.mkdir(exist_ok=True)
results: list[tuple[str, bool, str]] = []
ERRORS: list[str] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)


def ctx(browser, width, mobile, dark=False):
    return browser.new_context(
        viewport={"width": width, "height": 844 if mobile else 900}, device_scale_factor=3 if mobile else 1, is_mobile=mobile, has_touch=mobile,
        color_scheme="dark" if dark else "light", locale="zh-TW", bypass_csp=True,
    )


def page_of(c):
    p = c.new_page()
    p.on("console", lambda m: ERRORS.append(f"{p.url} {m.text}") if m.type == "error" and "favicon" not in m.text else None)
    return p


def go(p, path, settle=1200):
    r = p.goto(BASE + path, wait_until="load")
    try:
        p.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    p.wait_for_timeout(settle)
    return r


def shot(p, name, full=False, clip=None):
    p.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=80, full_page=full, clip=clip)


def overflow(p):
    return p.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")


def main():
    with sync_playwright() as pw:
        wk = pw.webkit.launch()
        ch = pw.chromium.launch()

        # 版本
        c = ctx(ch, 1440, False)
        p = page_of(c)
        r = go(p, "/about")
        build = r.headers.get("x-yz-build", "")
        check("正式站 x-yz-build", bool(build), build)
        c.close()

        # M1 404 淺色、深色
        for dark in (False, True):
            c = ctx(wk, 390, True, dark=dark)
            p = page_of(c)
            r = p.goto(BASE + "/this-page-does-not-exist", wait_until="load")
            p.wait_for_timeout(800)
            tag = "深色" if dark else "淺色"
            check(f"M1 404 {tag} 狀態碼＋繁中", r.status == 404 and p.locator("h1").inner_text().strip() == "找不到這一頁", f"{r.status} {p.title()}")
            hb = p.evaluate("getComputedStyle(document.querySelector('header.nav')).backgroundColor")
            check(f"M1 404 {tag} 頁首白底", hb == "rgb(255, 255, 255)", hb)
            shot(p, f"正式_01_404_{tag}_390")
            c.close()
        c = ctx(wk, 390, True)
        p = page_of(c)
        r = p.goto(BASE + "/share/99999", wait_until="load")
        p.wait_for_timeout(600)
        check("M1 被刪收藏 404", r.status == 404 and "不在了" in p.locator("h1").inner_text())
        shot(p, "正式_01_404_被刪收藏_390")

        # M6、S2、L1、L3、L5：首頁
        go(p, "/")
        tw = p.evaluate("getComputedStyle(document.querySelector('.card-title')).textWrap || getComputedStyle(document.querySelector('.card-title')).textWrapMode")
        check("M6 卡片標題 text-wrap: wrap", tw in ("wrap", "normal", ""), tw)
        h1w = p.evaluate("getComputedStyle(document.querySelector('h1, h2')).textWrap || ''")
        check("M6 標題不是 balance", h1w != "balance", h1w)
        check("S2 首頁開關「只看出售中」", p.locator(".sell-toggle").inner_text().strip() == "只看出售中")
        tn = p.locator("[data-testid=terms-notice]")
        check("L1 公告條 ≤ 72px", tn.count() == 0 or tn.bounding_box()["height"] <= 72, str(tn.count() and round(tn.bounding_box()["height"])))
        pick = p.locator("[data-testid=home-pick]")
        check("L3 今日推薦不推 0 則收藏", pick.count() == 0 or "0 則收藏" not in pick.inner_text())
        check("L5 main#main", p.locator("main#main").count() == 1 and p.locator(".skip-link").count() == 1)
        ov = overflow(p)
        check("首頁 390 無橫向溢出", ov[0] <= ov[1], str(ov))
        shot(p, "正式_06_首頁_390")

        # S21 搜尋頁
        go(p, "/search")
        h = p.evaluate("document.documentElement.scrollHeight")
        check("S21 搜尋頁沒輸入不列全部", p.locator("[data-testid=search-start]").count() == 1 and h < 4000, f"{h}px")
        shot(p, "正式_16_搜尋頁空狀態_390", full=True)
        go(p, "/search?q=cd")
        n = p.locator("[data-testid=search-series] li").count()
        check("S21 有關鍵字時分頁", n <= 30, f"{n} 筆")

        # S20 藝人目錄
        go(p, "/artists?type=group")
        check("S20 標題跟著篩選", p.locator("[data-testid=artists-title]").inner_text().startswith("團體"))
        ph = p.evaluate("[...document.querySelectorAll('.filter-picks .pick')].map(e => Math.round(e.getBoundingClientRect().height))")
        lh = p.evaluate("[...document.querySelectorAll('.dir-list .dir-link')].slice(0, 20).map(e => Math.round(e.getBoundingClientRect().height))")
        check("S20 篩選與藝人列 ≥ 40px", all(x >= 40 for x in ph + lh), f"{set(ph)} {set(lh)}")
        shot(p, "正式_16_藝人目錄_390")

        # S15 新手指南
        go(p, "/guide")
        imgs = p.evaluate("""async () => { const out = []; for (const i of document.querySelectorAll('[data-guide-img]')) { i.scrollIntoView({ block: 'center' }); const t0 = Date.now(); while (!(i.complete && i.naturalWidth > 0) && Date.now() - t0 < 8000) await new Promise(r => setTimeout(r, 100)); out.push([i.dataset.guideImg, i.naturalWidth > 0]); } window.scrollTo(0, 0); return out; }""")
        check("S15 新手指南圖全部載到", all(x[1] for x in imgs), str(imgs))
        check("S15 指南提到合集、一次發多張、願望清單、私訊", all(k in p.locator("main").inner_text() for k in ("一次發多張", "發合集", "願望清單", "私訊")))
        shot(p, "正式_15_新手指南_390", full=True)

        # L2 榮譽榜、L8 登入頁、S5 單則頁
        go(p, "/ranking")
        check("L2 榮譽榜寫什麼時候開始算", "每天凌晨統計" in p.locator("main").inner_text() or p.locator("main table").count() > 0)
        go(p, "/login")
        check("L8 登入頁頁首沒有登入", p.locator(".nav-login").count() == 0)
        shot(p, "正式_L8_登入頁_390", clip={"x": 0, "y": 0, "width": 390, "height": 200})
        go(p, "/share/9")
        dl = p.locator(".detail-link")
        check("S5 單則頁「收錄在」一句", dl.count() == 1 and dl.inner_text().strip().startswith("收錄在《") and p.locator(".detail-kind").count() == 0, dl.inner_text().strip() if dl.count() else "沒有 detail-link")
        shot(p, "正式_10_單則頁_390")
        c.close()

        # M5、M7、S3、S18、S19、L4：系列頁 390 與 1440
        for width, mobile, br, tag in ((390, True, wk, "390"), (1440, False, ch, "1440")):
            c = ctx(br, width, mobile)
            p = page_of(c)
            go(p, "/artist/hyukoh/1")
            html = re.sub(r"<script[\s\S]*?</script>", "", p.content())
            check(f"M7 系列頁 {tag} 沒有內部欄位", all(bad not in html for bad in ("資料狀態", "曲目差異", "比較基準", "待確認")))
            check(f"M5 {tag} 只有一張比較表", p.locator("table.compare").count() == 0 and p.locator(".ver-table").count() == 1)
            hs = p.evaluate("[...new Set([...document.querySelectorAll('.ver-table tbody tr')].map(r => Math.round(r.getBoundingClientRect().height)))]")
            check(f"M5 版本比較表列高一種 {tag}", len(hs) == 1, str(hs))
            check(f"S3 系列頁頭部文字連結 {tag}", p.locator(".series-sub-acts .link-btn").count() == 3)
            check(f"S18 登入提示一個品項一次 {tag}", p.locator("[data-testid=details-gate]").count() == p.locator(".item-block").count())
            ov = overflow(p)
            check(f"系列頁 {tag} 無橫向溢出", ov[0] <= ov[1], str(ov))
            if width == 1440:
                edges = p.evaluate("['.ver-table-scroll', '.market-stats', '.tracks-main .tracklist'].map(s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().right) : null; })")
                wrap_r = p.evaluate("Math.round(document.querySelector('main.wrap').getBoundingClientRect().right - 32)")
                check("S19 桌機三塊右緣對齊", all(e is None or abs(e - wrap_r) <= 1 for e in edges), f"{edges} vs {wrap_r}")
                yr = p.locator(".ver-table tbody tr").first.locator("td").nth(1).inner_text().strip()
                check("L4 發行日台灣寫法", bool(re.match(r"^\d{4}(/\d{1,2}/\d{1,2})?$", yr)), yr)
                shot(p, "正式_05_系列頁_1440", full=True)
                p.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                p.wait_for_timeout(300)
                lines = p.evaluate("[document.querySelector('.foot'), document.querySelector('.foot-cc-wrap')].map(e => Math.round(e.getBoundingClientRect().width))")
                check("L6 頁尾兩條線等寬", lines[0] == lines[1], str(lines))
            else:
                shot(p, "正式_05b_系列頁首屏_390")
                shot(p, "正式_11_系列頁_390", full=True)
            c.close()

        # 公開頁橫向溢出 390／375／320／1440
        public = ["/", "/artists", "/artist/hyukoh", "/artist/9m88", "/artist/cao-dong-mei-you-pai-dui", "/artist/hyukoh/1", "/share/9", "/search", "/guide", "/ranking", "/about", "/login", "/login?mode=register", "/nope"]
        bad = []
        for width, mobile, br in ((390, True, wk), (375, True, wk), (320, True, wk), (1440, False, ch)):
            c = ctx(br, width, mobile)
            p = page_of(c)
            for path in public:
                try:
                    go(p, path, settle=400)
                    ov = overflow(p)
                    if ov[0] > ov[1]:
                        bad.append(f"{width} {path} {ov[0]}>{ov[1]}")
                except Exception as e:  # noqa: BLE001
                    bad.append(f"{width} {path} 例外 {str(e)[:60]}")
            c.close()
        check("公開頁橫向溢出為 0（4 寬 × 14 頁）", not bad, "；".join(bad[:8]))
        wk.close()
        ch.close()

    # 排除環境雜訊：未登入打 /api/me 的 401、無頭瀏覽器連不上 Turnstile（challenges.cloudflare.com）、Turnstile 自己印的 console 標記
    bad_errors = [e for e in ERRORS if not re.search(r"status of (401|404|403|409|429)|challenges\.cloudflare\.com|font-size:0;color:transparent", e)]
    check("console error 為 0", not bad_errors, "；".join(bad_errors[:5]))
    (HERE / "result_修正_正式站.json").write_text(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], ensure_ascii=False, indent=1), encoding="utf-8")
    passed = sum(1 for _, o, _ in results if o)
    print(f"\n{passed}/{len(results)} 通過")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
