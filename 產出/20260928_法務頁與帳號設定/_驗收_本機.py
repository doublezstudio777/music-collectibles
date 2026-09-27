# 法務頁＋刪帳申請制＋改暱稱＋大頭貼：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 本機資料不清空：每次重跑自己建一批新會員（帳號名帶時間戳），只驗這批。
import io, json, re, sqlite3, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from PIL import Image
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
res = []
ST = str(int(time.time()))[-6:]
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
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def one(cmd):
    r = sql(cmd)
    return list(r[0].values())[0] if r else None


def r2_has(key):
    d = SITE / ".wrangler/state/v3/r2/miniflare-R2BucketObject"
    for f in d.glob("*.sqlite"):
        if f.name == "metadata.sqlite":
            continue
        con = sqlite3.connect(f"file:{f}?mode=ro", uri=True)
        try:
            row = con.execute("SELECT 1 FROM _mf_objects WHERE key = ?", (key,)).fetchone()
        finally:
            con.close()
        if row:
            return True
    return False


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
cv = lambda: one("SELECT v FROM content_version WHERE id = 1")
r2b = lambda: one("SELECT value FROM counters WHERE key = 'r2_bytes'") or 0

admin = login("admin@demo.yinzang.test")
AH = H(admin)
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")


def mkuser(tag, name=None, verified=True):
    h = f"ac{tag}{ST}"
    uid = f"u-{h}"
    nm = (name or f"帳設{tag}{ST}").replace("'", "''")
    ver = "'" + iso(NOW) + "'" if verified else "NULL"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@acc.test', {ver}, '{PW}', '{h}', '{nm}', '{iso(NOW)}', '{iso(NOW)}')")
    return login(f"{h}@acc.test")


def img_bytes(w, h, fmt="WEBP", color=(200, 80, 20)):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, fmt, quality=80)
    return b.getvalue()


def upload_share_photo(u, color):
    main, thumb = img_bytes(1200, 900, color=color), img_bytes(480, 360, color=color)
    r = requests.post(B + "/api/uploads", headers=H(u), files={"image": ("p.webp", main, "image/webp"), "thumb": ("t.webp", thumb, "image/webp")}, data={"purpose": "share"})
    return r.json()


def make_share(u, color=(30, 120, 200)):
    up = upload_share_photo(u, color)
    sql(f"INSERT INTO shares (author_id, what, kind, about, created_at, updated_at) VALUES ('{u['id']}', '帳設驗收{ST}_{u['handle']}', 'CD', '[]', '{iso(NOW)}', '{iso(NOW)}')")
    no = one(f"SELECT no FROM shares WHERE author_id = '{u['id']}' ORDER BY no DESC LIMIT 1")
    sql(f"UPDATE photos SET share_no = {no} WHERE id = '{up['id']}'")
    return no, up


def put_avatar(u, data, ctype="image/webp"):
    return requests.post(B + "/api/me/avatar", headers=H(u), files={"image": ("a.webp", data, ctype)})


# 貢獻者名單只列前 10 位：挑一個還很少人貢獻的系列（編輯紀錄與炫收藏合計 5 人以下）
SER = sql("""SELECT s.artist_slug AS a, s.no AS n FROM series s JOIN artists ar ON ar.slug = s.artist_slug
  WHERE s.status = 'approved' AND s.deleted_at IS NULL AND s.hidden_at IS NULL AND ar.hidden_at IS NULL AND ar.deleted_at IS NULL AND ar.display = 'on'
  AND (SELECT COUNT(DISTINCT author_id) FROM revisions r WHERE r.target = 'series:' || s.artist_slug || '/' || s.no) +
      (SELECT COUNT(DISTINCT author_id) FROM shares x WHERE x.series_key = s.artist_slug || '/' || s.no) < 5
  ORDER BY s.id DESC LIMIT 1""")[0]
SKEY = f"{SER['a']}/{SER['n']}"

# ============================ 1. 法務頁 ============================
pv = requests.get(B + "/privacy")
tm = requests.get(B + "/terms")
pt, tt = pv.text, tm.text
check("1a /privacy、/terms 都 200", pv.status_code == 200 and tm.status_code == 200, (pv.status_code, tm.status_code))
pt, tt = pt.replace("<!-- -->", ""), tt.replace("<!-- -->", "")
check("1b 兩頁頁首都標「草稿，待律師確認」與最後更新日期", all("草稿，待律師確認" in x and "最後更新 2026-09-28" in x for x in (pt, tt)))
PRIV_ITEMS = ["連線國家", "註冊國家、最近一次登入的國家與時間", "每日活動紀錄", "所在地區", "瀏覽次數", "IP 位址", "管理員看得到什麼", "浮水印"]
check("1c 隱私權政策涵蓋防盜版 README 的 8 項", all(k in pt for k in PRIV_ITEMS), [k for k in PRIV_ITEMS if k not in pt])
check("1d 隱私權政策寫明活動紀錄 90 天、公開到國家層級、不販售、當事人權利與申請方式",
      all(k in pt for k in ["90 天", "只顯示到國家", "不販售", "你的權利與申請方式", "申請刪除帳號"]))
