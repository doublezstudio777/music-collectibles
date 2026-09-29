"""浮水印燒進檔案：本機驗收（build 版 8791）"""
import json, subprocess, sys, time, re
import requests
from playwright.sync_api import sync_playwright

B = "http://127.0.0.1:8791"
SITE = "/home/dz/AboutAI/專案/music-collectibles/網站"
OUT = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad/wm"
STAMP = str(int(time.time()))[-6:]
res = []

def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"SQL failed: {r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]

def r2_exists(key):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "r2", "object", "get", f"yinzang-photos/{key}",
                        "--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--pipe"], cwd=SITE, capture_output=True)
    return r.returncode == 0 and len(r.stdout) > 100

def check(n, ok, d=""):
    res.append((n, ok)); print(("PASS " if ok else "FAIL ") + n, str(d)[:300])

def iso():
    import datetime
    dt = datetime.datetime.now(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"

PW = sql("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")[0]["password_hash"]
uid, handle, email = f"u-wm{STAMP}", f"wm{STAMP}", f"wm{STAMP}@wmtest.test"
sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES ('{uid}', '{email}', '{iso()}', '{PW}', '{handle}', 'WM{STAMP}', '{iso()}', '{iso()}')")
tok = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]
H = {"Authorization": f"Bearer {tok}", "x-yz-test-country": "TW"}
aslug = f"wmart{STAMP}"
sql(f"INSERT INTO artists (slug, name, kind, status, display) VALUES ('{aslug}', '浮水印藝人{STAMP}', '藝人', 'approved', 'auto')")
sql(f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status) VALUES ('{aslug}', 1, '浮水印系列{STAMP}', '2020《浮水印系列{STAMP}》專輯發行', '專輯發行', '[\"{aslug}\"]', '2020', '[]', 'approved')")

# 1. 舊版頁面（不帶 orig）上傳收藏照片 → 擋
tiny = bytes.fromhex("ffd8ffe000104a46494600010100000100010000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc9000b080001000101011100ffcc000601001101ffda0008010100003f00d2cf20ffd9")
r = requests.post(B + "/api/uploads", headers=H, files={"image": ("p.jpg", tiny, "image/jpeg"), "thumb": ("t.jpg", tiny, "image/jpeg")}, data={"purpose": "share"})
check("1 沒帶原圖的收藏照片上傳被擋 400 RELOAD", r.status_code == 400 and "RELOAD" in r.text, r.status_code)

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    ctx.set_extra_http_headers({"x-yz-test-country": "TW"})
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: m.type == "error" and errs.append(m.text))
    page.goto(B + "/share/new", wait_until="networkidle")
    with page.expect_response(lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST", timeout=60000) as rinfo:
        page.locator('input[type="file"]').first.set_input_files(f"{OUT}/" + (sys.argv[1] if len(sys.argv) > 1 else "record.jpg"))
    up = rinfo.value
    body = up.json()
    check("2 新表單上傳成功 201", up.status == 201, body)
    pid = body["id"]
    row = sql(f"SELECT r2_key, thumb_key, orig_key, bytes FROM photos WHERE id = '{pid}'")[0]
    check("3 D1 記了 orig_key 在 o/", (row["orig_key"] or "").startswith("o/"), row)
    check("3b R2 有原圖檔", r2_exists(row["orig_key"]))
    # 公開網址：縮圖直接開（不帶登入）
    t = requests.get(B + body["thumbUrl"])
    check("4 縮圖公開網址 200", t.status_code == 200, t.status_code)
    open(f"{OUT}/new_thumb.webp", "wb").write(t.content)
    m = requests.get(B + body["url"], headers={"Cookie": f"yz_session={tok}"})
    check("4b 主圖（登入）200", m.status_code == 200, m.status_code)
    open(f"{OUT}/new_main.webp", "wb").write(m.content)
    for u in [f"/img/{row['orig_key']}", f"/img/o/{pid}.webp", f"/img/o/{pid}.jpg", f"/img/{row['orig_key']}?x=1", "/img/o%2F" + row["orig_key"][2:], "/img/p/../" + row["orig_key"]]:
        a = requests.get(B + u).status_code
        b = requests.get(B + u, headers={"Cookie": f"yz_session={tok}"}).status_code
        check(f"5 原圖取不到 {u}", a in (403, 404) and b in (403, 404), (a, b))
    # 發文
    sr = requests.post(B + "/api/shares", headers=H, json={"photoIds": [pid], "about": [f"浮水印藝人{STAMP}"], "story": "", "tags": [], "sale": {"state": "share"}, "kind": "CD", "seriesKey": f"{aslug}/1"})
    check("6 發文成功", sr.ok, sr.text[:200])
    no = sr.json()["n"]
    print("share no", no)
    # 頁面上沒有 CSS 浮水印節點
    for w, h, name in [(1280, 900, "desktop"), (390, 844, "mobile")]:
        c2 = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1, is_mobile=w < 500)
        c2.set_extra_http_headers({"x-yz-test-country": "TW"})
        p2 = c2.new_page()
        p2.goto(f"{B}/share/{no}", wait_until="networkidle")
        check(f"7a 單則頁 {name} 照片是燒好的檔", p2.locator(f'img[src*="{pid}"]').count() > 0)
        n = p2.locator(".wm, .wm-center, [data-testid=watermark]").count()
        check(f"7 單則頁 {name} 沒有 CSS 浮水印節點", n == 0, n)
        p2.screenshot(path=f"{OUT}/share_{name}.jpg", type="jpeg", quality=80)
        p2.goto(f"{B}/u/{handle}", wait_until="networkidle")
        check(f"7b 個人頁收藏卡 {name} 沒有 CSS 浮水印節點", p2.locator(".wm, .wm-center").count() == 0)
        p2.screenshot(path=f"{OUT}/profile_{name}.jpg", type="jpeg", quality=80)
        c2.close()
    br.close()
json.dump({"pid": pid, "no": no, "tok": tok, "handle": handle, "row": row, "body": body}, open(f"{OUT}/local_state.json", "w"))
print(f"{sum(ok for _, ok in res)}/{len(res)}")
