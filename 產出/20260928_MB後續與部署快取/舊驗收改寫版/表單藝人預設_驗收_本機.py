# 表單藝人預設＋疑似重複藝人：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8787> <網站資料夾>
# 本機資料不清空：每次重跑自己建一批新會員、新藝人（名稱帶時間戳），只驗這批。
import json, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from PIL import Image
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
OUT = Path(__file__).parent
res = []
STAMP = str(int(time.time()))[-6:]
NOW = datetime.now(timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"
TT = "XXXX.DUMMY.TOKEN.XXXX"


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:400]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", cmd],
        cwd=SITE, capture_output=True, text=True,
    )
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    out = json.loads(r.stdout[r.stdout.index("["):])
    return out[-1]["results"]


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email}


def H(u):
    return {"Authorization": f"Bearer {u['tok']}"}


admin = login("admin@demo.yinzang.test")
AH = H(admin)
PW = sql("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")[0]["password_hash"]

# ================= 準備：測試藝人＋收藏＋一位新會員 =================
# 12 位「site-recent」測試藝人（各一則收藏），確保池子一定超過 10 位好驗證「最多 10 位＋更多」
POOL_ARTISTS = [f"fap-pool-{STAMP}-{i}" for i in range(12)]
HIDDEN_ARTIST = f"fap-hidden-{STAMP}"  # 完全沒有收藏、沒有廠牌強制顯示：只能靠搜尋找到
MEMBER_ARTIST = f"fap-member-{STAMP}"  # 給新會員自己選過、驗「排最前面」

stmts = [f"INSERT INTO artists (slug, name, status, display) VALUES ('{s}', '表單池藝人{STAMP}_{i}', 'approved', 'auto')" for i, s in enumerate(POOL_ARTISTS)]
stmts.append(f"INSERT INTO artists (slug, name, status, display) VALUES ('{HIDDEN_ARTIST}', '表單隱藏藝人{STAMP}', 'approved', 'auto')")
stmts.append(f"INSERT INTO artists (slug, name, status, display) VALUES ('{MEMBER_ARTIST}', '表單會員藝人{STAMP}', 'approved', 'auto')")
sql(";\n".join(stmts))

PH = sql("SELECT r2_key, thumb_key, content_type, bytes, width, height FROM photos WHERE purpose = 'share' AND deleted_at IS NULL LIMIT 1")[0]


def add_share(author_id, about_names, no_suffix):
    at = iso(NOW - timedelta(minutes=30) + timedelta(seconds=no_suffix))
    about_json = json.dumps(about_names, ensure_ascii=False).replace("'", "''")
    sql(f"INSERT INTO shares (author_id, what, kind, about, created_at, updated_at) VALUES "
        f"('{author_id}', '表單驗收{STAMP}_{no_suffix}', 'CD', '{about_json}', '{at}', '{at}')")
    no = sql(f"SELECT no FROM shares WHERE author_id = '{author_id}' ORDER BY no DESC LIMIT 1")[0]["no"]
    sql(f"INSERT INTO photos (id, owner_id, purpose, share_no, r2_key, thumb_key, content_type, bytes, width, height) VALUES "
        f"('fap{STAMP}-{no}', '{author_id}', 'share', {no}, '{PH['r2_key']}', '{PH['thumb_key']}', '{PH['content_type']}', {PH['bytes']}, {PH['width']}, {PH['height']})")
    return no


for i, slug in enumerate(POOL_ARTISTS):
    add_share(admin["id"], [f"表單池藝人{STAMP}_{i}"], i)

# 新會員（自己還沒發過任何收藏）
MEMBER_H = f"fapmem{STAMP}"
sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
    f"('u-{MEMBER_H}', '{MEMBER_H}@fap.test', '{iso(NOW)}', '{PW}', '{MEMBER_H}', '新會員{STAMP}', '{iso(NOW)}', '{iso(NOW)}')")
