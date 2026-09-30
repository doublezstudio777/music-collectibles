"""正式網域 lemibox.com 驗收（2026-09-30）。
第一段：本機無頭 Chromium 開公開頁（1440／390／360），驗 200、網址留在 lemibox.com、og:url 用新網域、手機不溢出、console error 0。
第二段：Windows Chrome（CDP，暫存 profile；正式站 Turnstile 受管理模式，無頭瀏覽器過不了）在 lemibox.com 實際操作：
  註冊→收驗證信→驗證登入→登出→登入→忘記密碼→收重設信→重設並登入→上傳一張照片→發一則收藏→看單則頁與照片。
  信件內容與送達狀態從 Resend API 讀（last_event=delivered 才算收到）。
用法：python3 _驗收_正式站.py <scratchpad 路徑>（CDP 轉接由 scratchpad/relay.sh 開）。密碼與狀態存 scratchpad，不進 git。"""
import io, json, os, re, secrets, subprocess, sys, time
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

B = "https://lemibox.com"
OLD = "https://yinzang.dblzm.workers.dev"
SP = sys.argv[1]
IMG = Path(__file__).parent / "img"
IMG.mkdir(exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
EMAIL = "zukawork0312+lemibox0930@gmail.com"
HANDLE = "lmbtest0930"
IGNORE = ("sentry.io", "spotify", "challenges.cloudflare.com")  # Spotify 嵌入播放器、Turnstile 小框自己的 console（舊網址一樣有），跟本站無關
res = []


def check(n, ok, d=""):
    res.append((n, bool(ok), str(d)[:300]))
    print(("PASS " if ok else "FAIL ") + n, str(d)[:300], flush=True)


def resend_key():
    for l in open("/mnt/d/OneDrive/Claude-Data/_個人資料/音藏/_私人/resend.txt", encoding="utf8"):
        if l.startswith("RESEND_API_KEY="):
            return l.split("=", 1)[1].strip()


def wait_mail(subject_kw, after_ids, timeout=90):
    """等寄給 EMAIL、主旨含關鍵字、不在 after_ids 的新信；回傳 (信, 驗證碼, last_event)"""
    h = {"Authorization": "Bearer " + resend_key()}
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = requests.get("https://api.resend.com/emails?limit=20", headers=h, timeout=20).json().get("data", [])
        for e in d:
            if EMAIL in e["to"] and subject_kw in e["subject"] and e["id"] not in after_ids:
                for _ in range(30):
                    full = requests.get("https://api.resend.com/emails/" + e["id"], headers=h, timeout=20).json()
                    if full.get("last_event") in ("delivered", "bounced", "complained"):
                        break
                    time.sleep(3)
                code = re.search(r"(\d{6})", full.get("text") or "").group(1)
                return full, code
        time.sleep(3)
    return None, None


def mail_ids():
    h = {"Authorization": "Bearer " + resend_key()}
    return {e["id"] for e in requests.get("https://api.resend.com/emails?limit=20", headers=h, timeout=20).json().get("data", [])}


def overflow(pg):
    return pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")


def test_photo():
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1200, 1200), (214, 196, 170))
    d = ImageDraw.Draw(im)
    for i in range(0, 1200, 60):
        d.line([(i, 0), (1200 - i, 1200)], fill=(120, 90, 60), width=6)
    d.ellipse([300, 300, 900, 900], fill=(30, 30, 30))
    d.ellipse([560, 560, 640, 640], fill=(214, 196, 170))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85)
    return b.getvalue()


# ---------------- 第一段：公開頁 ----------------
share_html = requests.get(B + "/share/4", headers={"User-Agent": UA}, timeout=20).text
code4 = re.search(r"verify\?c=([A-Z0-9]{5})", share_html).group(1)
og_img = re.search(r'og:image" content="([^"]+)"', share_html).group(1)
thumb = re.search(r'src="(/img/[^"]+_t\.webp)"', share_html)
thumb = thumb.group(1) if thumb else None
PAGES = [("首頁", "/"), ("藝人目錄", "/artists"), ("藝人頁", "/artist/sunset-rollercoaster"), ("收藏頁", "/share/4"),
         ("查證頁", f"/verify?c={code4}"), ("登入頁", "/login"), ("註冊頁", "/login?mode=register"), ("意見回饋", "/feedback")]
errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c = br.new_context(viewport={"width": w, "height": h}, user_agent=UA, device_scale_factor=2 if mob else 1, is_mobile=mob, has_touch=mob)
        pg = c.new_page()
        pg.on("console", lambda m, w=w, pg=pg: m.type == "error" and not any(k in m.text + (m.location or {}).get("url", "") for k in IGNORE) and errs.append(f"{w} {pg.url}: {m.text[:200]}"))
        for name, p in PAGES:
            r = pg.goto(B + p, wait_until="load", timeout=30000)
            try:
                pg.wait_for_load_state("networkidle", timeout=8000)
            except Exception:
                pass
            pg.evaluate("document.fonts.ready")
            host_ok = pg.url.startswith(B + "/")
            ov = overflow(pg)
            ogurl = pg.evaluate("document.querySelector('meta[property=\"og:url\"]')?.content || ''")
            extra = True
            if name == "查證頁":
                extra = pg.locator("[data-testid=verify-found]").count() == 1
            if name == "收藏頁":
                extra = pg.evaluate("[...document.querySelectorAll('main img')].filter(i=>i.src.includes('/img/')).every(i=>i.complete&&i.naturalWidth>0)") and \
                    pg.locator("main img[src*='/img/']").count() > 0
            check(f"{name} {w}px：{r.status}、留在 lemibox.com、無橫向溢出" + ("、內容正確" if name in ("查證頁", "收藏頁") else ""),
                  r.status == 200 and host_ok and ov <= 0 and extra, (r.status, pg.url, ov, ogurl))
            if ogurl:
                check(f"{name} {w}px og:url 用新網域", ogurl.startswith(B), ogurl)
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=(w != 1440))
        c.close()
    br.close()
check("公開頁 console error 0（排除 Spotify 播放器）", not errs, errs[:5])

