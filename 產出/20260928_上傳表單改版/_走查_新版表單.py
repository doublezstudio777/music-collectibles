# 新版炫收藏表單走查＋驗收（2026-09-28 上傳表單改版），改寫自 ../20260928_上傳表單UX/_走查_現行表單.py
# 用法：python3 _走查_新版表單.py <網址，例 http://127.0.0.1:8791> <照片資料夾（cd.jpg、towel.jpg、extra.jpg）>
# 只在本機資料庫發文；可重跑（新藝人、新演唱會名稱帶時間戳）
import json, re, subprocess, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
PH = Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
SITE = OUT.parent.parent / "網站"
HOST = B.split("//")[1].split(":")[0]
TT = "XXXX.DUMMY.TOKEN.XXXX"
STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){}};"
ST = str(int(time.time()))[-5:]
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js"]
LOCAL = ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]
res, log = [], []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:400]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:240], flush=True)


def note(tag, **kw):
    kw["step"] = tag
    log.append(kw)


def sql(cmd):
    r = subprocess.run(W + ["d1", "execute", "DB", *LOCAL, "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def login(email):
    j = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": TT, "client": "app"}, timeout=30).json()
    return j["token"]


sql("DELETE FROM rate_limits WHERE key LIKE 'submit:%' OR key LIKE 'share:%' OR key LIKE 'login:%' OR key LIKE 'edit-share:%' OR key LIKE 'rename-add:%'")
sql("DELETE FROM counters WHERE key LIKE 'quota:%'")
TOK = login("r01@demo.yinzang.test")
ADMIN = login("admin@demo.yinzang.test")


def ctx(br, w, h, mobile, tok=TOK):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
    if tok:
        c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")
    time.sleep(0.4)


def shot(p, name, full=True):
    p.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def errs(p):
    return p.locator(".sf .field-error").all_inner_texts()


def wait_upload(p):
    p.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled && !document.querySelector('.pp-tile [data-status=uploading], .pp-tile.is-uploading')", timeout=40000)
    time.sleep(0.8)


def pick_gordon(p, tag):
    p.fill("[data-testid=artist-search]", "國蛋")
    p.wait_for_selector("[data-testid=artist-opt][data-slug=gordon]", timeout=10000)
    time.sleep(0.3)
    shot(p, f"{tag}_03_打字搜尋國蛋", full=False)
    p.click("[data-testid=artist-opt][data-slug=gordon]")


def geom(p):
    return p.evaluate("""() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return Math.round(b.top + scrollY); };
      const sum = document.querySelector('[data-testid=sf-summary]').getBoundingClientRect();
      return { vh: innerHeight, docH: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
               searchY: r('[data-testid=artist-search]'), kindY: r('[data-testid=pick-kind]'), sumTop: Math.round(sum.top), sumBottom: Math.round(sum.bottom), sumPos: getComputedStyle(document.querySelector('[data-testid=sf-summary]')).position }; }""")


def cd_flow(br, w, h, mobile, tag):
    c = ctx(br, w, h, mobile)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + "/share/new")
    settle(p)
    shot(p, f"{tag}_01_進表單_第一屏", full=False)
    g = geom(p)
    note(f"{tag} 進表單", **g)
    check(f"{tag} 搜尋框在第一屏內", g["searchY"] is not None and g["searchY"] < g["vh"], g)
    check(f"{tag} 發布列位置（手機黏底／桌機右欄）", (g["sumPos"] == "fixed" and g["sumBottom"] == g["vh"]) if mobile else g["sumPos"] == "sticky", g)
    check(f"{tag} 沒有性別地區篩選", p.locator("[data-testid=pick-gender], [data-testid=pick-region]").count() == 0)
    check(f"{tag} 沒有網址欄", "網址" not in p.inner_text("form") and "送出審核" not in p.inner_text("form"))
    # 空送出：錯誤＋還差什麼
    p.click("[data-testid=share-submit]")
    time.sleep(0.5)
    shot(p, f"{tag}_02_沒選就按發布_錯誤", full=False)
    e0 = errs(p)
    check(f"{tag} 空送出出現三個錯誤", len(e0) == 3, e0)
    check(f"{tag} 發布列寫還差 3 題", "還差 3 題" in p.inner_text("[data-testid=sf-missing]"), p.inner_text("[data-testid=sf-missing]"))
    p.set_input_files("[data-testid=pp-input]", str(PH / "cd.jpg"))
    wait_upload(p)
    check(f"{tag} 放照片後照片錯誤立刻消失", p.locator("[data-testid=err-photo]").count() == 0, errs(p))
    pick_gordon(p, tag)
    time.sleep(0.2)
    check(f"{tag} 選了藝人「至少要選」立刻消失（沒再按發布）", p.locator("[data-testid=err-about]").count() == 0, errs(p))
    check(f"{tag} 藝人收成黑框", p.locator("[data-testid=bar-about]").count() == 1)
    p.click("[data-testid=pick-kind] button:text-is('CD')")
    time.sleep(0.2)
    check(f"{tag} 選了 CD 錯誤立刻消失", p.locator(".sf .field-error").count() == 0, errs(p))
    p.locator("[data-testid=where]").scroll_into_view_if_needed()
    shot(p, f"{tag}_04_選了國蛋CD_挑專輯", full=False)
    rows = p.locator("[data-testid=where-record] [data-testid=where-opt]").count()
    check(f"{tag} 專輯清單先列 6 張＋還有 N 張", rows == 6 and p.locator("[data-testid=where-more]").count() == 1, rows)
    p.fill("[data-testid=where-search]", "Vol.3")
    time.sleep(0.3)
    p.click("[data-testid=where-opt][data-key='gordon/5']")
    time.sleep(0.3)
    check(f"{tag} 專輯收成黑框", "Dr. Paper Vol.3" in p.inner_text("[data-testid=bar-where]"))
    has_ver = p.locator("[data-testid=bar-version]").count() == 1
    note(f"{tag} 版本題", shown=has_ver, text=p.inner_text("[data-testid=bar-version]") if has_ver else "")
    p.fill("#share-form-story", "2016 年簽名會現場買的")
    p.fill("#share-form-tags", "簽名")
    auto = p.inner_text("[data-testid=sf-title]")
    check(f"{tag} 即時標題", auto.startswith("Dr. Paper Vol.3 Sunday Night Slow Jams") and "CD" in auto, auto)
    # 改標題再還原
    p.click("[data-testid=bar-title-change]")
    p.fill("[data-testid=title-input]", "我的國蛋簽名 CD")
    check(f"{tag} 自訂標題即時反映", p.inner_text("[data-testid=sf-title]") == "我的國蛋簽名 CD")
    p.click("[data-testid=title-reset]")
    check(f"{tag} 還原成自動標題", p.inner_text("[data-testid=sf-title]") == auto)
    shot(p, f"{tag}_05_發布前整頁")
    check(f"{tag} 發布列寫可以發布了", "可以發布了" in p.inner_text("[data-testid=sf-missing]"))
    g = geom(p)
    check(f"{tag} 表單沒有橫向溢出", g["sw"] <= g["cw"], g)
    note(f"{tag} 發布前", **g)
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    settle(p)
    n = int(p.url.rstrip("/").split("/")[-1])
    shot(p, f"{tag}_06_發布後單則頁_發文者", full=False)
    shot(p, f"{tag}_07_發布後單則頁_整頁")
    check(f"{tag} 發布後標題", p.inner_text("h1.page-title") == auto, p.inner_text("h1.page-title"))
    check(f"{tag} 操作盒：純分享＋一顆編輯＋我想賣", p.inner_text("[data-testid=owner-status]") == "純分享" and p.locator("[data-testid=share-edit-open]").count() == 1 and p.locator("[data-testid=owner-want-sell]").count() == 1)
    check(f"{tag} 沒有編輯照片鈕", p.locator("[data-testid=photo-edit-open]").count() == 0 and "編輯照片" not in p.inner_text("main"))
    ob = p.locator("[data-testid=owner-box]").bounding_box()
    ph = p.locator(".detail-photo").bounding_box()
    t1 = p.locator("h1.page-title").bounding_box()
    pos_ok = (ob["y"] > ph["y"] + ph["height"] - 1 and ob["y"] < t1["y"]) if mobile else (ob["x"] > ph["x"] + ph["width"] and ob["y"] < t1["y"])
    check(f"{tag} 操作盒位置（手機照片下方、桌機右欄上方）", pos_ok, {"box": ob, "photo": ph, "title": t1})
    check(f"{tag} console error 0", not cerr, cerr[:3])
    c.close()
    return n


def towel_flow(br, w, h, mobile, tag):
    c = ctx(br, w, h, mobile)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + "/share/new")
    settle(p)
    shot(p, f"{tag}_01_進表單_第一屏", full=False)
    p.set_input_files("[data-testid=pp-input]", str(PH / "towel.jpg"))
    wait_upload(p)
    pick_gordon(p, tag)
    p.click("[data-testid=pick-kind] button:text-is('毛巾')")
    time.sleep(0.3)
    q = p.inner_text("[data-testid=where] .field-label")
    check(f"{tag} 周邊題目帶品項名", q == "這條毛巾是哪裡出的？", q)
    check(f"{tag} 三組都在（演唱會、專輯的周邊、藝人自己出的）", all(p.locator(f"[data-testid={t}]").count() == 1 for t in ["where-tour", "where-album", "where-brand"]))
    check(f"{tag} 藝人自己出的有周邊與其他", "周邊與其他" in p.inner_text("[data-testid=where-brand]"))
    name = f"GDNA 巡迴{ST}{tag[-3:]}"
    p.fill("[data-testid=where-search]", name)
    time.sleep(0.3)
    p.locator("[data-testid=where]").scroll_into_view_if_needed()
    shot(p, f"{tag}_04_選了毛巾_哪裡出的", full=False)
    p.click("[data-testid=where-new-tour]")
    p.fill("[data-testid=new-box-year]", "2024")
    shot(p, f"{tag}_05_新增演唱會", full=False)
    p.click("[data-testid=new-box-save]")
    p.wait_for_selector("[data-testid=bar-where] .sf-new", timeout=10000)
    t = p.inner_text("[data-testid=sf-title]")
    check(f"{tag} 新增演唱會立刻選好、標題立刻用上", t.startswith(name) and "毛巾" in t, t)
    # 打錯字：改名
    p.click("[data-testid=bar-where-change]")
    fixed = f"GDNA 巡迴演唱會 台北場{ST}{tag[-3:]}"
    p.fill("[data-testid=rename-series-name]", fixed)
    shot(p, f"{tag}_06_改名", full=False)
    p.click("[data-testid=rename-series-save]")
    p.wait_for_selector("[data-testid=rename-series]", state="detached", timeout=10000)
    t = p.inner_text("[data-testid=sf-title]")
    check(f"{tag} 改名後標題跟著換", t.startswith(fixed), t)
    shot(p, f"{tag}_07_發布前整頁")
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    settle(p)
    n = int(p.url.rstrip("/").split("/")[-1])
    shot(p, f"{tag}_08_發布後單則頁_發文者", full=False)
    h1 = p.inner_text("h1.page-title")
    check(f"{tag} 發出去就是改好的名字、立即可用（不用等審核）", h1.startswith(fixed) and "毛巾" in h1, h1)
    link = p.locator(".detail-link a").first.get_attribute("href") if p.locator(".detail-link a").count() else ""
    check(f"{tag} 單則頁連到新演唱會系列頁", link.startswith("/artist/gordon/"), link)
    r = requests.get(B + link.split("#")[0], timeout=30)
    check(f"{tag} 新系列頁公開可看", r.status_code == 200 and fixed in r.text, r.status_code)
    check(f"{tag} console error 0", not cerr, cerr[:3])
    c.close()
    return n