member = login(f"{MEMBER_H}@fap.test")
MH = H(member)

# ================= 1. 預設清單：只列池子藝人、最多 10 位，隱藏藝人不出現 =================
html = requests.get(B + "/share/new").text
check("1 隱藏藝人（沒收藏也不是廠牌）不在頁面原始回應裡（含 RSC payload）", f"表單隱藏藝人{STAMP}" not in html)
search_r = requests.get(B + "/api/artists/search?q=" + requests.utils.quote(f"表單隱藏藝人{STAMP}")).json()
check("1 隱藏藝人打字搜尋找得到", any(a["name"] == f"表單隱藏藝人{STAMP}" for a in search_r.get("artists", [])), search_r)
check("1 頁面有「更多」按鈕（池子超過 10 位）", "pick-more" in html and ">更多<" in html)
check("1 頁面帶「找不到？打字搜尋全部藝人」提示", "找不到？打字搜尋全部藝人" in html)

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page()
    pg.goto(B + "/share/new")
    pg.wait_for_load_state("networkidle")
    n_default = pg.locator("[data-testid=pick-artist] .pick-artist").count()
    check("1 沒按「更多」前，畫面上實際渲染剛好 10 個藝人按鈕", n_default == 10, n_default)
    # [改寫] 新表單沒有「更多」鈕（上傳表單 UX 定案：只列最近常發的 10 位，其他打字搜尋）；有才點
    if pg.locator("[data-testid=pick-more]").count():
        pg.locator("[data-testid=pick-more]").click()
    expanded_names = pg.locator("[data-testid=pick-artist] .pick-artist").all_inner_texts()
    this_run_all_shown = all(f"表單池藝人{STAMP}_{i}" in expanded_names for i in range(12))
    check("1 按「更多」後展開出其餘池子藝人（這次跑的 12 位都看得到）", this_run_all_shown, len(expanded_names))
    br.close()

# ================= 2. 會員自己選過的藝人排最前面 =================
add_share(member["id"], [f"表單會員藝人{STAMP}"], 100)
html2 = requests.get(B + "/share/new", headers=MH).text
# 抓 pick-artist 區塊裡藝人名稱出現的順序
block = re.search(r'data-testid="pick-artist".*?</div>', html2, re.S)
order = [m.start() for m in re.finditer(re.escape(f"表單會員藝人{STAMP}"), block.group(0))] if block else []
first_pool = block.group(0).find(f"表單池藝人{STAMP}_0") if block else -1
check("2 會員自己分享過的藝人排在池子藝人前面", block is not None and order and (first_pool < 0 or order[0] < first_pool), (order, first_pool))

# ================= 3. 疑似重複藝人：偵測、預覽、合併、資料守恆 =================
DUP_A, DUP_B = f"dupbase{STAMP}", f"dupext{STAMP}"
sql(f"INSERT INTO artists (slug, name, aliases, status, display) VALUES ('{DUP_A}', '疊字測試{STAMP}', '[]', 'approved', 'auto')")
sql(f"INSERT INTO artists (slug, name, aliases, status, display) VALUES ('{DUP_B}', '疊字測試{STAMP}加場版', '[]', 'approved', 'auto')")
# 給 B（lose）建一個系列＋一則收藏，等一下驗證合併後這則系列／收藏還在、只是換了主人
sql(f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status) VALUES "
    f"('{DUP_B}', 1, '重複驗收系列', '2020《重複驗收系列》專輯發行', '專輯發行', '[\"{DUP_B}\"]', '2020', '[]', 'approved')")
dup_share_no = add_share(admin["id"], [f"疊字測試{STAMP}加場版"], 200)
sql(f"UPDATE shares SET series_key = '{DUP_B}/1' WHERE no = {dup_share_no}")

before_series = sql("SELECT count(*) AS n FROM series")[0]["n"]
before_shares = sql("SELECT count(*) AS n FROM shares")[0]["n"]

