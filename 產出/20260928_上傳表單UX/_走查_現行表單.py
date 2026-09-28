# 現行炫收藏表單走查（2026-09-28，UX 顧問，唯讀）
# 用法：python3 _走查_現行表單.py <網址，例 http://127.0.0.1:8795> <照片資料夾（cd.jpg、towel.jpg）>
# 只在本機隔離的資料庫副本上發文；不碰正式站、不碰施工中那台本機伺服器的資料
import json, re, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
PH = Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
HOST = B.split("//")[1].split(":")[0]
TT = "XXXX.DUMMY.TOKEN.XXXX"
STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){}};"
log = []


def note(tag, **kw):
    kw["step"] = tag
    log.append(kw)
    print(json.dumps(kw, ensure_ascii=False)[:400], flush=True)


tok = requests.post(B + "/api/auth/login", json={"email": "r01@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": TT, "client": "app"}, timeout=30).json()["token"]


def ctx(br, w, h, mobile):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
    c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")
    time.sleep(0.4)


def shot(p, name, full=True):
    p.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def geom(p):
    return p.evaluate("""() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(b.top + scrollY); };
      const errs = [...document.querySelectorAll('.field-error')].map(e => e.innerText);
      const labels = [...document.querySelectorAll('form .field-label, form .where-title')].map(e => e.innerText.replace(/\\s+/g,' '));
      return { vh: innerHeight, docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth,
               addArtistBtnY: (()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.includes('找不到藝人'));return b?Math.round(b.getBoundingClientRect().top+scrollY):null})(),
               searchInputY: r('#share-form-about'), searchHintY: r('[data-testid=about-search-hint]'),
               kindY: r('[data-testid=pick-kind]'), submitY: r('[data-testid=share-submit]'),
               artistButtons: [...document.querySelectorAll('[data-testid=pick-artist] button')].map(b => b.innerText),
               errors: errs, labels };
    }""")


def run(br, w, h, mobile, tag, kind, photo):
    c = ctx(br, w, h, mobile)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + "/share/new")
    settle(p)
    shot(p, f"{tag}_01_進表單_第一屏", full=False)
    shot(p, f"{tag}_02_進表單_整頁")
    note(f"{tag} 進表單", **geom(p))

    # 使用者第一個看到的「新增」
    p.locator("button", has_text="找不到藝人，我要新增").click()
    time.sleep(0.4)
    p.locator("[data-testid=submit-artist]").scroll_into_view_if_needed()
    shot(p, f"{tag}_03_點了新增藝人_要填網址", full=False)
    note(f"{tag} 新增藝人欄位", fields=p.locator("[data-testid=submit-artist] .submit-field span").all_inner_texts(),
         button=p.locator("[data-testid=submit-artist] .btn").first.inner_text())
    p.locator("[data-testid=submit-artist] .btn-text").click()

    # 先放照片、直接按發布，看錯誤怎麼呈現
    p.set_input_files("[data-testid=pp-input]", str(PH / photo))
    p.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    p.click("[data-testid=share-submit]")
    time.sleep(0.5)
    shot(p, f"{tag}_04_沒選就按發布_錯誤", full=True)
    note(f"{tag} 空送出", **geom(p))

    # 用打字搜尋找國蛋
    p.fill("#share-form-about", "國蛋")
    p.locator(".suggest button", has_text="國蛋").first.wait_for(timeout=15000)
    p.locator("#share-form-about").scroll_into_view_if_needed()
    shot(p, f"{tag}_05_打字搜尋國蛋", full=False)
    p.locator(".suggest button", has_text="國蛋").first.click()
    time.sleep(0.4)
    shot(p, f"{tag}_06_選了國蛋之後", full=False)
    note(f"{tag} 選了國蛋", chips=p.locator(".chip-row .chip").all_inner_texts(), **geom(p))

    p.locator("[data-testid=pick-kind] button", has_text=kind).click()
    time.sleep(0.4)
    p.locator("[data-testid=where]").scroll_into_view_if_needed()
    shot(p, f"{tag}_07_選了{kind}_屬於哪裡", full=False)
    note(f"{tag} 屬於哪裡", where=p.locator("[data-testid=where]").inner_text()[:600], **geom(p))

    if kind == "CD":
        # 打錯字新增一個系列
        p.click("[data-testid=new-series-record]")
        p.fill("[data-testid=new-series-record-title]", "Dr. Papr Vol.3")
        p.fill("[data-testid=new-series-record-year]", "2016")
        shot(p, f"{tag}_08_新增系列_打錯字", full=False)
        p.click("[data-testid=new-series-record-send]")
        time.sleep(1)
        shot(p, f"{tag}_09_送出審核後", full=False)
        note(f"{tag} 送出錯字系列", pending=p.locator("[data-testid=pending-series-note]").all_inner_texts(),
             editable=p.locator("[data-testid=where] input").count())
        # 發現站內其實有，改點真的那張
        p.locator("[data-testid=where] button", has_text="Dr. Paper Vol.3").click()
        time.sleep(0.5)
        shot(p, f"{tag}_10_改點站內那張", full=False)
        note(f"{tag} 改點既有系列", pending=p.locator("[data-testid=pending-series-note]").all_inner_texts(),
             fields=p.locator("form .field-label").all_inner_texts())
    else:
        p.click("[data-testid=new-tour]")
        p.fill("[data-testid=new-tour-title]", "2024 國蛋 GDNA 巡迴台北場")
        p.fill("[data-testid=new-tour-year]", "2024")
        p.locator("[data-testid=new-tour-form]").scroll_into_view_if_needed()
        shot(p, f"{tag}_08_新增演唱會", full=False)
        p.click("[data-testid=new-tour-send]")
        time.sleep(1)
        shot(p, f"{tag}_09_送出審核後", full=False)
        note(f"{tag} 送出新演唱會", pending=p.locator("[data-testid=pending-series-note]").all_inner_texts(),
             pressed=p.locator("[data-testid=where] button[aria-pressed=true]").all_inner_texts())

    p.fill("#share-form-story", "測試走查：" + kind)
    shot(p, f"{tag}_11_發布前整頁")
    note(f"{tag} 發布前", **geom(p))
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
    settle(p)
    shot(p, f"{tag}_12_發布後單則頁_發文者", full=False)
    shot(p, f"{tag}_13_發布後單則頁_整頁")
    n = int(p.url.rsplit("/", 1)[1])
    note(f"{tag} 發布", n=n, title=p.locator("h1").first.inner_text(),
         ownerButtons=[b.strip() for b in p.locator(".detail-info .btn, .seller-bar button").all_inner_texts()],
         sw=p.evaluate("document.documentElement.scrollWidth"))
    # 編輯頁
    p.goto(B + f"/share/{n}/edit")
    settle(p)
    shot(p, f"{tag}_14_編輯頁_整頁")
    note(f"{tag} 編輯頁", labels=p.locator("form .field-label").all_inner_texts())
    note(f"{tag} console error", errors=cerr)
    c.close()
    return n


with sync_playwright() as pw:
    br = pw.chromium.launch()
    a = run(br, 1440, 900, False, "A1440_CD", "CD", "cd.jpg")
    b = run(br, 390, 844, True, "B390_毛巾", "毛巾", "towel.jpg")
    br.close()

(OUT / "走查紀錄.json").write_text(json.dumps(log, ensure_ascii=False, indent=1), encoding="utf-8")
print("done", a, b)