TERMS = ["只提供撮合", "不經手金錢與商品", "交易僅限台灣地區", "盜版、仿冒品", "著作權屬於你", "產生縮圖、分享用的預覽圖", "CC BY-SA 4.0", "沒有金錢價值", "停權", "已刪除的會員", "照片預設保留"]
check("1e 使用條款涵蓋指定的 8 類內容", all(k in tt for k in TERMS), [k for k in TERMS if k not in tt])
body_txt = lambda h: re.sub(r"<[^>]+>", "", re.search(r'<main class="wrap page page-narrow legal">(.*?)</main>', h, re.S).group(1))
bad = [w for w in ["視頻", "信息", "默認", "質量", "通過", "項目", "以下", "本頁", "本文", "接下來", "——", "值得注意", "綜上"] for x in (body_txt(pt), body_txt(tt)) if w in x]
check("1f 兩頁內文沒有中國用語、路標句、破折號", not bad, bad)
home = requests.get(B + "/").text
check("1g 頁尾有隱私權政策、使用條款連結", 'href="/privacy"' in home and 'href="/terms"' in home)
requests.get(B + "/privacy")
h2 = requests.get(B + "/privacy")
check("1h /privacy 進整頁快取（第二次 HIT）", h2.headers.get("x-yz-cache") == "HIT", h2.headers.get("x-yz-cache"))

# ============================ 3. 暱稱（先做，後面刪帳要用改名紀錄） ============================
N1 = mkuser("n1", f"Mix Name{ST}")
# 註冊：跟 N1 同名的變體（大小寫、空白、全形）都擋
def reg(tag, name):
    sql("DELETE FROM rate_limits WHERE key LIKE 'register:%'")  # 註冊每小時 10 次的限制，驗收連續註冊會撞到
    return requests.post(B + "/api/auth/register", json={"email": f"reg{tag}{ST}@acc.test", "password": "yinzang-demo", "handle": f"reg{tag}{ST}", "name": name, "turnstileToken": TT})

fw = "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c for c in f"mixname{ST}")
variants = [f"mix name{ST}", f"MIXNAME{ST}", f" Mix  Name{ST} ", fw]
codes = [(v, reg(f"v{i}", v).json().get("error", {}).get("code")) for i, v in enumerate(variants)]
check("3a 註冊：大小寫、空白、全形半形不同的同名都擋（NAME_TAKEN）", all(c == "NAME_TAKEN" for _, c in codes), codes)
rsv = [(n, reg(f"r{i}", n).json().get("error", {}).get("code")) for i, n in enumerate(["已刪除的會員", "館長", "音藏小幫手", "ＡＤＭＩＮ", "官方"])]
check("3b 註冊：保留字（已刪除的會員、館長、音藏、admin、官方）都擋（NAME_RESERVED）", all(c == "NAME_RESERVED" for _, c in rsv), rsv)
ok = reg("ok", f"新暱稱{ST}")
check("3c 註冊：不重複的暱稱照常成功，name_key 有寫", ok.status_code == 201 and one(f"SELECT name_key FROM users WHERE handle = 'regok{ST}'") == f"新暱稱{ST}", ok.text[:200])

# 改暱稱
p1 = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": f"改後{ST}"})
check("3d 設定頁改暱稱成功，下次可改時間約 30 天後", p1.status_code == 200 and p1.json()["user"]["name"] == f"改後{ST}" and p1.json()["user"]["nameNextAt"], p1.text[:200])
nxt = datetime.fromisoformat(p1.json()["user"]["nameNextAt"].replace("Z", "+00:00"))
check("3e 下次可改時間＝現在＋30 天（誤差 1 小時內）", abs((nxt - datetime.now(timezone.utc)).total_seconds() - 30 * 86400) < 3600, nxt)
p2 = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": f"再改{ST}"})
check("3f 30 天內第二次改名被擋（429 NAME_CHANGE_LIMIT）", p2.status_code == 429 and p2.json()["error"]["code"] == "NAME_CHANGE_LIMIT", p2.text[:200])
p2b = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": f"改後{ST}"})
check("3g 送出同一個名字不算改名（200，不寫 users）", p2b.status_code == 200)
sql(f"UPDATE users SET name_changed_at = '{iso(NOW - timedelta(days=31))}' WHERE id = '{N1['id']}'")
N2 = mkuser("n2", f"撞名對象{ST}")
p3 = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": f"撞名 對象{ST}"})
check("3h 改成別人的暱稱（差一個空白）被擋 409", p3.status_code == 409 and p3.json()["error"]["code"] == "NAME_TAKEN", p3.text[:200])
p4 = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": "館長本人"})
check("3i 改成含保留字的暱稱被擋 400", p4.status_code == 400 and p4.json()["error"]["code"] == "NAME_RESERVED", p4.text[:200])
p5 = requests.patch(B + "/api/me/profile", headers=H(N1), json={"name": f"三十天後{ST}"})
check("3j 滿 30 天後可以再改", p5.status_code == 200, p5.text[:200])
hist = sql(f"SELECT old_name, new_name FROM user_name_changes WHERE user_id = '{N1['id']}' ORDER BY id")
check("3k 改名紀錄兩筆（舊名→新名）", [(h["old_name"], h["new_name"]) for h in hist] == [(f"Mix Name{ST}", f"改後{ST}"), (f"改後{ST}", f"三十天後{ST}")], hist)
am = requests.get(B + "/api/admin/members?q=" + requests.utils.quote(f"三十天後{ST}"), headers=AH).json()
row = next((m for m in am["members"] if m["id"] == N1["id"]), None)
names_api = requests.get(B + f"/api/admin/members?names={N1['id']}", headers=AH).json()
check("3l 後台會員列表顯示改名 2 次，點開有兩筆紀錄", row and row["renames"] == 2 and len(names_api["names"]) == 2, (row and row["renames"], names_api))
deny = requests.get(B + f"/api/admin/members?names={N1['id']}", headers=H(N2))
check("3m 一般會員查改名紀錄 403", deny.status_code == 403, deny.status_code)
check("3n 改名紀錄不出現在公開個人頁", f"改後{ST}" not in requests.get(B + f"/u/{N1['handle']}").text)