pairs = requests.get(B + "/api/admin/duplicates", headers=AH).json()["pairs"]
hit = next((p for p in pairs if {p["a"]["slug"], p["b"]["slug"]} == {DUP_A, DUP_B}), None)
check("3 疑似重複清單抓到這組（名稱前綴／後綴包含關係）", hit is not None and hit["reason"] == "名稱前綴／後綴包含關係", hit)

prev = requests.post(B + "/api/admin/duplicates/preview", json={"keep": DUP_A, "lose": DUP_B}, headers=AH).json()
check("3 預覽合併算出會搬 1 個系列、1 則收藏", prev.get("series") == 1 and prev.get("shares") == 1, prev)

merge = requests.post(B + "/api/admin/duplicates/merge", json={"keep": DUP_A, "lose": DUP_B}, headers=AH).json()
check("3 合併成功回傳搬動筆數", merge.get("series") == 1 and merge.get("shares") == 1, merge)

after_series = sql("SELECT count(*) AS n FROM series")[0]["n"]
after_shares = sql("SELECT count(*) AS n FROM shares")[0]["n"]
check("3 合併只搬動不增減：系列、收藏總數合併前後一致", before_series == after_series and before_shares == after_shares, (before_series, after_series, before_shares, after_shares))

moved = sql(f"SELECT artist_slug, no FROM series WHERE artist_slug = '{DUP_A}' AND title = '重複驗收系列'")
check("3 系列搬到保留者底下、換了新流水號", len(moved) == 1, moved)
moved_share = sql(f"SELECT series_key FROM shares WHERE no = {dup_share_no}")[0]["series_key"]
check("3 收藏的 series_key 換成新鍵", moved_share == f"{DUP_A}/{moved[0]['no']}" if moved else False, moved_share)
redirect = sql(f"SELECT new_slug FROM artist_redirects WHERE old_slug = '{DUP_B}'")
check("3 lose 的識別碼寫進轉址表", redirect and redirect[0]["new_slug"] == DUP_A, redirect)
lose_row = sql(f"SELECT deleted_at FROM artists WHERE slug = '{DUP_B}'")
check("3 lose 那位藝人軟刪除", lose_row and lose_row[0]["deleted_at"], lose_row)
keep_aliases = json.loads(sql(f"SELECT aliases FROM artists WHERE slug = '{DUP_A}'")[0]["aliases"])
check("3 lose 的名稱併進 keep 的別名", f"疊字測試{STAMP}加場版" in keep_aliases, keep_aliases)

old_url = requests.get(B + f"/artist/{DUP_B}/1", allow_redirects=False)
check("3 舊網址 301 轉址到保留者", old_url.status_code in (301, 308) and DUP_A in old_url.headers.get("location", ""), (old_url.status_code, old_url.headers.get("location")))

# ---- 不是重複 ----
DIS_A, DIS_B = f"disa{STAMP}", f"disb{STAMP}"
sql(f"INSERT INTO artists (slug, name, aliases, status, display) VALUES ('{DIS_A}', '不重複測試{STAMP}', '[]', 'approved', 'auto')")
sql(f"INSERT INTO artists (slug, name, aliases, status, display) VALUES ('{DIS_B}', '不重複測試{STAMP}延伸版', '[]', 'approved', 'auto')")
pairs2 = requests.get(B + "/api/admin/duplicates", headers=AH).json()["pairs"]
before_hit = next((p for p in pairs2 if {p["a"]["slug"], p["b"]["slug"]} == {DIS_A, DIS_B}), None)
check("3 標記前這組會出現", before_hit is not None, before_hit)
requests.post(B + "/api/admin/duplicates/dismiss", json={"a": DIS_A, "b": DIS_B}, headers=AH)
pairs3 = requests.get(B + "/api/admin/duplicates", headers=AH).json()["pairs"]
after_hit = next((p for p in pairs3 if {p["a"]["slug"], p["b"]["slug"]} == {DIS_A, DIS_B}), None)
check("3 標記「不是重複」後不再出現", after_hit is None, after_hit)

