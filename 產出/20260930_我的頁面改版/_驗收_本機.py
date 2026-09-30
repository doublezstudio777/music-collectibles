"""我的頁面改版包 本機驗收（2026-09-30）。

用法（網站/ 先 npm run build，再 npm start -- --port 8795）：
    python3 _驗收_本機.py [http://127.0.0.1:8795]
正式站（Turnstile 過不了，改用 D1 直接建的測試帳號＋session；大頭貼每天 5 次，正式站只傳 3 張）：
    MYPAGE_TOKEN=… MYPAGE_HANDLE=… MYPAGE_OTHER=別人的帳號 MYPAGE_FAVS=大象體操,9m88,王若琳 python3 _驗收_本機.py https://lemibox.com

- 用示範帳號 xiaomeng 登入（本機 Turnstile 測試金鑰，假 token 會過）
- 每次跑先清 xiaomeng 的大頭貼每日次數、最喜歡的藝人，可以重跑
- 測試照片（直式、橫式、超大）產在暫存資料夾，不進 repo
- 截圖存 img/，JPEG 品質 80
"""

import io
import json
import re
import subprocess
import sys
import tempfile
import time
import os
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8795"
HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent / "網站"
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)
TMP = Path(tempfile.mkdtemp(prefix="mypage-"))
PROD = "127.0.0.1" not in BASE
HANDLE = os.environ.get("MYPAGE_HANDLE", "xiaomeng")
OTHER = os.environ.get("MYPAGE_OTHER", "aze")
FAV_QS = os.environ.get("MYPAGE_FAVS", "林夏,山線,雨停").split(",")
PRE = "正式站_" if PROD else ""

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)
    return bool(ok)


def sql(q: str) -> None:
    if PROD:
        return
    subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--command", q],
        cwd=SITE, check=True, capture_output=True,
    )


def login() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"email": f"{HANDLE}@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}).encode(),
        headers={"content-type": "application/json", "origin": BASE},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        m = re.search(r"yz_session=([^;]+)", r.headers.get("set-cookie", ""))
    assert m, "登入沒拿到 cookie"
    return m.group(1)