# 整頁快取：改名後單則頁換新名字
C1 = mkuser("c1", f"快取舊名{ST}")
# 用 SQL 建的會員沒有 name_key（真的註冊會有）；先補上，量版本號時才不會多算一次補值的寫入
sql(f"UPDATE users SET name_key = '快取舊名{ST}' WHERE id = '{C1['id']}'")
cno, _ = make_share(C1)
requests.get(B + f"/share/{cno}")
r_hit = requests.get(B + f"/share/{cno}")
v0 = cv()
requests.patch(B + "/api/me/profile", headers=H(C1), json={"name": f"快取新名{ST}"})
r_new = requests.get(B + f"/share/{cno}")
r_new2 = requests.get(B + f"/share/{cno}")
check("3o 改名前單則頁是快取 HIT", r_hit.headers.get("x-yz-cache") == "HIT", r_hit.headers.get("x-yz-cache"))
check("3p 改名讓內容版本 +1", cv() == v0 + 1, (v0, cv()))
check("3q 改名後第一次打單則頁 MISS 且已是新名字、沒有舊名字",
      r_new.headers.get("x-yz-cache") == "MISS" and f"快取新名{ST}" in r_new.text and f"快取舊名{ST}" not in r_new.text, r_new.headers.get("x-yz-cache"))
check("3r 之後再打回到 HIT，仍是新名字", r_new2.headers.get("x-yz-cache") == "HIT" and f"快取新名{ST}" in r_new2.text)

# ============================ 4. 大頭貼 ============================
A1 = mkuser("a1", f"頭貼一號{ST}")
b0 = r2b()
bad_size = put_avatar(A1, img_bytes(300, 300))
bad_fmt = put_avatar(A1, b"GIF89a" + b"0" * 100, "image/gif")
check("4a 不是 256×256 → 400；不是 WebP/JPEG → 415", bad_size.status_code == 400 and bad_fmt.status_code == 415, (bad_size.status_code, bad_fmt.status_code))
av1 = img_bytes(256, 256, color=(10, 200, 10))
u1 = put_avatar(A1, av1)
k1 = u1.json().get("key", "")
check("4b 上傳 256×256 WebP 成功，存成 v/{id}.webp", u1.status_code == 201 and re.fullmatch(r"v/[A-Za-z0-9_-]+\.webp", k1), u1.text[:200])
check("4c R2 容量計數＋這張的大小", r2b() - b0 == len(av1), (b0, r2b(), len(av1)))
prow = sql(f"SELECT purpose, width, height, bytes, r2_key = thumb_key AS same FROM photos WHERE r2_key = '{k1}'")[0]
check("4d photos 記一列：purpose=avatar、256×256、主圖＝縮圖同一個檔", prow["purpose"] == "avatar" and prow["width"] == 256 and prow["height"] == 256 and prow["same"] == 1, prow)
g1 = requests.get(B + f"/img/{k1}")
check("4e 大頭貼沒登入也看得到（200 image/webp）", g1.status_code == 200 and g1.headers.get("content-type") == "image/webp", (g1.status_code, g1.headers.get("content-type")))
check("4f R2 裡有這個檔", r2_has(k1))
me = requests.get(B + "/api/me", headers=H(A1)).json()
check("4g /api/me 帶大頭貼網址", me["user"]["avatar"] == f"/img/{k1}", me["user"].get("avatar"))
av2 = img_bytes(256, 256, color=(200, 10, 200))
b1 = r2b()
u2 = put_avatar(A1, av2)
k2 = u2.json().get("key", "")
check("4h 換一張：新檔上去，舊檔 photos 標刪除", u2.status_code == 201 and one(f"SELECT deleted_at IS NOT NULL FROM photos WHERE r2_key = '{k1}'") == 1, u2.text[:200])
check("4i 換掉的舊檔從 R2 刪除、網址 404", not r2_has(k1) and requests.get(B + f"/img/{k1}").status_code == 404)
check("4j R2 容量計數＝＋新檔－舊檔", r2b() - b1 == len(av2) - len(av1), (b1, r2b()))
# 每天 5 次（這位已經換 2 次）
lim = [put_avatar(A1, img_bytes(256, 256, color=(i * 40, 0, 0))).status_code for i in range(4)]
check("4k 一天第 6 次換大頭貼被擋 429（前 5 次都 201）", lim == [201, 201, 201, 429], lim)
cur = one(f"SELECT avatar_key FROM users WHERE id = '{A1['id']}'")
live = one(f"SELECT COUNT(*) FROM photos WHERE owner_id = '{A1['id']}' AND purpose = 'avatar' AND deleted_at IS NULL")
check("4l 換了 5 次後只剩 1 張有效的大頭貼", live == 1, live)