def new_artist_flow(br):
    tag = "C1440_新藝人"
    c = ctx(br, 1440, 900, False)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(B + "/share/new")
    settle(p)
    p.set_input_files("[data-testid=pp-input]", str(PH / "extra.jpg"))
    wait_upload(p)
    typo = f"測式樂團{ST}"
    p.fill("[data-testid=artist-search]", typo)
    p.wait_for_selector("[data-testid=artist-new]", timeout=10000)
    shot(p, f"{tag}_01_搜不到_新增", full=False)
    p.click("[data-testid=artist-new]")
    p.wait_for_selector("[data-testid=bar-about] .sf-new", timeout=10000)
    check(f"{tag} 新增藝人立刻選好（標新增、按鈕是改名）", p.inner_text("[data-testid=bar-about-change]") == "改名")
    p.click("[data-testid=bar-about-change]")
    good = f"測試樂團{ST}"
    p.fill("[data-testid=rename-artist-name]", good)
    p.click("[data-testid=rename-artist-save]")
    p.wait_for_selector("[data-testid=rename-artist]", state="detached", timeout=10000)
    check(f"{tag} 藝人打錯字能改", good in p.inner_text("[data-testid=bar-about]"))
    p.click("[data-testid=pick-kind] button:text-is('CD')")
    p.fill("[data-testid=where-search]", "第一張")
    p.click("[data-testid=where-new-album]")
    p.check("[data-testid=new-box-noyear]")
    shot(p, f"{tag}_02_新增專輯_不記得年份", full=False)
    p.click("[data-testid=new-box-save]")
    p.wait_for_selector("[data-testid=bar-where] .sf-new", timeout=10000)
    check(f"{tag} 新增專輯年份不記得", "年份不記得" in p.inner_text("[data-testid=bar-where]"), p.inner_text("[data-testid=bar-where]"))
    p.click("[data-testid=share-submit]")
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    settle(p)
    n = int(p.url.rstrip("/").split("/")[-1])
    shot(p, f"{tag}_03_發布後", full=False)
    check(f"{tag} 新藝人新專輯直接發文", p.inner_text("h1.page-title").startswith("第一張") and good in p.inner_text(".detail-info"), p.inner_text("h1.page-title"))
    slug = sql(f"SELECT slug, status FROM artists WHERE name = '{good}'")
    check(f"{tag} 識別碼自動產生、狀態 approved", slug and slug[0]["status"] == "approved" and slug[0]["slug"].startswith("a-"), slug)
    edits = sql(f"SELECT e.from_name, e.to_name FROM catalog_addition_edits e JOIN catalog_additions a ON a.id = e.addition_id WHERE a.type='artist' AND a.ref = '{slug[0]['slug']}'")
    check(f"{tag} 改名留紀錄", edits and edits[0]["from_name"] == typo and edits[0]["to_name"] == good, edits)
    check(f"{tag} console error 0", not cerr, cerr[:3])
    c.close()
    return n, slug[0]["slug"]