def fixture(name: str, w: int, h: int) -> Path:
    """格線＋偏一邊的大圓，不同裁切位置輸出會不一樣"""
    im = Image.new("RGB", (w, h), (235, 235, 235))
    d = ImageDraw.Draw(im)
    step = max(w, h) // 16
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(160, 160, 160), width=max(2, step // 40))
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(160, 160, 160), width=max(2, step // 40))
    r = min(w, h) // 5
    d.ellipse([w * 0.25 - r, h * 0.3 - r, w * 0.25 + r, h * 0.3 + r], fill=(255, 106, 0))
    d.rectangle([w * 0.7, h * 0.65, w * 0.7 + r, h * 0.65 + r], fill=(17, 17, 17))
    p = TMP / name
    im.save(p, "JPEG", quality=85)
    return p


def shot(page, name: str, full: bool = True) -> None:
    page.screenshot(path=str(OUT / f"{PRE}{name}.jpg"), type="jpeg", quality=80, full_page=full)


def no_overflow(page, name: str) -> None:
    sw, iw = page.evaluate("[document.documentElement.scrollWidth, window.innerWidth]")
    check(f"{name} 沒有橫向溢出", sw <= iw, f"scrollWidth {sw} / innerWidth {iw}")


def view_state(page) -> dict:
    return page.evaluate(
        """() => { const v = document.querySelector('[data-testid=crop-view]');
        return { z: +v.dataset.z, cx: +v.dataset.cx, cy: +v.dataset.cy, ready: v.dataset.ready }; }"""
    )


def open_cropper(page, path: Path) -> float:
    t0 = time.time()
    page.set_input_files("[data-testid=avatar-input]", str(path))
    page.wait_for_selector("[data-testid=crop-view][data-ready='1']", timeout=30000)
    return time.time() - t0


def confirm_upload(page, label: str, _unused=None) -> None:
    before = page.evaluate("window.__av.length")
    with page.expect_response(lambda r: r.url.endswith("/api/me/avatar") and r.request.method == "POST", timeout=30000) as resp:
        page.click("[data-testid=crop-ok]")
    r = resp.value
    check(f"{label} 上傳成功 201", r.status == 201, str(r.status))
    page.wait_for_selector("[data-testid=avatar-cropper]", state="detached")
    page.wait_for_function("document.querySelector('[data-testid^=avatar-msg]')?.textContent.includes('已換上')", timeout=15000)
    sent = page.evaluate("window.__av")[before:]
    one = sent[0] if len(sent) == 1 else {}
    check(
        f"{label} 只送一個裁切後的 WebP（原圖不上傳）",
        len(sent) == 1 and one.get("fields") == ["image"] and one.get("type") == "image/webp" and one.get("size", 0) < 100_000,
        json.dumps(sent),
    )
    src = page.get_attribute("[data-testid=avatar-box] img.ava-img", "src")
    raw = urllib.request.urlopen(urllib.request.Request(f"{BASE}{src}", headers={"user-agent": "Mozilla/5.0 mypage-check"}), timeout=20).read()
    im = Image.open(io.BytesIO(raw))
    check(f"{label} 伺服器存的是 256×256 {im.format}", im.size == (256, 256) and im.format == "WEBP", f"{im.format} {im.size}")


def touch(cdp, kind: str, pts: list[tuple[float, float]]) -> None:
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def main() -> None:
    portrait = fixture("portrait_3024x4032.jpg", 3024, 4032)
    landscape = fixture("landscape_4032x3024.jpg", 4032, 3024)
    huge = fixture("huge_6000x8000.jpg", 6000, 8000)
    sql(f"DELETE FROM rate_limits WHERE key LIKE 'avatar:demo-{HANDLE}:%'")
    sql(f"UPDATE users SET fav_artists = '[]', links = '{{}}' WHERE handle = '{HANDLE}'")
    sql("UPDATE artists SET hidden_at = NULL WHERE slug = 'lin-hsia'")
    token = os.environ["MYPAGE_TOKEN"] if PROD else login()
    if PROD:
        # 正式站不能下 SQL：用 API 把測試帳號的藝人與連結清空，才能重跑
        req = urllib.request.Request(f"{BASE}/api/me/profile", method="PATCH", data=json.dumps({"favArtists": [], "links": {}}).encode(),
                                     headers={"content-type": "application/json", "origin": BASE, "cookie": f"yz_session={token}", "user-agent": "Mozilla/5.0 mypage-check"})
        urllib.request.urlopen(req, timeout=20).read()
    cookie = [{"name": "yz_session", "value": token, "domain": urlparse(BASE).hostname, "path": "/", "httpOnly": True, "secure": PROD}]

    with sync_playwright() as p:
        errors: list[str] = []

        def watch(page, tag):
            def on_console(m):
                if m.type == "error" and "status of 400" not in m.text:
                    errors.append(f"{tag}: {m.text}")
            page.on("console", on_console)
            page.on("pageerror", lambda e: errors.append(f"{tag}: {e}"))

        # 攔 fetch 記下每次送 /api/me/avatar 的檔案（Chromium 的 post_data 讀不到 multipart 裡的 Blob）
        SPY = """(() => { const f = window.fetch; window.__av = [];
          window.fetch = (u, init) => { if (String(u).endsWith('/api/me/avatar') && init && init.body instanceof FormData) {
            const img = init.body.get('image'); window.__av.push({ size: img.size, type: img.type, name: img.name, fields: [...init.body.keys()] }); }
            return f(u, init); }; })();"""

        def capture_uploads(page):
            page.add_init_script(SPY)
            return page

        # ---------- 桌機 1440：設定頁完整流程 ----------
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        ctx.add_cookies(cookie)
        pg = ctx.new_page()
        watch(pg, "1440")
        uploads = capture_uploads(pg)
        pg.goto(f"{BASE}/settings", wait_until="load")
        pg.wait_for_selector("[data-testid=bio-box]")
        # 順序：大頭貼、暱稱、自我介紹
        order = pg.evaluate("[...document.querySelectorAll('.settings > [data-testid]')].map(e => e.dataset.testid)")
        check("自我介紹在暱稱下方", order[:5] == ["avatar-box", "name-box", "bio-box", "links-box", "fav-box"], str(order))

        # 自我介紹
        bio = f"台中，收獨立樂團的實體。\n卡帶為主，也收黑膠。\n\n驗收 {int(time.time())}"
        pg.fill("[data-testid=bio-input]", "加我賴 abc123")
        pg.click("[data-testid=bio-save]")
        pg.wait_for_function("document.querySelector('[data-testid^=bio-msg]')?.textContent.includes('不能放')")
        check("自介含站外交易字眼被擋", True)
        pg.fill("[data-testid=bio-input]", "字" * 201)
        check("自介超過 200 字：儲存鈕停用、字數變色", pg.is_disabled("[data-testid=bio-save]") and "is-over" in (pg.get_attribute("[data-testid=bio-count]", "class") or ""))
        pg.fill("[data-testid=bio-input]", bio)
        pg.click("[data-testid=bio-save]")
        pg.wait_for_function("document.querySelector('[data-testid^=bio-msg]')?.textContent.includes('已儲存')")
        check("自介儲存", True)

        # 社群連結：非白名單被擋（前端＋伺服器）
        pg.fill("[data-testid=link-ig]", "https://evil.com/instagram.com")
        pg.click("[data-testid=links-save]")
        pg.wait_for_function("document.querySelector('[data-testid^=links-msg]')?.textContent.includes('只收')")
        check("IG 欄填非白名單網址被擋（前端）", pg.get_attribute("[data-testid=link-ig]", "aria-invalid") == "true", pg.inner_text("[data-testid^=links-msg]"))
        server = pg.evaluate(
            """async () => { const bad = [
                {ig:'https://evil.com/x'}, {ig:'http://instagram.com/x'}, {youtube:'https://instagram.com/x'},
                {facebook:'javascript:alert(1)'}, {threads:'https://threads.net.evil.com/@a'}, {ig:'https://user:pw@instagram.com/x'} ];
              const out = [];
              for (const links of bad) { const r = await fetch('/api/me/profile', {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({links})}); out.push(r.status); }
              return out; }"""
        )
        check("伺服器擋非白名單／http／javascript:／帳密網址", all(s == 400 for s in server), str(server))
        pg.fill("[data-testid=link-ig]", "instagram.com/lemi_test")
        pg.fill("[data-testid=link-threads]", "https://www.threads.com/@lemi_test")
        pg.fill("[data-testid=link-youtube]", "https://www.youtube.com/@lemi_test")
        pg.fill("[data-testid=link-facebook]", "https://www.facebook.com/lemi.test")
        pg.click("[data-testid=links-save]")
        pg.wait_for_function("document.querySelector('[data-testid^=links-msg]')?.textContent.includes('已儲存')")
        check("四個連結儲存，沒寫 https 自動補", pg.input_value("[data-testid=link-ig]") == "https://instagram.com/lemi_test", pg.input_value("[data-testid=link-ig]"))

        # 最喜歡的藝人：搜尋加三位、排序、移除一位
        for q in FAV_QS:
            pg.fill("[data-testid=fav-q]", q)
            pg.wait_for_selector("[data-testid=fav-found] button")
            pg.click("[data-testid=fav-found] button >> nth=0")
        slugs = lambda: pg.evaluate("[...document.querySelectorAll('[data-testid=fav-list] li')].map(e => e.dataset.slug)")
        s0 = slugs()
        check("加了三位藝人", len(s0) == 3, str(s0))
        pg.click("[data-testid=fav-list] li >> nth=0 >> [data-testid=fav-down]")
        s1 = slugs()
        check("往後移：第 1、2 位交換", s1 == [s0[1], s0[0], s0[2]], str(s1))
        pg.click("[data-testid=fav-list] li >> nth=2 >> [data-testid=fav-remove]")
        s2 = slugs()
        check("移除第 3 位", s2 == s1[:2], str(s2))
        pg.click("[data-testid=fav-save]")
        pg.wait_for_function("document.querySelector('[data-testid^=fav-msg]')?.textContent.includes('已儲存')")
        saved = pg.evaluate("fetch('/api/me/profile').then(r => r.json())")
        check("藝人順序存進伺服器", [a["slug"] for a in saved["favArtists"]] == s2, json.dumps(saved["favArtists"], ensure_ascii=False))
        many = pg.evaluate("""fetch('/api/me/profile', {method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify({favArtists:['a','b','c','d','e','f']})}).then(r => r.status)""")
        check("伺服器擋超過 5 位", many == 400, str(many))
        pg.evaluate("window.scrollTo(0, 0)")
        shot(pg, "1440_設定頁")

        # 大頭貼：取消不變更
        src0 = pg.get_attribute("[data-testid=avatar-box] .ava", "src")
        open_cropper(pg, portrait)
        pg.click("[data-testid=crop-cancel]")
        pg.wait_for_selector("[data-testid=avatar-cropper]", state="detached")
        open_cropper(pg, portrait)
        pg.keyboard.press("Escape")
        pg.wait_for_selector("[data-testid=avatar-cropper]", state="detached")
        check("按取消、Esc 都不上傳、頭像不變", pg.evaluate("window.__av.length") == 0 and pg.get_attribute("[data-testid=avatar-box] .ava", "src") == src0)

        # 大頭貼：滑鼠拖曳、滾輪、滑桿
        open_cropper(pg, landscape)
        v0 = view_state(pg)
        box = pg.locator("[data-testid=crop-view]").bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        pg.mouse.move(cx, cy)
        pg.mouse.down()
        for i in range(1, 11):
            pg.mouse.move(cx + i * 8, cy)
        pg.mouse.up()
        v1 = view_state(pg)
        check("桌機滑鼠拖曳（橫式照片左右移）", v1["cx"] < v0["cx"] and v1["z"] == v0["z"], f"{v0} → {v1}")
        pg.mouse.move(cx, cy)
        pg.mouse.wheel(0, -400)
        pg.wait_for_timeout(200)
        v2 = view_state(pg)
        check("桌機滾輪放大", v2["z"] > v1["z"], f"z {v1['z']} → {v2['z']}")
        pg.fill("[data-testid=crop-zoom]", "3")
        v3 = view_state(pg)
        check("桌機滑桿縮放", abs(v3["z"] - 3) < 0.01, f"z {v3['z']}")
        shot(pg, "1440_裁切視窗", full=False)
        confirm_upload(pg, "桌機橫式", uploads)
        ctx.close()

        # ---------- 手機 390／360／320（Chromium 觸控） ----------
        phone_files = {390: [("超大 6000×8000", huge)] if PROD else [("直式", portrait), ("橫式", landscape), ("超大 6000×8000", huge)], 360: [], 320: []}
        for w, files in phone_files.items():
            c = b.new_context(viewport={"width": w, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=3)
            c.add_cookies(cookie)
            pg = c.new_page()
            watch(pg, str(w))
            ups = capture_uploads(pg)
            pg.goto(f"{BASE}/settings", wait_until="load")
            pg.wait_for_selector("[data-testid=fav-box]")
            shot(pg, f"{w}_設定頁")
            no_overflow(pg, f"{w} 設定頁")
            cdp = c.new_cdp_session(pg)
            for label, f in files:
                t = open_cropper(pg, f)
                check(f"{w} {label} 裁切視窗開得起來", True, f"{t:.1f} 秒")
                box = pg.locator("[data-testid=crop-view]").bounding_box()
                x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
                v0 = view_state(pg)
                # 雙指拉開＝放大
                touch(cdp, "touchStart", [(x - 30, y), (x + 30, y)])
                for i in range(1, 11):
                    touch(cdp, "touchMove", [(x - 30 - i * 6, y), (x + 30 + i * 6, y)])
                touch(cdp, "touchEnd", [])
                v1 = view_state(pg)
                check(f"{w} {label} 雙指放大", v1["z"] > v0["z"] * 1.5, f"z {v0['z']} → {v1['z']}")
                # 單指拖曳
                touch(cdp, "touchStart", [(x, y)])
                for i in range(1, 11):
                    touch(cdp, "touchMove", [(x - i * 5, y - i * 5)])
                touch(cdp, "touchEnd", [])
                v2 = view_state(pg)
                check(f"{w} {label} 單指拖曳", v2["cx"] > v1["cx"] and v2["cy"] > v1["cy"] and v2["z"] == v1["z"], f"{v1} → {v2}")
                scroll = pg.evaluate("window.scrollY")
                check(f"{w} {label} 拖曳時頁面沒跟著捲", scroll == 0, f"scrollY {scroll}")
                if label == "直式" or (PROD and label.startswith("超大")):
                    shot(pg, f"{w}_裁切視窗_直式", full=False)
                if label == "橫式":
                    shot(pg, f"{w}_裁切視窗_橫式", full=False)
                confirm_upload(pg, f"{w} {label}", ups)
            if not files:
                open_cropper(pg, portrait)
                shot(pg, f"{w}_裁切視窗_直式", full=False)
                bb = pg.locator(".crop-box").bounding_box()
                check(f"{w} 裁切視窗塞得進螢幕", bb["x"] >= 0 and bb["x"] + bb["width"] <= w, f"{bb['x']:.0f}～{bb['x'] + bb['width']:.0f}")
                pg.click("[data-testid=crop-cancel]")
            c.close()

        # ---------- WebKit（合成 PointerEvent，pointerType=touch） ----------
        wk = p.webkit.launch()
        c = wk.new_context(viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=3)
        c.add_cookies(cookie)
        pg = c.new_page()
        watch(pg, "webkit")
        ups = capture_uploads(pg)
        pg.goto(f"{BASE}/settings", wait_until="load")
        pg.wait_for_selector("[data-testid=fav-box]")
        open_cropper(pg, portrait)
        v0 = view_state(pg)
        res = pg.evaluate(
            """async () => {
              const el = document.querySelector('[data-testid=crop-view]');
              const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const ev = (type, id, px, py) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1,
                clientX: px, clientY: py, bubbles: true, cancelable: true }));
              const wait = () => new Promise(r => requestAnimationFrame(() => r()));
              ev('pointerdown', 1, x - 30, y); ev('pointerdown', 2, x + 30, y);
              for (let i = 1; i <= 10; i++) { ev('pointermove', 1, x - 30 - i * 6, y); ev('pointermove', 2, x + 30 + i * 6, y); await wait(); }
              ev('pointerup', 1, x - 90, y); ev('pointerup', 2, x + 90, y); await wait();
              const z1 = +el.dataset.z;
              const c1 = [+el.dataset.cx, +el.dataset.cy];
              ev('pointerdown', 3, x, y);
              for (let i = 1; i <= 10; i++) { ev('pointermove', 3, x - i * 5, y - i * 5); await wait(); }
              ev('pointerup', 3, x - 50, y - 50); await wait();
              return { z1, c1, c2: [+el.dataset.cx, +el.dataset.cy], ta: getComputedStyle(el).touchAction };
            }"""
        )
        check("WebKit 雙指放大（合成觸控指標）", res["z1"] > v0["z"] * 1.5, f"z {v0['z']} → {res['z1']}")
        check("WebKit 單指拖曳（合成觸控指標）", res["c2"][0] > res["c1"][0] and res["c2"][1] > res["c1"][1], f"{res['c1']} → {res['c2']}")
        check("WebKit 取景框 touch-action: none", res["ta"] == "none", res["ta"])
        shot(pg, "webkit_390_裁切視窗", full=False)
        confirm_upload(pg, "WebKit 直式", ups)
        c.close()
        wk.close()

        # ---------- 個人頁 ----------
        for w in [1440, 390, 360, 320]:
            c = b.new_context(viewport={"width": w, "height": 900}, is_mobile=w < 1000, has_touch=w < 1000)
            c.add_cookies(cookie)
            pg = c.new_page()
            watch(pg, f"u-{w}")
            pg.goto(f"{BASE}/u/{HANDLE}", wait_until="load")
            pg.wait_for_selector("[data-testid=edit-profile]")
            if w == 1440:
                text = pg.inner_text("[data-testid=profile-bio]")
                check("個人頁自介保留換行", text.count("\n") >= 2 and "卡帶為主" in text, repr(text[:40]))
                check("個人頁自介 white-space: pre-line", pg.evaluate("getComputedStyle(document.querySelector('[data-testid=profile-bio]')).whiteSpace") == "pre-line")
                favs = pg.evaluate("[...document.querySelectorAll('[data-testid=profile-favs] a')].map(a => [a.dataset.slug, a.getAttribute('href')])")
                check("個人頁藝人標籤照順序、連到藝人頁", [f[0] for f in favs] == s2 and all(h == f"/artist/{s}" for s, h in favs), str(favs))
                links = pg.evaluate("[...document.querySelectorAll('[data-testid=profile-links] a')].map(a => [a.dataset.key, a.target, a.rel, a.href])")
                check("個人頁四個社群圖示", len(links) == 4, str([l[0] for l in links]))
                check("社群連結 target=_blank rel=noopener nofollow ugc", all(l[1] == "_blank" and l[2] == "noopener nofollow ugc" for l in links), str(links[0]))
                check("自己的頁面有「編輯個人資料」連到 /settings", pg.get_attribute("[data-testid=edit-profile]", "href") == "/settings")
            shot(pg, f"{w}_個人頁_本人", full=False)
            no_overflow(pg, f"{w} 個人頁")
            c.close()

        # 看別人的頁面、未登入看我的頁面：沒有編輯鈕
        c = b.new_context(viewport={"width": 1440, "height": 900})
        c.add_cookies(cookie)
        pg = c.new_page()
        pg.goto(f"{BASE}/u/{OTHER}", wait_until="load")
        pg.wait_for_function("document.querySelector('[data-testid=me-avatar]')")
        pg.wait_for_timeout(500)
        check("看別人的個人頁沒有「編輯個人資料」", pg.locator("[data-testid=edit-profile]").count() == 0)
        c.close()
        c = b.new_context(viewport={"width": 1440, "height": 900})
        pg = c.new_page()
        pg.goto(f"{BASE}/u/{HANDLE}", wait_until="load")
        pg.wait_for_timeout(800)
        check("未登入看個人頁沒有「編輯個人資料」", pg.locator("[data-testid=edit-profile]").count() == 0)
        check("未登入看得到自介、藝人、連結", pg.locator("[data-testid=profile-bio]").count() == 1 and pg.locator("[data-testid=profile-links] a").count() == 4)
        shot(pg, "1440_個人頁_訪客", full=False)

        # 藝人被隱藏：個人頁不顯示、設定頁也不回（正式站不動真藝人，只在本機驗）
        if not PROD:
            sql("UPDATE artists SET hidden_at = '2026-09-30T00:00:00Z' WHERE slug = 'lin-hsia'")
            pg.goto(f"{BASE}/u/{HANDLE}", wait_until="load")
            shown = pg.evaluate("[...document.querySelectorAll('[data-testid=profile-favs] a')].map(a => a.dataset.slug)")
            check("隱藏的藝人不顯示在個人頁", "lin-hsia" not in shown and len(shown) == len(s2) - ("lin-hsia" in s2), str(shown))
            sql("UPDATE artists SET hidden_at = NULL WHERE slug = 'lin-hsia'")
        c.close()
        b.close()

        check("沒有 console error", not errors, "\n".join(errors[:8]))

    ok = sum(1 for r in results if r[1])
    print(f"\n{ok}/{len(results)} 通過")
    (HERE / f"result_{'正式站' if PROD else '本機'}.json").write_text(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], ensure_ascii=False, indent=1), encoding="utf-8")
    sys.exit(0 if ok == len(results) else 1)


if __name__ == "__main__":
    main()