# 顯示位置：留言、出價列表、貢獻者名單、個人頁、頭像選單
X = mkuser("x1", f"收藏主{ST}")
xno, _ = make_share(X)
sql(f"INSERT INTO comments (share_no, author_id, body) VALUES ({xno}, '{A1['id']}', '大頭貼留言{ST}')")
sql(f"INSERT INTO threads (share_no, buyer_id) VALUES ({xno}, '{A1['id']}')")
tid = one(f"SELECT id FROM threads WHERE share_no = {xno} AND buyer_id = '{A1['id']}'")
sql(f"UPDATE shares SET sale_state = 'offer' WHERE no = {xno}")
sql(f"INSERT INTO offers (share_no, buyer_id, thread_id, kind, price) VALUES ({xno}, '{A1['id']}', {tid}, 'offer', 500)")
sql(f"INSERT INTO revisions (target, field, content, summary, author_id) VALUES ('series:{SKEY}', 'body', '[\"帳設驗收\"]', '驗收', '{A1['id']}')")
cm = requests.get(B + f"/api/comments?share={xno}").json()
ca = next((c for c in cm.get("comments", []) if c["body"] == f"大頭貼留言{ST}"), None)
check("4m 留言 API 帶大頭貼", ca and ca["author"].get("avatar") == f"/img/{cur}", ca)
sh = requests.get(B + f"/share/{xno}").text
check("4n 單則頁出價列表是大頭貼圖片", f'src="/img/{cur}"' in sh, cur)
sp = requests.get(B + f"/artist/{SKEY}").text
check("4o 系列頁資料貢獻者是大頭貼圖片", f'src="/img/{cur}"' in sp)
up = requests.get(B + f"/u/{A1['handle']}").text
check("4p 個人頁是大頭貼圖片", f'src="/img/{cur}"' in up)
nop = requests.get(B + f"/u/{X['handle']}").text
check("4q 沒有大頭貼的人沿用暱稱字樣頭像", 'class="ava ava-lg"' in nop and "收" in re.search(r'class="ava ava-lg"[^>]*>(.*?)<', nop).group(1))

# 檢舉＋管理員移除
pid = cur[2:].split(".")[0]
R1 = mkuser("r1", f"檢舉人{ST}")
selfrep = requests.post(B + "/api/reports", headers=H(A1), json={"target": f"avatar:{pid}", "reason": "improper"})
rep = requests.post(B + "/api/reports", headers=H(R1), json={"target": f"avatar:{pid}", "reason": "improper"})
check("4r 檢舉別人的大頭貼 201；檢舉自己的 403", rep.status_code == 201 and selfrep.status_code == 403, (rep.status_code, selfrep.status_code))
ov = requests.get(B + "/api/admin/stats", headers=AH).json()
check("4s 儀表板「被檢舉的大頭貼」≥1", ov["queue"].get("avatars", 0) >= 1, ov["queue"])
b2 = r2b()
v1 = cv()
rm = requests.post(B + "/api/admin/avatar", headers=AH, json={"id": A1["id"]})
check("4t 管理員移除大頭貼成功", rm.status_code == 200, rm.text[:200])
check("4u 移除後：users 沒有大頭貼、photos 標刪除、R2 檔刪掉、網址 404",
      one(f"SELECT avatar_key FROM users WHERE id = '{A1['id']}'") is None and one(f"SELECT deleted_at IS NOT NULL FROM photos WHERE r2_key = '{cur}'") == 1
      and not r2_has(cur) and requests.get(B + f"/img/{cur}").status_code == 404)
