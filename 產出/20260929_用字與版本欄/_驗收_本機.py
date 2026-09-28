# 用字與版本欄＋等級標籤驗收（2026-09-29）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <照片資料夾（cd.jpg）>
# 只在本機資料庫發文。前置：本機有「落日飛車／My jinji」系列（sunset-rollercoaster/1，CD 一般版 2016 台灣）
# 可重跑：新增的版本名稱帶時間戳，避免撞到上一輪的同名版本
import json, re, subprocess, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
PH = Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = Path(sys.argv[sys.argv.index("--img") + 1]) if "--img" in sys.argv else OUT / "img"
IMG.mkdir(exist_ok=True)
SITE = OUT.parent.parent / "網站"
HOST = B.split("//")[1].split(":")[0]
TT = "XXXX.DUMMY.TOKEN.XXXX"
STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){}};"
ST = str(int(time.time()))[-4:]
ED = f"日版{ST}"          # 新增的版本（重跑不撞名；報告截圖用第一輪的「日版」）
if "--plain" in sys.argv:
    ED = "日版"
ED2 = f"日本版{ST}" if ED != "日版" else "日本首批版"
SERIES = "sunset-rollercoaster/1"
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js"]
LOCAL = ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]
res = []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:500]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(W + ["d1", "execute", "DB", *LOCAL, "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def login(email):
    return requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": TT, "client": "app"}, timeout=30).json()["token"]


sql("DELETE FROM rate_limits WHERE key LIKE 'submit:%' OR key LIKE 'share:%' OR key LIKE 'login:%' OR key LIKE 'edit-share:%' OR key LIKE 'rename-add:%' OR key LIKE 'upload:%'")
sql("DELETE FROM counters WHERE key LIKE 'quota:%'")
TOK = login("r01@demo.yinzang.test")


def ctx(br, w, h=900, mobile=False, tok=TOK):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
    if tok:
        c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")
    time.sleep(0.4)


def shot(p, name, full=False):
    p.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def overflow(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")


def change_buttons(p):
    """所有「修改／改名」按鈕的實際點擊範圍"""
    return p.evaluate("""() => [...document.querySelectorAll('.sf-change')].map(b => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      return { text: b.innerText.trim(), h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10, border: cs.borderTopWidth + ' ' + cs.borderTopColor, bg: cs.backgroundColor }; })""")


# ---------- 1. 單字動詞 grep ----------
scan = subprocess.run(["python3", str(OUT / "_掃單字按鈕.py"), str(SITE)], capture_output=True, text=True).stdout.strip().splitlines()
check("1 單字動詞按鈕／連結 grep 結果為 0", scan[-1] == "TOTAL 0", scan[-5:])

with sync_playwright() as pw:
    br = pw.chromium.launch()

    # ---------- 2. 手機 390：選落日飛車 → My jinji → 新增版本「日版」→ 發布 ----------
    c = ctx(br, 390, 844, True)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + "/share/new")
    settle(p)
    p.set_input_files("[data-testid=pp-input]", str(PH / "cd.jpg"))
    p.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=40000)
    time.sleep(0.8)
    p.fill("[data-testid=artist-search]", "落日飛車")
    p.wait_for_selector("[data-testid=artist-opt][data-slug=sunset-rollercoaster]", timeout=10000)
    p.click("[data-testid=artist-opt][data-slug=sunset-rollercoaster]")
    p.click("[data-testid=pick-kind] button:text-is('CD')")
    p.click(f"[data-testid=where-opt][data-key='{SERIES}']")
    time.sleep(0.3)
    vf = p.locator("[data-testid=version-field]")
    check("2a 選好專輯後「哪個版本？」直接出現", vf.count() == 1 and vf.is_visible())
    check("2b 題目寫「哪個版本？ 選填」", re.sub(r"\s+", " ", p.inner_text("[data-testid=version-field] .field-label")) == "哪個版本？ 選填", p.inner_text("[data-testid=version-field] .field-label"))
    opts = p.locator("[data-testid=pick-version] [data-testid=version-opt]").all_inner_texts()
    check("2c 選項直接攤開，不用再點（既有版本用口語名稱）", p.locator("[data-testid=pick-version]").is_visible() and "2016 台灣 一般版 CD" in opts, opts)
    check("2d 有「不確定」與「新增版本」", p.locator("[data-testid=version-unsure]").is_visible() and p.locator("[data-testid=version-new]").inner_text().strip() == "新增版本")
    vf.scroll_into_view_if_needed()
    shot(p, "B390_01_選好專輯_版本題直接出現")
    p.click("[data-testid=version-new]")
    ph = p.get_attribute("[data-testid=new-version-name]", "placeholder")
    check("2e 新增版本輸入框附例子", ph == "例：日版、首批限定、再版、簽名版", ph)
    check("2f 年份、地區可以選填", p.locator("[data-testid=new-version-year]").count() == 1 and p.locator("[data-testid=new-version-region]").count() == 1)
    p.fill("[data-testid=new-version-name]", ED)
    p.locator("[data-testid=new-version]").scroll_into_view_if_needed()
    shot(p, "B390_02_新增版本_日版")
    p.click("[data-testid=new-version-save]")
    p.wait_for_selector("[data-testid=bar-version]", timeout=10000)
    bar = p.inner_text("[data-testid=bar-version]")
    check("2g 新增完立刻選好、標「新增」、按鈕是「改名」", f"{ED} CD" in bar and "新增" in bar and p.inner_text("[data-testid=bar-version-change]").strip() == "改名", bar)
    title = p.inner_text("[data-testid=sf-title]")
    check("2h 版本帶進自動標題（不重複 CD）", title == f"My jinji・{ED} CD", title)
    rows = sql(f"SELECT v.id, v.version_id, v.edition, v.status, i.item_id FROM versions v JOIN items i ON i.id = v.item_ref JOIN series s ON s.id = i.series_id WHERE s.artist_slug = 'sunset-rollercoaster' AND s.no = 1 AND v.edition = '{ED}'")
    check("2i 版本立即生效（approved）", len(rows) == 1 and rows[0]["status"] == "approved", rows)
    vid = rows[0]["version_id"] if rows else ""
    add = sql(f"SELECT id FROM catalog_additions WHERE type = 'version' AND ref = '{rows[0]['id'] if rows else 0}' AND confirmed_at IS NULL")
    check("2j 進後台「待確認的新增」（事後審）", len(add) == 1, add)
    btns = change_buttons(p)
    check("2k 390 寬「修改／改名」按鈕點擊範圍都 ≥44px 高、有框有底色", btns and all(b["h"] >= 44 for b in btns) and all(b["border"].startswith("1px") for b in btns), btns)
    check("2l 390 表單沒有橫向溢出", overflow(p)["sw"] <= overflow(p)["cw"], overflow(p))
    shot(p, "B390_03_選好日版_整頁", full=True)
    p.locator("[data-testid=bar-about]").scroll_into_view_if_needed()
    shot(p, "B390_04_值與修改按鈕")
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    settle(p)
    n = int(p.url.rstrip("/").split("/")[-1])
    h1 = p.inner_text("h1.page-title")
    check("2m 發布後單則頁標題有版本", h1 == f"My jinji・{ED} CD", h1)
    shot(p, "B390_05_發布後單則頁")
    check("2n 單則頁發文者旁有等級", p.locator(".detail-by [data-testid=lv-tag]").count() == 1, p.inner_text(".detail-by"))
    check("2o console error 0", not cerr, cerr[:3])
    c.close()

    # ---------- 3. 系列頁看得到版本 ----------
    c = ctx(br, 1440)
    p = c.new_page()
    p.goto(B + "/artist/" + SERIES)
    settle(p)
    body = p.inner_text("main")
    check("3a 系列頁看得到新版本", ED in body, ED)
    anchor = p.locator(f"[id='cd-{vid}']")
    if anchor.count():
        anchor.first.scroll_into_view_if_needed()
    shot(p, "A1440_06_系列頁_新版本")
    c.close()

    # ---------- 4. 再次編輯：改版本名稱 → 單則頁、系列頁跟著換 ----------
    c = ctx(br, 390, 844, True)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + f"/share/{n}/edit")
    settle(p)
    p.wait_for_selector("[data-testid=bar-version]", timeout=15000)
    check("4a 編輯頁版本題顯示目前版本", f"{ED} CD" in p.inner_text("[data-testid=bar-version]"), p.inner_text("[data-testid=bar-version]"))
    p.click("[data-testid=bar-version-change]")
    # 改成這張已經有的版本名稱：擋下來，請直接選那個
    p.fill("[data-testid=rename-version-name]", "一般版")
    p.click("[data-testid=rename-version-save]")
    p.wait_for_selector("[data-testid=rename-version] .field-error", timeout=10000)
    check("4a2 改名撞到既有版本名稱會擋下", "已經有「一般版」" in p.inner_text("[data-testid=rename-version] .field-error"), p.inner_text("[data-testid=rename-version] .field-error"))
    p.fill("[data-testid=rename-version-name]", ED2)
    p.locator("[data-testid=rename-version]").scroll_into_view_if_needed()
    shot(p, "B390_07_編輯_改版本名稱")
    check("4b 改名框按鈕寫「儲存」", p.inner_text("[data-testid=rename-version-save]").strip() == "儲存")
    p.click("[data-testid=rename-version-save]")
    p.wait_for_selector("[data-testid=rename-version]", state="detached", timeout=10000)
    check("4c 改名後表單標題立刻換", p.inner_text("[data-testid=sf-title]") == f"My jinji・{ED2} CD", p.inner_text("[data-testid=sf-title]"))
    check("4d 發布列按鈕寫「儲存」", p.inner_text("[data-testid=share-submit]").strip() == "儲存")
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(rf"/share/{n}$"), timeout=20000)
    settle(p)
    h1 = p.inner_text("h1.page-title")
    check("4e 單則頁標題換成新名稱", h1 == f"My jinji・{ED2} CD", h1)
    shot(p, "B390_08_改名後單則頁")
    edits = sql(f"SELECT e.from_name, e.to_name FROM catalog_addition_edits e JOIN catalog_additions a ON a.id = e.addition_id WHERE a.type = 'version' AND a.ref = '{rows[0]['id']}'")
    check("4f 改名留紀錄", edits == [{"from_name": ED, "to_name": ED2}], edits)
    # 改成既有的版本（非自己新增的）：「換成別的」→ 選 2016 台灣 一般版 CD → 儲存
    p.goto(B + f"/share/{n}/edit")
    settle(p)
    p.wait_for_selector("[data-testid=bar-version]", timeout=15000)
    p.click("[data-testid=bar-version-change]")
    p.click("[data-testid=rename-version-cancel]")
    p.click("[data-testid=version-opt]:has-text('2016 台灣 一般版 CD')")
    check("4g 編輯時可以改成別的版本，標題跟著換", p.inner_text("[data-testid=sf-title]") == "My jinji・一般版 CD", p.inner_text("[data-testid=sf-title]"))
    check("4h 既有版本的按鈕是「修改」", p.inner_text("[data-testid=bar-version-change]").strip() == "修改")
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(rf"/share/{n}$"), timeout=20000)
    settle(p)
    check("4i 儲存後單則頁標題", p.inner_text("h1.page-title") == "My jinji・一般版 CD", p.inner_text("h1.page-title"))
    # 改回自己新增的版本，留給系列頁檢查
    p.goto(B + f"/share/{n}/edit")
    settle(p)
    p.wait_for_selector("[data-testid=bar-version]", timeout=15000)
    p.click("[data-testid=bar-version-change]")
    p.click(f"[data-testid=version-opt]:has-text('{ED2}')")
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(rf"/share/{n}$"), timeout=20000)
    settle(p)
    check("4j 改回新增的版本", p.inner_text("h1.page-title") == f"My jinji・{ED2} CD", p.inner_text("h1.page-title"))
    # 4a2 故意撞名，瀏覽器會記一筆 409 資源錯誤，那是預期的；其他錯誤一律算失敗
    check("4k console error 0（4a2 故意撞名的 409 除外）", not [e for e in cerr if "409" not in e], cerr[:3])
    c.close()
    c = ctx(br, 1440, tok=None)
    p = c.new_page()
    p.goto(B + "/artist/" + SERIES)
    settle(p)
    body = p.inner_text("main")
    check("4l 系列頁（訪客）版本名稱已換", ED2 in body and not re.search(rf"{re.escape(ED)}(?!\d)", body.replace(ED2, "")), ED2)
    shot(p, "A1440_09_改名後系列頁")
    c.close()

    # ---------- 5. 320／390／1440 無溢出（新表單、編輯頁） ----------
    for w, mobile in [(320, True), (390, True), (1440, False)]:
        c = ctx(br, w, 900, mobile)
        p = c.new_page()
        for path in ["/share/new", f"/share/{n}/edit"]:
            p.goto(B + path)
            settle(p)
            if path == "/share/new":
                p.fill("[data-testid=artist-search]", "落日飛車")
                p.wait_for_selector("[data-testid=artist-opt][data-slug=sunset-rollercoaster]", timeout=10000)
                p.click("[data-testid=artist-opt][data-slug=sunset-rollercoaster]")
                p.click("[data-testid=pick-kind] button:text-is('CD')")
                p.click(f"[data-testid=where-opt][data-key='{SERIES}']")
                p.click("[data-testid=version-new]")
                time.sleep(0.3)
            else:
                p.wait_for_selector("[data-testid=bar-version]", timeout=15000)
            o = overflow(p)
            btns = change_buttons(p)
            check(f"5 {w} {path} 無橫向溢出", o["sw"] <= o["cw"], o)
            check(f"5 {w} {path} 修改按鈕 ≥44px 高", btns and all(b["h"] >= 44 for b in btns), btns)
            if w == 320 and path == "/share/new":
                p.locator("[data-testid=version-field]").scroll_into_view_if_needed()
                shot(p, "C320_10_新增版本框")
        c.close()

    # ---------- 6. 等級標籤：單則頁、卡片（390 只留稱號、1440 完整）、管理員「館長」、卡片三列對齊 ----------
    MEASURE = """() => { const cards = [...document.querySelectorAll('.wall .card')].slice(0, 24);
      const top = (e) => e ? Math.round(e.getBoundingClientRect().top * 10) / 10 : null;
      const rows = {};
      cards.forEach(c => { const k = Math.round(c.getBoundingClientRect().top); (rows[k] = rows[k] || []).push({
        title: c.querySelector('.card-title').innerText.trim(), t: top(c.querySelector('.card-title')),
        tags: (() => { const e = c.querySelector('.tags'); return e && getComputedStyle(e).display !== 'none' ? top(e) : null })(),
        foot: top(c.querySelector('.card-foot')), bottom: Math.round(c.getBoundingClientRect().bottom * 10) / 10,
        footBottom: Math.round(c.querySelector('.card-foot').getBoundingClientRect().bottom * 10) / 10 }); });
      return Object.values(rows).filter(r => r.length > 1); }"""
    BADGES = """() => [...document.querySelectorAll('.wall .card')].slice(0, 24).map(c => { const t = c.querySelector('[data-testid=lv-tag]'); const nm = c.querySelector('.who-name');
      const rr = (e) => { if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return b; };
      const card = c.getBoundingClientRect(); const tb = rr(t); const nb = rr(nm);
      return { who: c.querySelector('.who').getAttribute('href'), text: t ? t.innerText.trim() : null,
        clipped: t ? (t.scrollWidth > t.clientWidth + 0.5 || tb.right > card.right + 0.5) : null,
        nameClipped: nm ? (nm.scrollWidth > nm.clientWidth + 0.5 || nb.right > card.right + 0.5) : null }; })"""
    for w, mobile in [(390, True), (1440, False)]:
        c = ctx(br, w, 900, mobile, tok=None)
        p = c.new_page()
        for path in ["/", "/artist/gordon", "/tag/簽名", "/u/r01", "/u/yzadmin"]:
            p.goto(B + path)
            settle(p)
            rows6 = p.evaluate(MEASURE)
            bad = []
            for r in rows6:
                for k in ["t", "tags", "foot", "bottom"]:
                    vals = [x[k] for x in r if x[k] is not None]
                    if len(vals) > 1 and max(vals) - min(vals) > 1:
                        bad.append((k, vals))
                if max(x["bottom"] - x["footBottom"] for x in r) > 1:
                    bad.append(("foot 沒貼底", [x["bottom"] - x["footBottom"] for x in r]))
            check(f"6 {w} {path} 同列標題／標籤／發佈人列差距 ≤1px、發佈人列貼底（{len(rows6)} 列）", rows6 and not bad, bad[:4])
            bs = p.evaluate(BADGES)
            texts = [b["text"] for b in bs]
            check(f"6 {w} {path} 每張卡片都有等級標籤", bs and all(texts), texts[:6])
            if mobile:
                check(f"6 {w} {path} 窄卡片只顯示稱號（沒有 Lv 數字）", all("Lv" not in (t or "") for t in texts), sorted(set(texts)))
            else:
                check(f"6 {w} {path} 寬卡片顯示完整標籤（稱號＋Lv 或館長）", all(re.fullmatch(r"\S+ Lv\.\d|館長", t or "") for t in texts), sorted(set(texts)))
            check(f"6 {w} {path} 名字與等級都沒被截斷", all(b["clipped"] is False and b["nameClipped"] is False for b in bs), [b for b in bs if b["clipped"] or b["nameClipped"]][:3])
            if path == "/u/yzadmin":
                check(f"6 {w} 管理員的卡片固定顯示「館長」", all(t == "館長" for t in texts), sorted(set(texts)))
            if path in ("/", "/u/yzadmin"):
                p.evaluate("window.scrollTo(0, document.querySelector('.wall').getBoundingClientRect().top + scrollY - 80)")
                time.sleep(0.3)
                shot(p, f"{'B' if mobile else 'A'}{w}_11_卡片等級_{'首頁' if path == '/' else '管理員'}")
        # 單則頁：訪客也看得到（整頁快取的 HTML 就帶著），不另發請求
        reqs = []
        p.on("request", lambda r: reqs.append(r.url))
        p.goto(B + f"/share/{n}")
        settle(p)
        by = p.inner_text(".detail-by")
        check(f"6 {w} 單則頁發文者旁有等級（訪客）", p.locator(".detail-by [data-testid=lv-tag]").count() == 1, by)
        check(f"6 {w} 單則頁沒有為等級多發請求", not [u for u in reqs if "/api/" in u and ("badge" in u or "level" in u or "/api/users" in u)], [u for u in reqs if "/api/" in u])
        shot(p, f"{'B' if mobile else 'A'}{w}_12_單則頁等級")
        c.close()
    br.close()

# 整頁快取：訪客兩次打同一頁，第二次 HIT，而且 HTML 裡就有等級
h1 = requests.get(B + f"/share/{n}", headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
h2 = requests.get(B + f"/share/{n}", headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
check("7 單則頁訪客 HTML 快取命中、HTML 裡就帶等級標籤", h2.headers.get("x-yz-cache") == "HIT" and 'data-testid="lv-tag"' in h2.text, (h1.headers.get("x-yz-cache"), h2.headers.get("x-yz-cache")))
home = requests.get(B + "/", headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
# 首頁的牆在瀏覽器端畫（要等 /api/me 判斷追蹤），卡片資料在同一份快取 HTML 的內嵌資料裡
check("7 首頁快取的 HTML 內嵌資料就帶等級", '\\"badge\\":\\"' in home.text or '"badge":"' in home.text, home.headers.get("x-yz-cache"))

print(f"\n{sum(r['ok'] for r in res)}/{len(res)}  share #{n}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"share": n, "edition": [ED, ED2], "results": res}, ensure_ascii=False, indent=1), encoding="utf-8")
