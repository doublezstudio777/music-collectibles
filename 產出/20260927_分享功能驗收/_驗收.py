# 分享功能驗收：分享按鈕與小選單、原生分享（手機）、複製連結、各平台分享網址、連結預覽（FB 爬蟲 UA）、
# 隱藏與鎖定不洩漏、下載分享圖兩種尺寸（不經伺服器、不多讀 R2）、1440／390 版面、console error。
# 用法：dev server（npm run dev，輸出導到 LOG），python3 _驗收.py <LOG 路徑> [網址，預設 http://localhost:5173]
# 全程本機。可重跑：每次新建一個測試帳號與一則長標題收藏（測試資料＝正式資料，不清空）。
import io, json, re, subprocess, sys, time
from pathlib import Path
from urllib.parse import quote
import requests
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

LOG = Path(sys.argv[1])
B = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5173"
HERE = Path(__file__).parent
SITE = HERE.parent.parent / "網站"
IMG = HERE / "img"; IMG.mkdir(exist_ok=True)
STAMP = str(int(time.time()))[-6:]
PW, TT = "listen-2026", "XXXX.DUMMY.TOKEN.XXXX"
FB_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
R = {"checks": [], "links": {}, "og": {}, "images": {}, "stamp": STAMP}


def check(name, ok, detail=""):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": str(detail)[:500]})
    print(("PASS " if ok else "FAIL ") + name, str(detail)[:220])


def sql(cmd):
    out = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
                          "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
                         cwd=SITE, capture_output=True, text=True)
    return json.loads(out.stdout)[0]["results"]


def code_for(email):
    for _ in range(80):
        m = re.findall(rf"to={re.escape(email)} .*?\n.*?驗證碼：(\d{{6}})", LOG.read_text(errors="ignore"))
        if m:
            return m[-1]
        time.sleep(0.25)


def token(email, pw):
    return requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"}).json()["token"]


def register(tag, name):
    email = f"{tag}{STAMP}@example.com"
    r = requests.post(B + "/api/auth/register", json={"email": email, "password": PW, "handle": f"{tag}{STAMP}", "name": name,
                                                      "turnstileToken": TT}, headers={"cf-connecting-ip": f"10.9.{int(STAMP) % 250}.7"})
    assert r.status_code == 201, r.text
    return requests.post(B + "/api/auth/verify-email", json={"email": email, "code": code_for(email), "client": "app"}).json()["token"]