bytes_cur = one(f"SELECT bytes FROM photos WHERE r2_key = '{cur}'")
check("4v R2 容量計數扣回這張的大小", b2 - r2b() == bytes_cur, (b2, r2b(), bytes_cur))
check("4w 移除寫操作紀錄「移除大頭貼」", one(f"SELECT COUNT(*) FROM admin_log WHERE action = '移除大頭貼' AND target = 'user:{A1['handle']}'") == 1)
check("4x 移除讓內容版本 +1（頁面換成字樣頭像）", cv() > v1 and f'src="/img/{cur}"' not in requests.get(B + f"/u/{A1['handle']}").text)
ov2 = requests.get(B + "/api/admin/stats", headers=AH).json()
check("4y 移除後不再列在被檢舉的大頭貼", ov2["queue"].get("avatars", 0) == ov["queue"].get("avatars", 0) - 1, (ov["queue"].get("avatars"), ov2["queue"].get("avatars")))
# 保留
A2 = mkuser("a2", f"頭貼二號{ST}")
k3 = put_avatar(A2, img_bytes(256, 256, color=(0, 0, 250))).json()["key"]
pid3 = k3[2:].split(".")[0]
requests.post(B + "/api/reports", headers=H(R1), json={"target": f"avatar:{pid3}", "reason": "other", "note": "看起來像冒用"})
q1 = requests.get(B + "/api/admin/stats", headers=AH).json()["queue"].get("avatars", 0)
keep = requests.post(B + "/api/admin/targets", headers=AH, json={"target": f"avatar:{pid3}", "decision": "kept"})
q2 = requests.get(B + "/api/admin/stats", headers=AH).json()["queue"].get("avatars", 0)
check("4z 管理員按「保留」後不再列出、大頭貼還在", keep.status_code == 200 and q2 == q1 - 1 and requests.get(B + f"/img/{k3}").status_code == 200, (q1, q2))

# ============================ 2. 刪帳申請 ============================
def seed_member(tag):
    u = mkuser(tag, f"刪帳{tag}{ST}")
    requests.get(B + "/api/me", headers=H(u))  # 活動紀錄
    requests.post(B + "/api/auth/login", json={"email": u["email"], "password": "wrong-pass", "turnstileToken": TT})  # login:{email} 限流
    no, up = make_share(u, (90, 90, 90))
    k = put_avatar(u, img_bytes(256, 256, color=(1, 2, 3))).json()["key"]
    sql(f"INSERT INTO comments (share_no, author_id, body) VALUES ({xno}, '{u['id']}', '刪帳前的留言{tag}{ST}')")
    sql(f"INSERT INTO revisions (target, field, content, summary, author_id) VALUES ('series:{SKEY}', 'body', '[\"刪帳前\"]', '驗收', '{u['id']}')")
    sql(f"INSERT INTO deals (share_no, price, seller_id, buyer_id) VALUES ({no}, 800, '{u['id']}', '{X['id']}')")
    sql(f"INSERT INTO counters (key, value) VALUES ('quota:photo:{u['id']}:{NOW.date()}', 3)")
    sql(f"UPDATE users SET name_changed_at = NULL WHERE id = '{u['id']}'")
    requests.patch(B + "/api/me/profile", headers=H(u), json={"name": f"刪帳{tag}改{ST}"})
    return u, no, up, k


TABLES = {
    "users(本人)": "SELECT COUNT(*) FROM users WHERE id = '{id}' AND status = 'active'",
    "sessions": "SELECT COUNT(*) FROM sessions WHERE user_id = '{id}'",
    "user_geo": "SELECT COUNT(*) FROM user_geo WHERE user_id = '{id}'",
    "user_activity": "SELECT COUNT(*) FROM user_activity WHERE user_id = '{id}'",
    "rate_limits": "SELECT COUNT(*) FROM rate_limits WHERE key LIKE '%{id}%' OR key = 'login:{email}'",
    "counters": "SELECT COUNT(*) FROM counters WHERE key LIKE '%{id}%'",
    "user_name_changes": "SELECT COUNT(*) FROM user_name_changes WHERE user_id = '{id}'",
    "shares": "SELECT COUNT(*) FROM shares WHERE author_id = '{id}'",
    "comments": "SELECT COUNT(*) FROM comments WHERE author_id = '{id}'",
    "revisions": "SELECT COUNT(*) FROM revisions WHERE author_id = '{id}'",
    "deals": "SELECT COUNT(*) FROM deals WHERE seller_id = '{id}' OR buyer_id = '{id}'",
    "photos(照片，有效)": "SELECT COUNT(*) FROM photos WHERE owner_id = '{id}' AND purpose != 'avatar' AND deleted_at IS NULL",
    "photos(大頭貼，有效)": "SELECT COUNT(*) FROM photos WHERE owner_id = '{id}' AND purpose = 'avatar' AND deleted_at IS NULL",
}
counts = lambda u: {k: one(v.format(id=u["id"], email=u["email"])) for k, v in TABLES.items()}

D1, d1no, d1up, d1av = seed_member("d1")
D2, d2no, d2up, d2av = seed_member("d2")
D3 = mkuser("d3", f"刪帳d3{ST}")

# 設定頁：沒有自助刪除，只有小連結；申請要填原因
empty = requests.post(B + "/api/me/delete", headers=H(D1), json={"reason": "  "})
check("2a 沒填原因送出 400", empty.status_code == 400, empty.text[:200])
rq1 = requests.post(B + "/api/me/delete", headers=H(D1), json={"reason": f"不想用了{ST}"})
check("2b 填原因送出 201，帳號照常可用", rq1.status_code == 201 and requests.get(B + "/api/me", headers=H(D1)).json()["user"]["deletionRequested"] is True)
check("2c 重複申請 409", requests.post(B + "/api/me/delete", headers=H(D1), json={"reason": "again"}).status_code == 409)
requests.post(B + "/api/me/delete", headers=H(D2), json={"reason": f"本人要求連照片一起刪{ST}"})
requests.post(B + "/api/me/delete", headers=H(D3), json={"reason": "先申請再取消"})
cancel = requests.delete(B + "/api/me/delete", headers=H(D3))
check("2d 本人取消申請：狀態 cancelled、帳號標記清掉",
      cancel.status_code == 200 and one(f"SELECT status FROM deletion_requests WHERE user_id = '{D3['id']}'") == "cancelled"
      and one(f"SELECT deletion_requested_at FROM users WHERE id = '{D3['id']}'") is None)