for label, u in [("預覽圖 og", og_img), ("縮圖", B + thumb if thumb else None)]:
    if u:
        r = requests.get(u, headers={"User-Agent": UA}, timeout=20)
        check(f"圖片 {label} 200 image/*", r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"), (u, r.status_code, r.headers.get("content-type"), len(r.content)))
r = requests.get("https://www.lemibox.com/share/4?a=1", headers={"User-Agent": UA}, allow_redirects=False, timeout=20)
check("www.lemibox.com 301 到 apex（保留路徑與參數）", r.status_code == 301 and r.headers.get("location") == B + "/share/4?a=1", (r.status_code, r.headers.get("location")))
r = requests.get("http://lemibox.com/", headers={"User-Agent": UA}, allow_redirects=False, timeout=20)
check("http 轉 https", r.status_code in (301, 308) and r.headers.get("location", "").startswith("https://lemibox.com"), (r.status_code, r.headers.get("location")))
r = requests.get(OLD + "/share/4", headers={"User-Agent": UA}, allow_redirects=False, timeout=20)
check("舊網址 workers.dev 照常 200（沒轉址）", r.status_code == 200, r.status_code)
hr = requests.get(B + "/", headers={"User-Agent": UA}, timeout=20)
check("新網域 noindex 照舊（ALLOW_INDEXING=0）", "noindex" in hr.headers.get("X-Robots-Tag", "") and 'content="noindex' in hr.text)

# ---------------- 第二段：Windows Chrome 實際操作帳號與上傳 ----------------
stf = os.path.join(SP, "lmb_state.json")
st = json.load(open(stf)) if os.path.exists(stf) else {"pw1": secrets.token_urlsafe(12), "pw2": secrets.token_urlsafe(12)}
json.dump(st, open(stf, "w"))
subprocess.run([os.path.join(SP, "relay.sh")])
gw = subprocess.check_output("ip route show default | awk '{print $3}'", shell=True, text=True).strip()


def form_submit(pg, fields, button):
    for label, val in fields:
        pg.locator("main form.auth-form").get_by_label(label, exact=False).first.fill(val)
    # 等 Turnstile 給 token
    for _ in range(120):
        if pg.evaluate("(document.querySelector('main input[name=\"cf-turnstile-response\"]')||{}).value || ''"):
            break
        time.sleep(0.5)
    pg.locator("main form.auth-form button[type=submit]").click()


def logged_in(pg):
    return pg.evaluate("fetch('/api/me',{credentials:'same-origin'}).then(r=>r.json()).then(j=>j.user?j.user.handle:null)")


def photo_checks(n):
    """新收藏的照片：縮圖沒登入也 200；大圖沒登入 401 是設計（app/img 路由：大圖要登入）"""
    html = requests.get(f"{B}/share/{n}", headers={"User-Agent": UA}, timeout=20).text
    t = re.search(r'src="(/img/[^"]+_t\.webp)"', html)
    if t:
        r = requests.get(B + t.group(1), headers={"User-Agent": UA}, timeout=20)
        check("新照片縮圖沒登入 200 image/*", r.status_code == 200 and r.headers.get("content-type", "").startswith("image/"), (t.group(1), r.status_code, len(r.content)))
        if r.status_code == 200:
            (IMG / "新上傳照片_縮圖_燒浮水印.webp").write_bytes(r.content)
    else:
        check("新照片縮圖在單則頁找得到", False, n)
    if st.get("main"):
        r = requests.get(B + st["main"], headers={"User-Agent": UA}, timeout=20)
        check("新照片大圖沒登入 401（設計如此，大圖要登入）", r.status_code == 401, (st["main"], r.status_code))


if "share" in st:
    print(f"帳號流程上一輪已跑完（收藏 {st['share']}），這輪只複驗照片")
    photo_checks(st["share"])
else:
  with sync_playwright() as pw:
      br = pw.chromium.connect_over_cdp(f"http://{gw}:9223")
      ctx = br.new_context(viewport={"width": 1280, "height": 900})
      pg = ctx.new_page()
      cerr = []
      pg.on("console", lambda m: m.type == "error" and not any(k in m.text + (m.location or {}).get("url", "") for k in IGNORE) and cerr.append(f"{pg.url}: {m.text[:200]}"))

      # 註冊
      before = mail_ids()
      pg.goto(B + "/login?mode=register", wait_until="load")
      form_submit(pg, [("Email", EMAIL), ("密碼", st["pw1"]), ("帳號名", HANDLE), ("顯示名稱", "網域驗收")], "註冊")
      pg.wait_for_selector("main form.auth-form[data-mode=verify]", timeout=30000)
      check("註冊送出成功、進入驗證碼畫面", True, pg.locator("main .auth-note").inner_text())
      pg.screenshot(path=str(IMG / "流程_1_註冊後驗證畫面.jpg"), type="jpeg", quality=80)
      mail, code = wait_mail("驗證碼", before)
      check("註冊驗證信真的送達（Resend last_event=delivered）", mail and mail.get("last_event") == "delivered" and code,
            mail and (mail["id"], mail["from"], mail["subject"][:20], mail.get("last_event")))
      pg.locator("main form.auth-form").get_by_label("6 位數驗證碼").fill(code)
      pg.locator("main form.auth-form button[type=submit]").click()
      pg.wait_for_function("location.pathname !== '/login'", timeout=30000)
      time.sleep(1.5)
      check("驗證後登入成功（/api/me 回帳號）", logged_in(pg) == HANDLE, pg.url)
      ck = [c for c in ctx.cookies() if c["name"] == "yz_session"]
      check("session cookie 發在 lemibox.com、HttpOnly、Secure", ck and ck[0]["domain"].lstrip(".") == "lemibox.com" and ck[0]["httpOnly"] and ck[0]["secure"], ck and {k: ck[0][k] for k in ("domain", "httpOnly", "secure", "sameSite")})
      pg.screenshot(path=str(IMG / "流程_2_註冊驗證後已登入.jpg"), type="jpeg", quality=80)

      # 登出→登入
      pg.evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'})")
      time.sleep(1)
      check("登出後 /api/me 沒有帳號", logged_in(pg) is None)
      pg.goto(B + "/login", wait_until="load")
      form_submit(pg, [("Email", EMAIL), ("密碼", st["pw1"])], "登入")
      pg.wait_for_function("location.pathname !== '/login'", timeout=30000)
      time.sleep(1.5)
      check("登入成功", logged_in(pg) == HANDLE, pg.url)

      # 忘記密碼
      pg.evaluate("fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'})")
      time.sleep(1)
      before = mail_ids()
      pg.goto(B + "/login", wait_until="load")
      pg.locator("main form.auth-form button", has_text="忘記密碼").click()
      form_submit(pg, [("Email", EMAIL)], "寄重設碼")
      pg.wait_for_selector("main form.auth-form[data-mode=reset]", timeout=30000)
      pg.screenshot(path=str(IMG / "流程_3_忘記密碼後重設畫面.jpg"), type="jpeg", quality=80)
      mail, code = wait_mail("重設密碼", before)
      check("重設密碼信真的送達（Resend last_event=delivered）", mail and mail.get("last_event") == "delivered" and code,
            mail and (mail["id"], mail["from"], mail["subject"][:20], mail.get("last_event")))
      pg.locator("main form.auth-form").get_by_label("6 位數驗證碼").fill(code)
      pg.locator("main form.auth-form").get_by_label("新密碼").fill(st["pw2"])
      pg.locator("main form.auth-form button[type=submit]").click()
      pg.wait_for_function("location.pathname !== '/login'", timeout=30000)
      time.sleep(1.5)
      check("重設密碼後直接登入", logged_in(pg) == HANDLE, pg.url)
      r = pg.evaluate("""async (a) => { const r = await fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:a[0], password:a[1], turnstileToken:'x'})}); return r.status; }""", [EMAIL, st["pw1"]])
      check("舊密碼＋假 Turnstile token 被擋（非 200）", r != 200, r)

      # 上傳＋發一則
      pg.goto(B + "/share/new", wait_until="load")
      time.sleep(2)
      with pg.expect_response(lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST", timeout=120000) as ri:
          pg.locator("input[type=file]").first.set_input_files({"name": "lemibox-test.jpg", "mimeType": "image/jpeg", "buffer": test_photo()})
      up = ri.value.json()
      check("上傳照片成功（帶查證碼）", ri.value.status in (200, 201) and re.match(r"^[2-9A-Z]{5}$", up.get("code", "")), {k: up.get(k) for k in ("id", "code", "url")})
      pg.screenshot(path=str(IMG / "流程_4_上傳後表單.jpg"), type="jpeg", quality=80)
      r = pg.evaluate("""async (id) => { const r = await fetch('/api/shares', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
          body: JSON.stringify({photoIds: [id], about: ['落日飛車'], story: '正式網域驗收測試，驗完會刪', tags: [], sale: {state: 'share'}, kind: 'CD'})}); return [r.status, await r.text()]; }""", up["id"])
      check("發布收藏成功", r[0] == 201, r)
      if r[0] == 201:
          n = json.loads(r[1])["n"]
          st.update({"share": n, "photo": up["id"], "code": up["code"], "main": up["url"]})
          json.dump(st, open(stf, "w"))
          pg.goto(f"{B}/share/{n}", wait_until="load")
          time.sleep(2)
          ok = pg.evaluate("[...document.querySelectorAll('main img')].filter(i=>i.src.includes('/img/')).every(i=>i.complete&&i.naturalWidth>0)")
          check(f"新收藏單則頁 /share/{n} 照片載入", ok, pg.url)
          pg.screenshot(path=str(IMG / "流程_5_新收藏單則頁.jpg"), type="jpeg", quality=80)
          pg.goto(f"{B}/verify?c={up['code']}", wait_until="load")
          time.sleep(1.5)
          check("新照片查證碼在 /verify 查得到", pg.locator("[data-testid=verify-found]").count() == 1)
          # 手機寬度看剛發的收藏
          pg.set_viewport_size({"width": 390, "height": 844})
          pg.goto(f"{B}/share/{n}", wait_until="load")
          time.sleep(2)
          check("新收藏 390px 無橫向溢出", overflow(pg) <= 0, overflow(pg))
          pg.screenshot(path=str(IMG / "流程_6_新收藏單則頁_390.jpg"), type="jpeg", quality=80, full_page=True)
      check("Chrome 操作全程 console error 0", not cerr, cerr[:5])
      ctx.close()
      br.close()

json.dump([{"項目": n, "通過": ok, "證據": d} for n, ok, d in res], open(Path(__file__).parent / "驗收紀錄_正式站.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(f"\n{sum(1 for _, ok, _ in res if ok)}/{len(res)} 通過")