def striped(w=1600, h=1067):
    """有條紋與文字的測試照片，裁切位置看得出來"""
    im = Image.new("RGB", (w, h), (235, 235, 235)); d = ImageDraw.Draw(im)
    for i in range(0, w, 80):
        d.rectangle([i, 0, i + 39, h], fill=(40 + (i // 80) * 9 % 200, 90, 140))
    d.rectangle([w // 2 - 120, h // 2 - 120, w // 2 + 120, h // 2 + 120], fill=(255, 106, 0))
    b = io.BytesIO(); im.save(b, "WEBP", quality=80); return b.getvalue()


def og_of(html):
    tags = dict(re.findall(r'<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)"', html))
    return {k: v.replace("&amp;", "&") for k, v in tags.items()}


def settle(pg):
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pg.wait_for_load_state("load")
    pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(300)


# ======================= 0. 測試資料：一則長標題、長顯示名稱、有照片的收藏 =======================
LONG_NAME = "非常長的顯示名稱測試帳號二號機"
tok = register("sh", LONG_NAME)
H = {"authorization": f"Bearer {tok}"}
up = requests.post(B + "/api/uploads", headers=H, data={"purpose": "share"},
                   files={"image": ("a.webp", striped(), "image/webp"), "thumb": ("t.webp", striped(480, 320), "image/webp")}).json()
body = {"photoIds": [up["id"]], "about": ["山線電台", "潮汐公路", "空房間", "微光訊號", "雨停以前"], "kind": "其他周邊",
        "kindNote": "海港音樂祭限定三人全簽名紀念布製大型掛旗含原裝收納筒", "story": "", "sale": {"state": "share"}}
r = requests.post(B + "/api/shares", headers=H, json=body)
LONG_N = r.json().get("n") or r.json().get("share", {}).get("n")
check("0 建立長標題測試收藏", r.status_code == 201 and LONG_N, f"n={LONG_N}")
LOCKED_N = 8  # share:8 有 12 筆檢舉（門檻 10）
LOCKED_VER_N = 6  # 版本 faint-signal/1#cd-v1 被鎖
NOPHOTO_N = next(x["no"] for x in sql("select s.no from shares s where s.hidden_at is null and s.deleted_at is null and s.series_key='tide-highway/1' "
                                      "and not exists (select 1 from photos p where p.share_no=s.no and p.deleted_at is null) order by s.no limit 1"))
R["targets"] = {"photo": 1, "long": LONG_N, "nophoto": NOPHOTO_N, "locked": LOCKED_N, "locked_version": LOCKED_VER_N}

# ======================= 1. 連結預覽（FB 爬蟲 UA） =======================
PAGES = {"單則（有照片）": "/share/1", "單則（長標題）": f"/share/{LONG_N}", "單則（沒照片）": f"/share/{NOPHOTO_N}",
         "系列": "/artist/mountain-radio/1", "藝人": "/artist/mountain-radio", "系列（收藏全被鎖）": "/artist/faint-signal/1"}
NEED = ["og:title", "og:description", "og:url", "og:image", "og:image:width", "og:image:height", "og:type", "og:site_name", "twitter:card", "twitter:image"]
for label, path in PAGES.items():
    r = requests.get(B + path, headers={"user-agent": FB_UA})
    og = og_of(r.text); R["og"][label] = og
    miss = [k for k in NEED if not og.get(k)]
    img = requests.get(og.get("og:image", B + "/x"), headers={"user-agent": FB_UA})
    check(f"1 {label} og 標籤完整、圖片絕對網址且 200", r.status_code == 200 and not miss and og["og:image"].startswith("http")
          and img.status_code == 200 and img.headers.get("content-type", "").startswith("image/") and og["twitter:card"] == "summary_large_image",
          f"{path} miss={miss} image={og.get('og:image')} → {img.status_code} {img.headers.get('content-type')} {len(img.content)}B")
    if og.get("og:image:width"):
        im = Image.open(io.BytesIO(img.content))
        check(f"1 {label} og:image:width/height 與實際尺寸一致", im.size == (int(og["og:image:width"]), int(og["og:image:height"])),
              f"meta {og['og:image:width']}×{og['og:image:height']} 實際 {im.size}")
check("1 單則描述＝藝人・系列・品項・版本", R["og"]["單則（有照片）"]["og:description"] == "山線電台・夜行採集・CD・首批紙套版",
      R["og"]["單則（有照片）"]["og:description"])
check("1 系列頁收藏全被鎖 → 用站方預設圖", R["og"]["系列（收藏全被鎖）"]["og:image"].endswith("/og-default.png"), R["og"]["系列（收藏全被鎖）"]["og:image"])

# 鎖定：頁面可看，預覽不露原標題與照片
for n in (LOCKED_N, LOCKED_VER_N):
    what = sql(f"select what from shares where no={n}")[0]["what"]
    img = [x["r2_key"] for x in sql(f"select r2_key from photos where share_no={n} and deleted_at is null")]
    html = requests.get(B + f"/share/{n}", headers={"user-agent": FB_UA}).text
    head = html[: html.find("</head>")]
    og = og_of(html); R["og"][f"鎖定 share/{n}"] = og
    check(f"1 鎖定 share/{n}：head 不含原標題與照片，og 用通用字＋預設圖",
          what not in head and not any(k in head for k in img) and og["og:title"] == "一則炫收藏" and og["og:image"].endswith("/og-default.png"),
          f"what={what} og:title={og.get('og:title')} image={og.get('og:image')}")

# 隱藏：管理員隱藏 → 404、head 不含原標題；之後恢復
AD = {"authorization": f"Bearer {token('admin@demo.yinzang.test', 'yinzang-demo')}"}
what = sql(f"select what from shares where no={LONG_N}")[0]["what"]
requests.post(B + "/api/admin/hide", headers=AD, json={"type": "share", "key": str(LONG_N), "hidden": True})
r = requests.get(B + f"/share/{LONG_N}", headers={"user-agent": FB_UA})
check("1 隱藏的單則：404、不含原標題、無 og:image", r.status_code == 404 and what not in r.text and "og:image" not in r.text,
      f"{r.status_code} og={og_of(r.text)}")
requests.post(B + "/api/admin/hide", headers=AD, json={"type": "share", "key": str(LONG_N), "hidden": False})
HS = "harbor-fest/1"
sname = sql("select name from series where artist_slug='harbor-fest' and no=1")[0]["name"]
requests.post(B + "/api/admin/hide", headers=AD, json={"type": "series", "key": HS, "hidden": True})
r = requests.get(B + f"/artist/{HS}", headers={"user-agent": FB_UA})
check("1 隱藏的系列：404、不含系列名、無 og:image", r.status_code == 404 and sname not in r.text and "og:image" not in r.text, f"{r.status_code}")
requests.post(B + "/api/admin/hide", headers=AD, json={"type": "series", "key": HS, "hidden": False})
check("1 恢復後系列頁 200", requests.get(B + f"/artist/{HS}").status_code == 200)

# ======================= 2. 瀏覽器 =======================
errs = []
MOBILE_STUB = """
window.__shared = [];
navigator.share = async (d) => { window.__shared.push({title: d.title, text: d.text, url: d.url,
  files: (d.files || []).map(f => ({name: f.name, type: f.type, size: f.size}))}); };
navigator.canShare = (d) => true;
"""


def ctx(br, w, mobile=False, stub=False):
    kw = dict(viewport={"width": w, "height": 900 if w > 500 else 844}, accept_downloads=True)
    if mobile:
        kw.update(is_mobile=True, has_touch=True, device_scale_factor=2)
    cx = br.new_context(**kw)
    cx.grant_permissions(["clipboard-read", "clipboard-write"], origin=B)
    if stub:
        cx.add_init_script(MOBILE_STUB)
    elif mobile:
        cx.add_init_script("delete Navigator.prototype.share; delete Navigator.prototype.canShare;")
    pg = cx.new_page()
    pg.on("console", lambda m: errs.append((pg.url, m.text)) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append((pg.url, str(e))))
    return cx, pg


def overflow(pg):
    return pg.evaluate("document.documentElement.scrollWidth - innerWidth")


def in_view(pg, sel):
    b = pg.locator(sel).bounding_box()
    return b and b["x"] >= 0 and b["x"] + b["width"] <= pg.viewport_size["width"] + 0.5, b


def shot(pg, name, full=False):
    pg.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


with sync_playwright() as p:
    br = p.chromium.launch()
    for w in (1440, 390):
        cx, pg = ctx(br, w, mobile=(w == 390))
        for n in (1, LONG_N):
            pg.goto(B + f"/share/{n}"); settle(pg)
            check(f"2 {w} share/{n} 有分享與下載分享圖按鈕", pg.locator("[data-testid=share-btn]").count() == 1
                  and pg.locator("[data-testid=share-image-btn]").count() == 1)
            pg.click("[data-testid=share-btn]")
            menu = pg.locator("[data-testid=share-menu]")
            menu.wait_for()
            ok, box = in_view(pg, "[data-testid=share-menu]")
            hrefs = pg.eval_on_selector_all("[data-testid=share-menu] a", "as => as.map(a => [a.textContent.trim(), a.href])")
            url = f"{B}/share/{n}"
            title = sql(f"select what from shares where no={n}")[0]["what"]
            want = {"Facebook": f"https://www.facebook.com/sharer/sharer.php?u={quote(url, safe='')}",
                    "Threads": f"https://www.threads.net/intent/post?text={quote(title + ' ' + url, safe='')}",
                    "LINE": f"https://social-plugins.line.me/lineit/share?url={quote(url, safe='')}"}
            got = dict(hrefs)
            R["links"][f"{w} share/{n}"] = got
            check(f"2 {w} share/{n} 小選單在畫面內、三個平台網址正確", ok and all(got.get(k) == v for k, v in want.items()),
                  f"box={box} got={got}")
            pg.click("[data-testid=share-menu] button")
            pg.wait_for_timeout(200)
            clip = pg.evaluate("navigator.clipboard.readText()")
            check(f"2 {w} share/{n} 複製連結", clip == url and pg.locator("[data-testid=share-menu] button").inner_text() == "已複製連結", clip)
            shot(pg, f"{w}_share{n}_選單")
            pg.keyboard.press("Escape")
            check(f"2 {w} share/{n} Esc 收起選單", pg.locator("[data-testid=share-menu]").count() == 0)
            pg.click("[data-testid=share-image-btn]")
            ok, box = in_view(pg, "[data-testid=image-menu]")
            check(f"2 {w} share/{n} 分享圖選單在畫面內", ok, box)
            shot(pg, f"{w}_share{n}_分享圖選單")
            pg.mouse.click(5, 5)
            check(f"2 {w} share/{n} 點外面收起", pg.locator("[data-testid=image-menu]").count() == 0)
            check(f"2 {w} share/{n} 無水平溢出", overflow(pg) <= 0, overflow(pg))
        for n in (LOCKED_N, LOCKED_VER_N):
            pg.goto(B + f"/share/{n}"); settle(pg)
            check(f"2 {w} 鎖定 share/{n} 沒有分享按鈕", pg.locator("[data-testid=share-btn]").count() == 0
                  and pg.locator("[data-testid=share-image-btn]").count() == 0)
            if w == 390:
                shot(pg, f"{w}_share{n}_鎖定")
        for path, name in (("/artist/mountain-radio/1", "系列"), ("/artist/mountain-radio", "藝人")):
            pg.goto(B + path + "?x=1#intro"); settle(pg)
            pg.click("[data-testid=copy-link]")
            pg.wait_for_timeout(200)
            clip = pg.evaluate("navigator.clipboard.readText()")
            check(f"2 {w} {name}頁複製連結（去掉 ?、#）", clip == B + path and "已複製" in pg.locator("[data-testid=copy-link]").inner_text(), clip)
            check(f"2 {w} {name}頁無水平溢出", overflow(pg) <= 0, overflow(pg))
            shot(pg, f"{w}_{name}_複製連結")
        cx.close()

    # ---- 手機原生分享（stub 記錄呼叫內容） ----
    cx, pg = ctx(br, 390, mobile=True, stub=True)
    pg.goto(B + "/share/1"); settle(pg)
    pg.click("[data-testid=share-btn]"); pg.wait_for_timeout(300)
    sh = pg.evaluate("window.__shared")
    check("3 手機有 navigator.share：叫原生分享帶標題、文字、網址，不開小選單",
          len(sh) == 1 and sh[0]["url"] == f"{B}/share/1" and sh[0]["title"] and sh[0]["text"] == "山線電台・夜行採集・CD・首批紙套版"
          and pg.locator("[data-testid=share-menu]").count() == 0, sh)
    pg.click("[data-testid=share-image-btn]"); pg.click("[data-testid=image-menu] button[data-kind=story]")
    pg.wait_for_function("window.__shared.length >= 2", timeout=20000)
    sh = pg.evaluate("window.__shared")
    check("3 手機能分享檔案：分享圖直接叫分享選單（帶 1 個 JPEG 檔）",
          sh[1]["files"] and sh[1]["files"][0]["type"] == "image/jpeg" and sh[1]["files"][0]["size"] > 10000, sh[1])
    cx.close()

    # ---- 下載分享圖：桌機，兩種尺寸 × 三則 ----
    cx, pg = ctx(br, 1440)
    reqs = []
    pg.on("request", lambda q: reqs.append(q.url))
    for n, tag in ((1, "有照片"), (LONG_N, "長標題"), (NOPHOTO_N, "沒照片")):
        pg.goto(B + f"/share/{n}"); settle(pg)
        pg.wait_for_function("() => { const i = document.querySelector('.detail-photo img'); return !i || (i.complete && i.naturalWidth > 0) }")
        reads0 = sql("select value from counters where key like 'r2_reads:%' order by key desc limit 1")[0]["value"]
        reqs.clear()
        for k, size in (("story", (1080, 1920)), ("post", (1080, 1350))):
            pg.click("[data-testid=share-image-btn]")
            t0 = time.time()
            with pg.expect_download(timeout=20000) as dl:
                pg.click(f"[data-testid=image-menu] button[data-kind={k}]")
            ms = int((time.time() - t0) * 1000)
            out = IMG / f"分享圖_{tag}_{k}_{size[0]}x{size[1]}.jpg"
            dl.value.save_as(str(out))
            im = Image.open(out)
            R["images"][out.name] = {"size": im.size, "bytes": out.stat().st_size, "ms": ms, "file": dl.value.suggested_filename}
            check(f"4 分享圖 {tag} {k} 尺寸 {size[0]}×{size[1]}", im.size == size, f"{im.size} {out.stat().st_size}B {ms}ms")
        reads1 = sql("select value from counters where key like 'r2_reads:%' order by key desc limit 1")[0]["value"]
        net = [u for u in reqs if not u.startswith("blob:") and not u.startswith("data:") and "fonts.g" not in u]
        check(f"4 {tag} 產生分享圖不經伺服器（0 個站內請求、R2 讀取計數不變）", not net and reads0 == reads1,
              f"requests={net[:5]} fonts={[u for u in reqs if 'fonts.g' in u][:3]} r2 {reads0}→{reads1}")
        fonts = pg.evaluate("""() => ['700 64px "Noto Sans TC"', '500 40px "Noto Sans TC"', '700 64px "Inter"', '500 28px "IBM Plex Mono"']
                             .map(f => [f, document.fonts.check(f, '音藏山線電台AB')])""")
        check(f"4 {tag} 畫圖時字型已載入", all(x[1] for x in fonts), fonts)
    cx.close()
    br.close()

bad = [e for e in errs if "favicon" not in e[1]]
check("5 console error 0", not bad, bad[:5])
R["console_errors"] = len(bad)
ok = sum(c["ok"] for c in R["checks"])
R["summary"] = f"{ok}/{len(R['checks'])}"
print("SUMMARY", R["summary"])
(HERE / "result.json").write_text(json.dumps(R, ensure_ascii=False, indent=1))
