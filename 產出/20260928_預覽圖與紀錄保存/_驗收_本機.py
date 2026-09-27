# 上線後雜項驗收：分享預覽圖改大圖（燒浮水印 JPEG）、活動紀錄保存 90 天。
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
import json, re, subprocess, sys, time
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageStat
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
IMG = Path(__file__).parent / "img"
IMG.mkdir(exist_ok=True)
res = []


def check(n, ok, d=""):
    res.append((n, ok))
    print(("PASS " if ok else "FAIL ") + n, str(d)[:240])


def sql(cmd):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
        cwd=SITE, capture_output=True, text=True, check=True,
    )
    return json.loads(r.stdout[r.stdout.index("["):])[0]["results"]


tok = requests.post(B + "/api/auth/login", json={"email": "admin@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
def admin(path, body=None, method="POST"):
    return requests.request(method, B + path, json=body or {}, headers=H)

# ---------- 1. 分享預覽圖：發一則收藏，確認預覽圖產生、有浮水印、og 標籤正確 ----------
STAMP = str(int(time.time()))[-6:]
with sync_playwright() as p:
    br = p.chromium.launch()
    errs = []
    c = br.new_context(viewport={"width": 1440, "height": 900})
    c.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = c.new_page()
    pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)

    pg.goto(B + "/share/new"); pg.wait_for_load_state("networkidle")
    photo = SITE / ".wrangler" / "verify-og-photo.jpg"
    Image.new("RGB", (2400, 1600), (40, 90, 150)).save(photo, "JPEG", quality=92)
    pg.locator("input[type=file]").first.set_input_files(str(photo))
    # 2026-09-28 多張照片改版：上傳完成的標記從 .drop.has-photo 換成 [data-testid=pp-tile][data-status=done]
    pg.wait_for_function("() => document.querySelector('[data-testid=pp-tile][data-status=done]')", timeout=30000)
    pg.locator("#share-form-about").fill("山線")
    pg.locator(".suggest button", has_text="山線電台").click()
    pg.locator("[data-testid=pick-series] button", has_text="夜行採集").click()
    pg.locator("[data-testid=pick-item] button", has_text="CD").click()
    pg.locator("[data-testid=pick-version] button").first.click()
    pg.locator("#share-form-story").fill(f"驗收 {STAMP}：上線後雜項，預覽圖與浮水印")
    pg.locator(".form-foot button[type=submit]").click()
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    pg.wait_for_load_state("networkidle")
    N = int(pg.url.rsplit("/", 1)[1])
    check("1a 頁面 console error 0（發布流程）", not errs, errs)
    br.close()

row = sql(f"SELECT p.og_key og, p.r2_key r2, p.thumb_key t, p.width w, p.height h, p.bytes b FROM photos p WHERE p.share_no={N}")[0]
check("1b 有產生分享預覽圖（og_key 不是 null）", bool(row["og"]), row)

og_resp = requests.get(f"{B}/img/{row['og']}")
check("1c 預覽圖 200，Content-Type image/jpeg", og_resp.status_code == 200 and og_resp.headers.get("content-type") == "image/jpeg", (og_resp.status_code, og_resp.headers.get("content-type")))
im = Image.open(BytesIO(og_resp.content))
check("1d 預覽圖尺寸 1200x630", im.size == (1200, 630), im.size)
(IMG / "1_預覽圖.jpg").write_bytes(og_resp.content)

# 浮水印偵測：原圖是純色 (40,90,150)，右下角與中央應該被文字改掉顏色（非純色區塊）
def has_variation(img, box):
    crop = img.crop(box)
    colors = crop.getcolors(maxcolors=1_000_000)
    return colors is None or len(colors) > 5

corner_varies = has_variation(im, (900, 520, 1200, 630))
center_varies = has_variation(im, (450, 265, 750, 365))
check("1e 浮水印：右下角有文字（非純色）", corner_varies)
check("1f 浮水印：中央斜字有文字（非純色）", center_varies)

# 主圖、縮圖沒有燒浮水印：右下角文字區塊的標準差應該跟畫面其他區塊（同樣是壓縮雜訊）同一個量級，
# 不會像 og 預覽圖那樣明顯偏高（文字筆畫造成的區域性大反差，不是均勻的壓縮雜訊）
def region_std(img, box):
    return sum(ImageStat.Stat(img.crop(box)).stddev) / 3

main_resp = requests.get(f"{B}/img/{row['t']}")
main_im = Image.open(BytesIO(main_resp.content)).convert("RGB")
w, hh = main_im.size
corner_box = (int(w * 0.75), int(hh * 0.82), w, hh)
plain_box = (0, 0, int(w * 0.25), int(hh * 0.18))
thumb_corner_std = region_std(main_im, corner_box)
thumb_plain_std = region_std(main_im, plain_box)
check("1g 縮圖沒有燒浮水印（角落雜訊跟其他區塊同量級）", thumb_corner_std < thumb_plain_std * 3 + 2, (thumb_corner_std, thumb_plain_std))

og_plain_box = (0, 0, 300, 113)
og_corner_std = region_std(im.convert("RGB"), (900, 517, 1200, 630))
og_plain_std = region_std(im.convert("RGB"), og_plain_box)
check("1g2 對照：og 預覽圖角落雜訊明顯偏高（真的有浮水印）", og_corner_std > og_plain_std * 3 + 2, (og_corner_std, og_plain_std))
check("1h bytes 欄含三張檔案大小（容量計入 8GB）", row["b"] > 0)

html = requests.get(f"{B}/share/{N}", headers={"User-Agent": "facebookexternalhit/1.1"}).text
og_url_m = re.search(r'property="og:image" content="([^"]+)"', html)
og_w = re.search(r'property="og:image:width" content="(\d+)"', html)
og_h = re.search(r'property="og:image:height" content="(\d+)"', html)
og_t = re.search(r'property="og:image:type" content="([^"]+)"', html)
check("1i og:image 指到預覽圖", bool(og_url_m) and row["og"] in og_url_m.group(1), og_url_m.group(1) if og_url_m else None)
check("1j og:image:width=1200", og_w and og_w.group(1) == "1200", og_w)
check("1k og:image:height=630", og_h and og_h.group(1) == "630", og_h)
check("1l og:image:type=image/jpeg", og_t and og_t.group(1) == "image/jpeg", og_t)
check("1m facebookexternalhit UA 抓得到單則頁（200）", requests.get(f"{B}/share/{N}", headers={"User-Agent": "facebookexternalhit/1.1"}).status_code == 200)

# ---------- 2. 隱藏後預覽圖回 404 ----------
h = admin("/api/admin/hide", {"type": "share", "key": str(N), "hidden": True})
og_after = requests.get(f"{B}/img/{row['og']}")
check("2a 隱藏後預覽圖 404", og_after.status_code == 404, og_after.status_code)
check("2b 隱藏 API 回報有清快取（purgedPhotos）", h.json().get("purgedPhotos", 0) >= 2, h.json())
admin("/api/admin/hide", {"type": "share", "key": str(N), "hidden": False})
og_restored = requests.get(f"{B}/img/{row['og']}")
check("2c 恢復後預覽圖 200", og_restored.status_code == 200, og_restored.status_code)

# ---------- 3. 未登入拿不到 1600px 大圖（沿用既有規則，og 圖不受影響） ----------
anon_main = requests.get(f"{B}/img/{row['r2']}")
check("3a 未登入拿不到大圖（401）", anon_main.status_code == 401, anon_main.status_code)
anon_og = requests.get(f"{B}/img/{row['og']}")
check("3b 未登入可拿到分享預覽圖（200，公開）", anon_og.status_code == 200, anon_og.status_code)

# ---------- 4. 活動紀錄保存 90 天：塞 91 天前、89 天前各一筆，跑 cron 後驗證 ----------
uid = sql("SELECT id FROM users LIMIT 1")[0]["id"]
sql(f"DELETE FROM user_activity WHERE user_id='{uid}' AND day IN ('1900-01-01','1900-01-02')")
old_day = (__import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=91)).strftime("%Y-%m-%d")
keep_day = (__import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=89)).strftime("%Y-%m-%d")
sql(f"INSERT OR IGNORE INTO user_activity (user_id, day, country) VALUES ('{uid}', '{old_day}', 'TW')")
sql(f"INSERT OR IGNORE INTO user_activity (user_id, day, country) VALUES ('{uid}', '{keep_day}', 'TW')")
before = sql(f"SELECT count(*) n FROM user_activity WHERE user_id='{uid}' AND day IN ('{old_day}','{keep_day}')")[0]["n"]
check("4a 塞資料前確認兩筆都在", before == 2, before)