lst = requests.get(B + "/api/admin/deletions", headers=AH).json()["list"]
p1r = next(d for d in lst if d["user"]["id"] == D1["id"] and d["status"] == "pending")
p2r = next(d for d in lst if d["user"]["id"] == D2["id"] and d["status"] == "pending")
check("2e 後台刪帳申請佇列列出原因、Email、炫收藏數、照片數", p1r["reason"] == f"不想用了{ST}" and p1r["user"]["email"] == D1["email"] and p1r["user"]["posts"] == 1 and p1r["user"]["photos"] == 1, p1r)
qd = requests.get(B + "/api/admin/stats", headers=AH).json()["queue"]
check("2f 儀表板顯示刪帳申請件數（＝待處理筆數）", qd.get("deletions") == sum(1 for d in lst if d["status"] == "pending"), qd.get("deletions"))
check("2g 一般會員打後台刪帳 API 403", requests.get(B + "/api/admin/deletions", headers=H(D3)).status_code == 403
      and requests.post(B + "/api/admin/deletions/execute", headers=H(D3), json={"id": p1r["id"], "confirm": D1["handle"]}).status_code == 403)
wrong = requests.post(B + "/api/admin/deletions/execute", headers=AH, json={"id": p1r["id"], "confirm": "wrong"})
check("2h 確認欄沒打對帳號名 400，什麼都沒刪", wrong.status_code == 400 and one(f"SELECT status FROM users WHERE id = '{D1['id']}'") == "active", wrong.text[:200])

before1 = counts(D1)
bytes0 = r2b()
av_bytes1 = one(f"SELECT bytes FROM photos WHERE r2_key = '{d1av}'")
thumb1 = d1up["thumbUrl"][5:]
share_c_before = one("SELECT COUNT(*) FROM shares")
ex1 = requests.post(B + "/api/admin/deletions/execute", headers=AH, json={"id": p1r["id"], "deletePhotos": False, "confirm": D1["handle"]})
after1 = counts(D1)
print("  D1 前", before1, "\n  D1 後", after1)
check("2i 執行（不勾照片）成功", ex1.status_code == 200, ex1.text[:300])
u1r = sql(f"SELECT email, password_hash, handle, name, bio, status, avatar_key, name_key, email_verified_at FROM users WHERE id = '{D1['id']}'")[0]
check("2j 帳號：Email、密碼換掉，暱稱「已刪除的會員」，帳號名是 del- 代號，狀態 deleted",
      u1r["email"].endswith("@deleted.invalid") and D1["email"] not in u1r["email"] and u1r["password_hash"] == "!deleted"
      and u1r["name"] == "已刪除的會員" and re.fullmatch(r"del-[a-z0-9]{10}", u1r["handle"]) and u1r["status"] == "deleted"
      and u1r["avatar_key"] is None and u1r["name_key"] is None and u1r["email_verified_at"] is None, u1r)
gone_keys = ["sessions", "user_geo", "user_activity", "rate_limits", "counters", "user_name_changes", "photos(大頭貼，有效)"]
check("2k 刪除前這些表都有資料（驗得到東西）", all(before1[k] > 0 for k in gone_keys), {k: before1[k] for k in gone_keys})
check("2l 個資清掉：session、國家、活動紀錄、限流與計數、改名紀錄、大頭貼 全部 0", all(after1[k] == 0 for k in gone_keys), {k: after1[k] for k in gone_keys})
kept = ["shares", "comments", "revisions", "deals", "photos(照片，有效)"]
check("2m 貢獻保留：炫收藏、留言、編輯紀錄、成交、照片 筆數不變", all(before1[k] == after1[k] and before1[k] > 0 for k in kept), {k: (before1[k], after1[k]) for k in kept})
check("2n 全站炫收藏總數不變", one("SELECT COUNT(*) FROM shares") == share_c_before)
check("2o 沒勾照片：收藏照片仍在 R2、網址 200", r2_has(thumb1) and requests.get(B + f"/img/{thumb1}").status_code == 200)
check("2p 大頭貼一律刪除：R2 沒有、網址 404", not r2_has(d1av) and requests.get(B + f"/img/{d1av}").status_code == 404)
check("2q R2 容量計數只扣大頭貼", bytes0 - r2b() == av_bytes1, (bytes0, r2b(), av_bytes1))
check("2r 舊 token 失效、舊 Email 密碼登不進去",
      requests.get(B + "/api/me", headers=H(D1)).json().get("user") is None
      and "token" not in requests.post(B + "/api/auth/login", json={"email": D1["email"], "password": "yinzang-demo", "turnstileToken": TT, "client": "app"}).json())