def edit_flow(br, n, w, h, mobile, tag):
    c = ctx(br, w, h, mobile)
    p = c.new_page()
    cerr = []
    p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
    p.goto(f"{B}/share/{n}")
    settle(p)
    p.click("[data-testid=share-edit-open]")
    p.wait_for_selector("[data-testid=share-edit-form]", timeout=15000)
    settle(p)
    shot(p, f"{tag}_01_編輯頁", full=True)
    check(f"{tag} 編輯頁照片在裡面、題目全部收成黑框", p.locator("[data-testid=share-edit-form] [data-testid=pp-tile]").count() == 1 and p.locator("[data-testid=bar-about]").count() == 1 and p.locator("[data-testid=bar-where]").count() == 1)
    # 改照片：加一張
    p.set_input_files("[data-testid=pp-input]", str(PH / "extra.jpg"))
    wait_upload(p)
    # 改藝人：國蛋 → 山線電台（搜尋）
    p.click("[data-testid=bar-about-change]")
    p.locator(".chip button").first.click()
    p.fill("[data-testid=artist-search]", "山線電台")
    p.wait_for_selector("[data-testid=artist-opt][data-slug=mountain-radio]", timeout=10000)
    p.click("[data-testid=artist-opt][data-slug=mountain-radio]")
    # 改專輯：藝人換了，國蛋的專輯對不上會清掉，清單列山線電台的專輯，挑最新一張
    check(f"{tag} 換藝人後原專輯清掉、改列新藝人的專輯", p.locator("[data-testid=bar-where]").count() == 0 and p.locator("[data-testid=where-record] [data-testid=where-opt]").count() > 0)
    p.locator("[data-testid=where-record] [data-testid=where-opt]").first.click()
    album = p.inner_text("[data-testid=bar-where] b")
    # 改價格：定價出售 1200
    p.click("[data-testid=share-edit-form] .seg button:text-is('定價出售')")
    p.fill("#share-form-price", "1200")
    shot(p, f"{tag}_02_編輯後_儲存前", full=True)
    p.click("[data-testid=share-submit]")
    p.wait_for_url(f"**/share/{n}", timeout=20000)
    settle(p)
    shot(p, f"{tag}_03_儲存後單則頁", full=False)
    j = requests.get(f"{B}/api/shares?page=1", timeout=30).json()["shares"]
    s = next((x for x in j if x["n"] == n), None)
    check(f"{tag} 改藝人", s and s["about"] == ["山線電台"], s and s["about"])
    check(f"{tag} 改專輯", s and s["what"].startswith(album) and "Dr. Paper" not in s["what"], (s and s["what"], album))
    check(f"{tag} 改價格", s and s["sale"] == {"state": "sale", "price": 1200}, s and s["sale"])
    photos = requests.get(f"{B}/api/shares/{n}/photos", headers={"Authorization": f"Bearer {TOK}"}, timeout=30).json()["photos"]
    check(f"{tag} 改照片（多一張）", len(photos) == 2, len(photos))
    st = p.inner_text("[data-testid=owner-status]")
    check(f"{tag} 操作盒：定價出售＋改價格就地展開", st.startswith("定價出售 NT$") and p.locator("[data-testid=owner-price]").inner_text() == "改價格", st)
    check(f"{tag} console error 0", not cerr, cerr[:3])
    c.close()