# rate_limits：塞一筆早就過期的視窗
old_iso = (__import__("datetime").datetime.utcnow() - __import__("datetime").timedelta(days=95)).isoformat() + "Z"
keep_iso = (__import__("datetime").datetime.utcnow() + __import__("datetime").timedelta(hours=1)).isoformat() + "Z"
sql(f"INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES ('verify_test_old', 1, '{old_iso}')")
sql(f"INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES ('verify_test_keep', 1, '{keep_iso}')")

# user_geo：塞一筆 95 天前最後登入
sql(f"INSERT OR REPLACE INTO user_geo (user_id, register_country, last_login_country, last_login_at) VALUES ('geo-test-old', 'TW', 'TW', '{old_iso}')")
sql(f"INSERT OR REPLACE INTO user_geo (user_id, register_country, last_login_country, last_login_at) VALUES ('geo-test-keep', 'TW', 'TW', '{keep_iso}')")

r = admin("/api/admin/cleanup", {})
check("4b 清理 API 200", r.status_code == 200, r.text[:200])
body = r.json()
check("4c 回傳 retentionDays=90", body.get("retentionDays") == 90, body)

after_activity = sql(f"SELECT day FROM user_activity WHERE user_id='{uid}' AND day IN ('{old_day}','{keep_day}')")
days_left = sorted(x["day"] for x in after_activity)
check("4d 91 天前的活動紀錄被清掉、89 天前的保留", days_left == [keep_day], days_left)