# ================= 4. 完整發文流程：搜尋選一位不在預設清單裡的藝人 =================
photo = SITE / ".wrangler" / "verify-fap-photo.jpg"
Image.new("RGB", (1600, 1200), (60, 90, 140)).save(photo, "JPEG", quality=90)
NEW_ARTIST_SLUG = f"fap-new-{STAMP}"
NEW_ARTIST_NAME = f"表單新選藝人{STAMP}"
sql(f"INSERT INTO artists (slug, name, status, display) VALUES ('{NEW_ARTIST_SLUG}', '{NEW_ARTIST_NAME}', 'approved', 'auto')")

errs = []
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": member["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    pg.goto(B + "/share/new")
    pg.wait_for_load_state("networkidle")
    check("4 新藝人不在預設按鈕裡", pg.locator("[data-testid=pick-artist] .pick-artist", has_text=NEW_ARTIST_NAME).count() == 0)
    # [改寫] 搜尋框 testid=artist-search、選項 artist-opt；打完整名字（前 6 字「表單新選藝人」本機已有 12 位同字首的舊測試藝人，新表單建議最多 5 個）
    pg.locator("[data-testid=artist-search]").fill(NEW_ARTIST_NAME)
    pg.locator(f"[data-testid=artist-opt][data-slug='{NEW_ARTIST_SLUG}']").click()
    # [改寫] 選好的藝人從 chip 改成答案黑框 bar-about（判斷一樣是「這位被選到、畫面上只有一個」）
    check("4 打字搜尋選到後變成 chip", pg.locator("[data-testid=bar-about]", has_text=NEW_ARTIST_NAME).count() == 1)
    pg.locator("input[type=file]").first.set_input_files(str(photo))
    # 2026-09-28 多張照片改版：上傳完成的標記從 .drop.has-photo 換成 [data-testid=pp-tile][data-status=done]
    pg.wait_for_function("() => document.querySelector('[data-testid=pp-tile][data-status=done]')", timeout=30000)
    pg.locator("[data-testid=pick-kind] .pick", has_text="其他周邊").click()
    pg.locator("#share-form-kind-note").fill(f"驗收{STAMP}")
    # [改寫] 新表單「屬於哪裡」選不確定；送出鈕 share-submit
    pg.locator("[data-testid=where-unsure]").click()
    pg.wait_for_function("() => !document.querySelector('[data-testid=share-submit]').disabled", timeout=30000)
    pg.locator("[data-testid=share-submit]").click()
    pg.wait_for_url(re.compile(r"/share/\d+$"), timeout=20000)
    pg.wait_for_load_state("networkidle")
    N = int(pg.url.rsplit("/", 1)[1])
    check("4 發布成功、跳到單則頁", N > 0, pg.url)

    pg.goto(B + f"/artist/{NEW_ARTIST_SLUG}")
    pg.wait_for_load_state("networkidle")
    check("4 藝人頁出現剛剛那則收藏", pg.locator(f"a[href='/share/{N}']").count() >= 1)

    pg.goto(B + "/share/new")
    pg.wait_for_load_state("networkidle")
    check("4 這位藝人現在自然出現在預設清單裡", pg.locator("[data-testid=pick-artist] .pick-artist", has_text=NEW_ARTIST_NAME).count() >= 1)
    check("4 全程 console error 0", len(errs) == 0, "; ".join(errs[:3]))
    ctx.close()
    br.close()

ok = sum(1 for r in res if r["ok"])
print(f"\n{ok}/{len(res)} 通過")
(OUT / "result.json").write_text(json.dumps({"stamp": STAMP, "checks": res}, ensure_ascii=False, indent=2), encoding="utf-8")
if ok != len(res):
    sys.exit(1)