def hires(br, n):
    # 登入者：單則頁打開就是 1600 大圖；訪客：縮圖
    out = {}
    for who, tok in [("登入者", TOK), ("訪客", None)]:
        c = ctx(br, 1440, 900, False, tok)
        p = c.new_page()
        got = []
        p.on("response", lambda r: "/img/p/" in r.url and got.append((r.url.split("/img/p/")[1], r.status)))
        p.goto(f"{B}/share/{n}")
        settle(p)
        time.sleep(1)
        imgs = p.evaluate("() => [...document.querySelectorAll('.detail-photo img')].map(i => ({src: i.getAttribute('src'), hires: i.dataset.hires || '', w: i.naturalWidth}))")
        out[who] = {"imgs": imgs, "got": got}
        shot(p, f"D_{who}_單則頁", full=False)
        c.close()
    li = out["登入者"]["imgs"]
    check("登入者單則頁載入高清圖（長邊 1600）", any(i["hires"] == "1" and i["w"] >= 1000 for i in li), li)
    vi = out["訪客"]["imgs"]
    check("訪客單則頁只有縮圖", vi and all(not i["hires"] and i["w"] <= 480 for i in vi), vi)
    anon = requests.get(f"{B}/share/{n}", timeout=30).text
    srcs = re.findall(r'<img[^>]+src="([^"]+)"', anon)
    main = sql(f"SELECT r2_key, thumb_key FROM photos WHERE share_no = {n} ORDER BY sort LIMIT 1")[0]
    check("訪客 HTML 的 <img> 只有縮圖網址", main["thumb_key"] in " ".join(srcs) and main["r2_key"] not in " ".join(srcs), srcs[:4])
    # 快取命中：首頁、單則頁（訪客與登入者都拿同一份）
    for path in ["/", f"/share/{n}"]:
        hs = []
        for i, tok in enumerate([None, None, TOK]):
            r = requests.get(B + path, cookies={"yz_session": tok} if tok else None, timeout=30)
            hs.append(r.headers.get("x-yz-cache"))
        check(f"整頁快取仍命中 {path}", hs[1] == "HIT" and hs[2] == "HIT", hs)
    # 首頁、藝人頁、系列頁仍是 480 小圖
    c = ctx(br, 1440, 900, False)
    p = c.new_page()
    for path in ["/", "/artist/gordon", "/artist/gordon/5"]:
        p.goto(B + path)
        settle(p)
        big = p.evaluate("() => [...document.querySelectorAll('.card img, .wall img')].filter(i => i.dataset.hires || i.naturalWidth > 480).length")
        check(f"收藏牆維持小圖 {path}", big == 0, big)
    c.close()