lg = sql(f"SELECT target, detail FROM admin_log WHERE action = '執行刪除帳號' AND target = 'user:{u1r['handle']}'")
check("2s 寫操作紀錄「執行刪除帳號」，紀錄裡沒有 Email", len(lg) == 1 and D1["email"] not in lg[0]["detail"], lg)
check("2t 舊的後台紀錄 target 改成新代號，找不到舊帳號名", one(f"SELECT COUNT(*) FROM admin_log WHERE target = 'user:{D1['handle']}'") == 0)
again = requests.post(B + "/api/admin/deletions/execute", headers=AH, json={"id": p1r["id"], "confirm": D1["handle"]})
check("2u 同一筆再執行 409（不能重來）", again.status_code == 409, again.status_code)
sp1 = requests.get(B + f"/share/{d1no}").text
check("2v 單則頁作者顯示「已刪除的會員」，沒有舊暱稱", "已刪除的會員" in sp1 and f"刪帳d1改{ST}" not in sp1)
cm1 = requests.get(B + f"/api/comments?share={xno}").json()["comments"]
check("2w 留言還在，作者顯示「已刪除的會員」", any(c["body"] == f"刪帳前的留言d1{ST}" and c["author"]["name"] == "已刪除的會員" for c in cm1))
check("2x 系列頁貢獻者名單照列「已刪除的會員」", "已刪除的會員" in requests.get(B + f"/artist/{SKEY}").text)
prof = requests.get(B + f"/u/{u1r['handle']}")
check("2y 個人頁（代號）200，只有「已刪除的會員」與炫收藏，沒有所在地區", prof.status_code == 200 and "已刪除的會員" in prof.text and "所在地區" not in prof.text and f"帳設驗收{ST}_{D1['handle']}" in prof.text)
check("2z 舊帳號名網址 404", requests.get(B + f"/u/{D1['handle']}").status_code == 404)

before2 = counts(D2)
bytes1 = r2b()
ph2 = sql(f"SELECT r2_key, thumb_key, og_key, bytes FROM photos WHERE owner_id = '{D2['id']}' AND deleted_at IS NULL")
tot2 = sum(p["bytes"] for p in ph2)
ex2 = requests.post(B + "/api/admin/deletions/execute", headers=AH, json={"id": p2r["id"], "deletePhotos": True, "confirm": D2["handle"]})
after2 = counts(D2)
print("  D2 前", before2, "\n  D2 後", after2)
check("2za 執行（勾照片）成功，回傳照片 1、大頭貼 1", ex2.status_code == 200 and ex2.json()["photos"] == 1 and ex2.json()["avatars"] == 1, ex2.text[:300])
check("2zb 勾照片：收藏照片標刪除、R2 檔全部刪掉、網址 404",
      after2["photos(照片，有效)"] == 0 and all(not r2_has(k) for p in ph2 for k in [p["r2_key"], p["thumb_key"]] if k)
      and requests.get(B + d2up["thumbUrl"]).status_code == 404)
check("2zc R2 容量計數扣回全部照片＋大頭貼", bytes1 - r2b() == tot2, (bytes1, r2b(), tot2))
check("2zd 勾照片仍保留炫收藏、留言、編輯紀錄、成交", all(before2[k] == after2[k] for k in ["shares", "comments", "revisions", "deals"]))
check("2ze 後台已處理清單顯示結果", any(d["id"] == p2r["id"] and d["status"] == "done" and d["deletePhotos"] for d in requests.get(B + "/api/admin/deletions", headers=AH).json()["list"]))
check("2zf 已刪除的名字不佔用暱稱：別人可以註冊跟刪帳前一樣的暱稱", reg("after", f"刪帳d2改{ST}").status_code == 201)