rl_left = sql("SELECT key FROM rate_limits WHERE key IN ('verify_test_old','verify_test_keep')")
rl_keys = sorted(x["key"] for x in rl_left)
check("4e 過期限流計數被清掉、未過期的保留", rl_keys == ["verify_test_keep"], rl_keys)

geo_left = sql("SELECT user_id FROM user_geo WHERE user_id IN ('geo-test-old','geo-test-keep')")
geo_ids = sorted(x["user_id"] for x in geo_left)
check("4f 90 天沒登入的地區紀錄被清掉、活躍的保留", geo_ids == ["geo-test-keep"], geo_ids)

admin_log_row = sql("SELECT action, target, detail FROM admin_log WHERE admin_id='system' AND action='清理過期紀錄' ORDER BY id DESC LIMIT 1")[0]
check("4g 清理有寫操作紀錄（admin_log）", admin_log_row["action"] == "清理過期紀錄", admin_log_row)

sql("DELETE FROM user_geo WHERE user_id IN ('geo-test-old','geo-test-keep')")
sql("DELETE FROM rate_limits WHERE key IN ('verify_test_old','verify_test_keep')")

print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} 過")
Path(__file__).with_name("驗收紀錄_本機.json").write_text(json.dumps({"share_no": N, "checks": [{"name": n, "ok": ok} for n, ok in res]}, ensure_ascii=False, indent=2), encoding="utf-8")
sys.exit(0 if all(ok for _, ok in res) else 1)