def admin_additions(br, slug):
    c = ctx(br, 1440, 900, False, ADMIN)
    p = c.new_page()
    p.goto(B + "/admin/additions")
    settle(p)
    shot(p, "E_後台_待確認的新增", full=False)
    row = p.locator(f"[data-testid=add-item][data-type=artist][data-ref='{slug}']")
    check("後台列出新藝人、看得到改名紀錄", row.count() == 1 and "測式樂團" in row.inner_text(), row.count())
    row.locator("[data-testid=add-confirm]").click()
    p.wait_for_selector(f"[data-testid=add-done] [data-ref='{slug}']", timeout=10000)
    check("管理員按「沒問題」移到已確認", True)
    c.close()


def widths(br, paths):
    for w, mobile in [(320, True), (390, True), (1440, False)]:
        c = ctx(br, w, 800, mobile, ADMIN if any("admin" in x for x in paths) else TOK)
        for path in paths:
            p = c.new_page()
            cerr = []
            p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
            p.goto(B + path)
            settle(p)
            time.sleep(0.6)
            o = p.evaluate("""() => { const cw = document.documentElement.clientWidth; const bad = [...document.querySelectorAll('main *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > cw + 1 || r.left < -1) && !e.closest('.tiles, .gallery-track, .tbl-wrap, .sr-only, .vt-scroll'); }).slice(0,3).map(e => e.className || e.tagName);
              return { sw: document.documentElement.scrollWidth, cw, bad }; }""")
            check(f"{w} {path} 無溢出、console 0", o["sw"] <= o["cw"] and not o["bad"] and not cerr, {**o, "cerr": cerr[:2]})
            p.close()
        c.close()


with sync_playwright() as pw:
    br = pw.chromium.launch()
    n1 = cd_flow(br, 1440, 900, False, "A1440_CD")
    towel_flow(br, 1440, 900, False, "A1440_毛巾")
    cd_flow(br, 390, 844, True, "B390_CD")
    n4 = towel_flow(br, 390, 844, True, "B390_毛巾")
    n5, slug = new_artist_flow(br)
    edit_flow(br, n1, 1440, 900, False, "F1440_編輯")
    hires(br, n1)
    admin_additions(br, slug)
    widths(br, ["/share/new", f"/share/{n1}", f"/share/{n1}/edit", f"/share/{n4}"])
    widths(br, ["/admin/additions"])
    br.close()

ok = sum(r["ok"] for r in res)
print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"results": res, "steps": log}, ensure_ascii=False, indent=1), encoding="utf-8")