# ============================ 5. 畫面：1440／390 溢出、console、設定頁實際操作 ============================
S = mkuser("s1", f"設定頁{ST}")
src = io.BytesIO()
Image.new("RGB", (900, 500), (220, 120, 40)).save(src, "JPEG", quality=85)
(OUT / "_tmp_avatar_src.jpg").write_bytes(src.getvalue())
PAGES = [
    ("privacy", "/privacy", None), ("terms", "/terms", None), ("settings", "/settings", S), ("settings_delete", "/settings/delete", S),
    ("admin_deletions", "/admin/deletions", admin), ("admin_members", "/admin/members?x=" + ST, admin), ("admin_moderation", "/admin/moderation", admin),
    ("profile_avatar", f"/u/{A2['handle']}", R1), ("share_detail", f"/share/{xno}", None), ("series", f"/artist/{SKEY}", None),
    ("profile_deleted", f"/u/{u1r['handle']}", None),
]
with sync_playwright() as p:
    br = p.chromium.launch()
    # 設定頁：實際選一張 900×500 JPEG，瀏覽器裁成 256×256 WebP 上傳
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": S["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text[:200]) if m.type == "error" else None)
    pg.goto(B + "/settings")
    pg.wait_for_selector("[data-testid=avatar-box]")
    check("5a 設定頁沒有自助刪除表單，只有「申請刪除帳號」小連結",
          pg.locator("[data-testid=delete-box]").count() == 0 and pg.locator("[data-testid=delete-link]").inner_text() == "申請刪除帳號")
    check("5b 設定頁顯示暱稱規則「每 30 天可以改一次」", "每 30 天可以改一次" in pg.locator("[data-testid=name-rule]").inner_text())
    pg.set_input_files("[data-testid=avatar-input]", str(OUT / "_tmp_avatar_src.jpg"))
    pg.wait_for_selector("[data-testid=me-avatar] img", timeout=15000)
    sk = one(f"SELECT avatar_key FROM users WHERE id = '{S['id']}'")
    srow = sql(f"SELECT content_type, width, height FROM photos WHERE r2_key = '{sk}'")[0] if sk else {}
    check("5c 瀏覽器上傳：900×500 JPEG 裁成 256×256 WebP", srow == {"content_type": "image/webp", "width": 256, "height": 256}, srow)
    check("5d 頭像選單換成大頭貼圖片", pg.locator("[data-testid=me-avatar] img").get_attribute("src") == f"/img/{sk}")
    pg.fill("#set-name", f"設定頁改名{ST}")
    pg.click("[data-testid=name-box] button[type=submit]")
    # 2026-09-28 改：送出時輸入框會先停用（儲存中），改等「已儲存」出現再看鎖定
    pg.wait_for_selector("[data-testid=name-msg]", timeout=10000)
    pg.wait_for_selector("[data-testid=name-box] #set-name[disabled]", timeout=10000)
    check("5e 設定頁改名後輸入框鎖住、顯示下次可改日期", "以後可以再改" in pg.locator("[data-testid=name-rule]").inner_text())
    pg.click("[data-testid=delete-link]")
    pg.wait_for_selector("[data-testid=delete-form]")
    pg.click("[data-testid=delete-form] button[type=submit]")
    check("5f 申請頁沒填原因會提示", "寫一下想刪除帳號的原因" in pg.locator("[data-testid=delete-form]").inner_text())
    pg.fill("#del-reason", "畫面驗收")
    pg.click("[data-testid=delete-form] button[type=submit]")
    pg.wait_for_selector("[data-testid=delete-requested]")
    check("5g 送出後顯示處理中、可以取消，帳號沒有被刪", one(f"SELECT status FROM users WHERE id = '{S['id']}'") == "active")
    pg.click("[data-testid=delete-cancel]")
    pg.wait_for_selector("[data-testid=delete-form]")
    check("5h 取消後回到申請表單", one(f"SELECT status FROM deletion_requests WHERE user_id = '{S['id']}'") == "cancelled")
    check("5i 設定頁操作全程 console error 0", not errs, errs[:3])
    ctx.close()

    # 後台刪帳：畫面上勾照片 → 執行 → 打帳號名 → 確定
    D4, *_ = seed_member("d4")
    requests.post(B + "/api/me/delete", headers=H(D4), json={"reason": "畫面驗收刪帳"})
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": admin["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    pg.goto(B + "/admin/deletions")
    item = pg.locator("[data-testid=del-pending]", has_text=D4["handle"])
    item.locator("[data-testid=del-execute]").click()
    go = item.locator("[data-testid=del-confirm-go]")
    check("5j 二次確認：沒打帳號名「確定刪除」是灰的", go.is_disabled())
    item.locator("[data-testid=del-confirm]").fill(D4["handle"])
    go.click()
    pg.wait_for_function(f"() => !document.body.innerText.includes('@{D4['handle']}\\n') || document.querySelectorAll('[data-testid=del-pending]').length >= 0")
    time.sleep(1.5)
    check("5k 畫面執行後帳號已刪除、照片保留（沒勾）", one(f"SELECT status FROM users WHERE id = '{D4['id']}'") == "deleted"
          and one(f"SELECT COUNT(*) FROM photos WHERE owner_id = '{D4['id']}' AND purpose = 'share' AND deleted_at IS NULL") == 1)
    ctx.close()

    over, cerr = [], []
    for w in (1440, 390):
        for name, path, who in PAGES:
            ctx = br.new_context(viewport={"width": w, "height": 900})
            if who:
                ctx.add_cookies([{"name": "yz_session", "value": who["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
            pg = ctx.new_page()
            e = []
            pg.on("console", lambda m, e=e: e.append(m.text[:160]) if m.type == "error" else None)
            pg.goto(B + path)
            pg.wait_for_load_state("networkidle")
            pg.evaluate("document.fonts.ready")
            time.sleep(0.4)
            ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            if ov > 0:
                over.append((name, w, ov))
            if e:
                cerr.append((name, w, e[:2]))
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), full_page=True, type="jpeg", quality=80)
            ctx.close()
    check("5l 受影響頁面 1440／390 橫向溢出 0", not over, over)
    check("5m 受影響頁面 console error 0", not cerr, cerr)
    br.close()

(OUT / "_tmp_avatar_src.jpg").unlink(missing_ok=True)
passed = sum(r["ok"] for r in res)
print(f"\n{passed}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"at": iso(datetime.now(timezone.utc)), "passed": passed, "total": len(res), "results": res}, ensure_ascii=False, indent=1))
