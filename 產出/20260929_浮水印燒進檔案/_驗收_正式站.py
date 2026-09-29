"""浮水印燒進檔案：正式站驗收。建一個測試帳號（wmtest0929）＋session 直接寫 D1，只上傳一張照片、不發文。"""
import hashlib, json, os, secrets, subprocess, sys, time, datetime
import requests
from playwright.sync_api import sync_playwright

B = "https://yinzang.dblzm.workers.dev"
SITE = "/home/dz/AboutAI/專案/music-collectibles/網站"
OUT = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad/wm/prod"
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
res = []

def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--remote",
                        "--config", "wrangler.production.jsonc", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"SQL failed: {r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]

def check(n, ok, d=""):
    res.append((n, ok)); print(("PASS " if ok else "FAIL ") + n, str(d)[:300])

def iso(dt=None):
    dt = dt or datetime.datetime.now(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"

state_f = f"{OUT}/state.json"
if os.path.exists(state_f):
    st = json.load(open(state_f))
else:
    uid, handle = "u-wmtest0929", "wmtest0929"
    tok = secrets.token_urlsafe(32)
    ex = sql(f"SELECT id FROM users WHERE id = '{uid}'")
    if not ex:
        sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES ('{uid}', 'wmtest0929@wmtest.test', '{iso()}', 'disabled', '{handle}', '浮水印驗收帳號', '{iso()}', '{iso()}')")
    exp = iso(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2))
    sql(f"INSERT INTO sessions (id, user_id, client, expires_at) VALUES ('{hashlib.sha256(tok.encode()).hexdigest()}', '{uid}', 'web', '{exp}')")
    st = {"uid": uid, "handle": handle, "tok": tok}
    json.dump(st, open(state_f, "w"))

H = {"Authorization": f"Bearer {st['tok']}", "User-Agent": UA}
me = requests.get(B + "/api/me", headers=H, timeout=20).json()
check("0 測試帳號登入", (me.get("user") or {}).get("handle") == st["handle"], me.get("user"))

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 900}, user_agent=UA)
    ctx.add_cookies([{"name": "yz_session", "value": st["tok"], "domain": "yinzang.dblzm.workers.dev", "path": "/", "httpOnly": True, "secure": True}])
    page = ctx.new_page()
    page.goto(B + "/share/new", wait_until="networkidle")
    with page.expect_response(lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST", timeout=90000) as rinfo:
        page.locator('input[type="file"]').first.set_input_files(sys.argv[1])
    up = rinfo.value
    body = up.json()
    check("1 正式站新表單上傳 201", up.status == 201, body)
    pid = body["id"]
    row = sql(f"SELECT r2_key, thumb_key, orig_key, bytes FROM photos WHERE id = '{pid}'")[0]
    check("2 D1 orig_key 在 o/", (row["orig_key"] or "").startswith("o/"), row)
    st.update({"pid": pid, "row": row, "body": body}); json.dump(st, open(state_f, "w"))
    # 直接開公開網址（沒登入的新瀏覽器）
    anon = br.new_context(viewport={"width": 900, "height": 700}, user_agent=UA)
    ap = anon.new_page()
    r = ap.goto(B + body["thumbUrl"])
    check("3 沒登入直接開縮圖網址 200", r.status == 200, r.status)
    ap.screenshot(path=f"{OUT}/直接開縮圖網址_新上傳.jpg", type="jpeg", quality=80)
    open(f"{OUT}/new_thumb.webp", "wb").write(r.body())
    r = ap.goto(B + body["url"])
    check("3b 沒登入開主圖網址 401", r.status == 401, r.status)
    m = requests.get(B + body["url"], headers=H, timeout=20)
    open(f"{OUT}/new_main.webp", "wb").write(m.content)
    check("3c 登入開主圖 200", m.status_code == 200, m.status_code)
    for u in [f"/img/{row['orig_key']}", f"/img/{row['orig_key']}?x=1", "/img/o%2F" + row["orig_key"][2:], "/img/p/../" + row["orig_key"]]:
        a = requests.get(B + u, headers={"User-Agent": UA}, timeout=20).status_code
        b = requests.get(B + u, headers=H, timeout=20).status_code
        check(f"4 原圖取不到 {u}", a in (403, 404) and b in (403, 404), (a, b))
    # 舊照片：第 3、4、5 則頁面引用的都是新檔名，逐張直接開
    for n in (3, 4, 5):
        for w, h, name in [(1280, 900, "桌機"), (390, 844, "手機")]:
            c2 = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, is_mobile=w < 500, user_agent=UA)
            p2 = c2.new_page()
            p2.goto(f"{B}/share/{n}", wait_until="networkidle")
            srcs = p2.eval_on_selector_all("img", "els => els.map(e => e.getAttribute('src') || '')")
            imgs = [s for s in srcs if "/img/p/" in s]
            olds = [s for s in imgs if not __import__('re').search(r"/img/p/[A-Za-z0-9_-]{16}_[A-Za-z0-9]{8}", s)]
            check(f"5 第{n}則 {name} 照片都是新檔名", imgs and not olds, olds[:3])
            check(f"6 第{n}則 {name} 沒有 CSS 浮水印節點", p2.locator(".wm, .wm-center, [data-testid=watermark]").count() == 0)
            p2.screenshot(path=f"{OUT}/第{n}則_{name}.jpg", type="jpeg", quality=80)
            c2.close()
    # 首頁卡片
    for w, h, name in [(1280, 900, "桌機"), (390, 844, "手機")]:
        c2 = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, is_mobile=w < 500, user_agent=UA)
        p2 = c2.new_page()
        p2.goto(B + "/", wait_until="networkidle")
        check(f"7 首頁 {name} 沒有 CSS 浮水印節點", p2.locator(".wm, .wm-center").count() == 0)
        p2.screenshot(path=f"{OUT}/首頁_{name}.jpg", type="jpeg", quality=80)
        c2.close()
    # 舊照片新網址直接開
    keys = sql("SELECT thumb_key FROM photos WHERE purpose='share' AND deleted_at IS NULL AND share_no = 3 ORDER BY sort LIMIT 1")
    r = ap.goto(B + "/img/" + keys[0]["thumb_key"])
    check("8 舊照片（第3則）新縮圖網址 200", r.status == 200, keys[0]["thumb_key"])
    ap.screenshot(path=f"{OUT}/直接開縮圖網址_第3則補燒.jpg", type="jpeg", quality=80)
    r = ap.goto(B + "/img/p/FYlAwDEUxVVTES_s_t.jpg")
    check("9 用戶回報的舊網址 404", r.status == 404, r.status)
    ap.screenshot(path=f"{OUT}/直接開舊網址_404.jpg", type="jpeg", quality=80)
    br.close()
print(f"{sum(ok for _, ok in res)}/{len(res)}")
