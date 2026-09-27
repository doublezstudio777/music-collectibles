# 等級、分數、稱號＋小修：本機驗收（2026-09-28 定案修改：降低版門檻、收到留言、停權凍結、補資料擴大、停權原因、指定等級）。
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾>
# 本機資料不清空：每次重跑自己建一批新會員、新藝人、新系列（名稱帶時間戳），只驗這批人的分數。
# 「7 天後入帳」用管理員 API 的 now 參數模擬（只有本機 LOCAL_TEST=1 收這個參數）。
import json, re, subprocess, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B, SITE = sys.argv[1].rstrip("/"), Path(sys.argv[2])
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
res = []
STAMP = str(int(time.time()))[-6:]
NOW = datetime.now(timezone.utc)
iso = lambda d: d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


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


def q(s):
    return s.replace("'", "''")


def cv():
    return sql("SELECT v FROM content_version WHERE id = 1")[0]["v"]


def login(email):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX", "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email}


def H(u):
    return {"Authorization": f"Bearer {u['tok']}", "x-yz-test-country": "TW"}


admin = login("admin@demo.yinzang.test")
AH = H(admin)


def recompute(days=0):
    body = {"now": iso(NOW + timedelta(days=days, minutes=5))} if days else {}
    r = requests.post(B + "/api/admin/scores", json=body, headers=AH)
    assert r.ok, r.text
    return r.json()


def events(uid):
    return sql(f"SELECT kind, source, points, state, reason, detail FROM score_events WHERE user_id = '{uid}' ORDER BY id")


def total(uid):
    r = sql(f"SELECT score, pending FROM user_scores WHERE user_id = '{uid}'")
    return (r[0]["score"], r[0]["pending"]) if r else (0, 0)


def credited(evs, kind=None):
    return sum(e["points"] for e in evs if e["state"] == "credited" and (kind is None or e["kind"] == kind))


def count(evs, kind, state=None, reason="*"):
    return sum(1 for e in evs if e["kind"] == kind and (state is None or e["state"] == state) and (reason == "*" or e["reason"] == reason))


# ================= 準備：會員、藝人、系列、收藏 =================
PW = sql("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")[0]["password_hash"]
TAGS = ["a", "b", "c", "d", "e", "f", "p1", "p2", "p3", "l1", "h", "h2", "s", "bu", "k", "k2", "i", "x", "y", "y2", "z"]
TAGS += [f"r{n:02d}" for n in range(1, 12)] + [f"m{n:02d}" for n in range(1, 53)] + ["g", "o", "x2", "q"]
stmts = []
for t in TAGS:
    h = f"lv{STAMP}{t}"
    stmts.append(
        f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('u-{h}', '{h}@lvtest.test', '{iso(NOW)}', '{PW}', '{h}', '{t.upper()}{STAMP}', '{iso(NOW)}', '{iso(NOW)}')"
    )
sql(";\n".join(stmts))
U = {t: {"id": f"u-lv{STAMP}{t}", "handle": f"lv{STAMP}{t}", "email": f"lv{STAMP}{t}@lvtest.test"} for t in TAGS}
for t in ["a", "b", "c", "d", "e", "f", "h", "h2", "k", "k2", "z", "g", "o", "x2"] + [f"r{n:02d}" for n in range(1, 12)]:
    U[t].update(login(U[t]["email"]))

ART, ART2, ART3 = f"lvart{STAMP}", f"lvartb{STAMP}", f"lvartc{STAMP}"
# 借一張本機現有的照片（主圖、縮圖分開、沒有預覽圖），不用上傳；舊驗收「清快取＝主圖＋縮圖 2 個檔」才對得上
PH = sql("SELECT r2_key, thumb_key, content_type, bytes, width, height FROM photos WHERE purpose = 'share' AND deleted_at IS NULL AND og_key IS NULL AND r2_key != thumb_key ORDER BY created_at LIMIT 1")[0]
stmts = [
    f"INSERT INTO artists (slug, name, status, display, intro) VALUES ('{ART}', '等級藝人{STAMP}', 'approved', 'auto', '[\"這位藝人的初始簡介，第一段。\"]')",
    f"INSERT INTO artists (slug, name, status, display) VALUES ('{ART2}', '補年藝人{STAMP}', 'approved', 'auto')",
    f"INSERT INTO artists (slug, name, status, display) VALUES ('{ART3}', '同分藝人{STAMP}', 'approved', 'auto')",
]
# 藝人一：排序用（2019、待補、2024、2021）
for no, year, title in [(1, "2019", "系列一"), (2, "", "系列二"), (3, "2024", "系列三"), (4, "2021", "系列四")]:
    name = f"{year}《{title}{STAMP}》專輯發行"
    stmts.append(
        f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status, created_by) VALUES "
        f"('{ART}', {no}, '{title}{STAMP}', '{name}', '專輯發行', '[\"{ART}\"]', '{year}', '[\"{title}的初始正文。\"]', 'approved', NULL)"
    )
# 藝人二：補發行年用（1～6、8 是匯入的、沒有新增者；7 是 K 自己新增的；8 給 K2 驗「被改掉」）
for no in range(1, 9):
    owner = f"'{U['k']['id']}'" if no == 7 else "NULL"
    stmts.append(
        f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status, created_by) VALUES "
        f"('{ART2}', {no}, '補年{no}', '《補年{no}》專輯發行', '專輯發行', '[\"{ART2}\"]', '', '[]', 'approved', {owner})"
    )
stmts.append(
    f"INSERT INTO series (artist_slug, no, title, name, series_type, credits, year, body, status) VALUES "
    f"('{ART3}', 1, '同分系列', '2020《同分系列》專輯發行', '專輯發行', '[\"{ART3}\"]', '2020', '[\"同分系列的初始正文。\"]', 'approved')"
)
sql(";\n".join(stmts))

share_no = {}


def add_shares(tag, n, days_spread=None, ref=(), start=None):
    """用 SQL 建 n 則有照片的收藏；days_spread＝每則的「幾天前」"""
    stmts = []
    base = start or NOW - timedelta(minutes=30)
    for i in range(n):
        ago = days_spread[i] if days_spread else 0
        at = iso(base - timedelta(days=ago) + timedelta(seconds=i))
        stmts.append(
            f"INSERT INTO shares (author_id, what, kind, ref_photo, created_at, updated_at) VALUES "
            f"('{U[tag]['id']}', '等級驗收{tag}{i}', 'CD', {1 if i in ref else 0}, '{at}', '{at}')"
        )
    sql(";\n".join(stmts))
    rows = sql(f"SELECT no FROM shares WHERE author_id = '{U[tag]['id']}' ORDER BY no")
    nos = [r["no"] for r in rows]
    sql(";\n".join(
        f"INSERT INTO photos (id, owner_id, purpose, share_no, r2_key, thumb_key, content_type, bytes, width, height) VALUES "
        f"('lv{STAMP}-{no}', '{U[tag]['id']}', 'share', {no}, '{PH['r2_key']}', '{PH['thumb_key']}', '{PH['content_type']}', {PH['bytes']}, {PH['width']}, {PH['height']})"
        for no in nos
    ))
    share_no[tag] = nos
    return nos


add_shares("d", 7, ref=(0, 6))  # 今天 7 則：5 則有分；第 1、7 則勾辨識參考
add_shares("x", 12, days_spread=[3] * 5 + [2] * 5 + [1] * 2)
add_shares("p1", 10, days_spread=[4] * 5 + [3] * 5)
add_shares("p2", 15, days_spread=[4] * 5 + [3] * 5 + [2] * 5)
add_shares("p3", 1, days_spread=[2])
add_shares("y", 6, days_spread=[2] * 6)
add_shares("y2", 1, days_spread=[2])
add_shares("e", 1, days_spread=[2])
add_shares("f", 1, days_spread=[2])
add_shares("h2", 1, days_spread=[2])
add_shares("s", 1, days_spread=[2])
add_shares("i", 1, days_spread=[2])

# 互讚（P2→P1 10 個、P1→P2 15 個，分散在幾天，不碰每日上限）、52 人讚 X 的第 1 則、L1 讚 P3
stmts = []
for i, no in enumerate(share_no["p1"]):
    stmts.append(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U['p2']['id']}', {no}, '{iso(NOW - timedelta(days=3 if i < 5 else 2, hours=1) + timedelta(seconds=i))}')")
for i, no in enumerate(share_no["p2"]):
    d = 3 if i < 5 else 2 if i < 10 else 1
    stmts.append(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U['p1']['id']}', {no}, '{iso(NOW - timedelta(days=d) + timedelta(seconds=i))}')")
for n in range(1, 53):
    stmts.append(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U[f'm{n:02d}']['id']}', {share_no['x'][0]}, '{iso(NOW - timedelta(days=1) + timedelta(seconds=n))}')")
stmts.append(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U['l1']['id']}', {share_no['p3'][0]}, '{iso(NOW - timedelta(days=1))}')")
# 互留言：P1 在 P2 底下 7 則（4 天前）、P2 在 P1 底下 5 則（3 天前）
for i in range(7):
    stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({share_no['p2'][i]}, '{U['p1']['id']}', '互留言{i}', '{iso(NOW - timedelta(days=4) + timedelta(seconds=i))}')")
for i in range(5):
    stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({share_no['p1'][i]}, '{U['p2']['id']}', '互留言回{i}', '{iso(NOW - timedelta(days=3) + timedelta(seconds=i))}')")
# F 今天在 X 底下留 12 則（上限 10）、在自己底下留 1 則；Z 一則之後會被檢舉隱藏
# （一半在 X、一半在 D 底下，避開「同兩個帳號互留言」上限，只驗每日上限）
for i in range(12):
    tgt = share_no["x"][i] if i < 6 else share_no["d"][i - 6]
    stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({tgt}, '{U['f']['id']}', '今天的留言{i}', '{iso(NOW - timedelta(minutes=20) + timedelta(seconds=i))}')")
stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({share_no['f'][0]}, '{U['f']['id']}', '自己底下的留言', '{iso(NOW - timedelta(minutes=10))}')")
stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({share_no['x'][11]}, '{U['z']['id']}', '要被檢舉的留言{STAMP}', '{iso(NOW - timedelta(days=1))}')")
# 成交：S 賣給 BU 三次（上限 2），第 4 筆被作廢
for i in range(4):
    stmts.append(
        f"INSERT INTO deals (share_no, price, seller_id, buyer_id, sold_at, voided_at) VALUES ({share_no['s'][0]}, 1000, '{U['s']['id']}', '{U['bu']['id']}', "
        f"'{iso(NOW - timedelta(days=2) + timedelta(hours=i))}', {'NULL' if i < 3 else repr(iso(NOW - timedelta(days=1)))})"
    )
sql(";\n".join(stmts))

# ================= 1. 編輯 =================
def edit(u, target, paras, summary="驗收修改"):
    r = requests.post(B + "/api/revisions", json={"target": target, "content": paras, "summary": summary}, headers=H(u))
    return r


def shift_last(target, hours=2):
    sql(f"UPDATE revisions SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '-{hours} hours') WHERE id = (SELECT MAX(id) FROM revisions WHERE target = '{target}')")


S1, S3, S4 = f"series:{ART}/1", f"series:{ART}/3", f"series:{ART}/4"
AI = f"artist:{ART}"
T1 = f"series:{ART3}/1"
add50 = "補充這張專輯的錄音地點、參與樂手與首批壓片的包裝差異，方便收藏者辨認各版本。這段一共超過五十個字，確定不是極小修改。"
add200 = "再補一段長的：" + "首批壓片的側標為白底紅字，再版改為黑底白字，" * 10
r1 = edit(U["a"], S1, ["系列一的初始正文。", add50])
r2 = edit(U["a"], S1, ["系列一的初始正文。", add50, add200])
check("1a 編輯 API 成功", r1.status_code == 201 and r2.status_code == 201, (r1.status_code, r2.status_code, r1.text[:100]))
# B：只改標點與空白、再改 5 個字（連續編輯合併，總改動仍不到 10 字）
cur = ["系列一的初始正文。", add50, add200]
rb1 = edit(U["b"], S1, ["系列一的初始正文！！", add50.replace("，", "、"), add200])
rb2 = edit(U["b"], S1, ["系列一的初始正文！！五個字補", add50.replace("，", "、"), add200])
# B 在系列三改 30 字，C 把它還原
rb3 = edit(U["b"], S3, ["系列三的初始正文。", "這是一段會被還原的修改，內容大約三十個字左右，拿來驗還原。"])
# A 改藝人簡介 30 字（之後過了 7 天才被還原，不影響）
ra = edit(U["a"], AI, ["這位藝人的初始簡介，第一段。", "補上出道年份與代表作，還有主要合作的製作人名字。"])
# A 在系列四改 12 次（每次間隔超過 60 分鐘，不合併）：不設每日上限
ok12 = 0
body4 = ["系列四的初始正文。"]
for i in range(12):
    shift_last(S4)
    body4 = body4 + [f"第{i + 1}次補充：這一段有超過十個字的實際內容，編號{i + 1}。"]
    ok12 += edit(U["a"], S4, body4).status_code == 201
check("1b A 在系列四連續 12 次編輯都成功", ok12 == 12, ok12)
# 同分：A 先改同分系列一次，C 後改一次
edit(U["a"], T1, ["同分系列的初始正文。", "A 先補上的一段內容，超過十個字。"])
shift_last(T1)
edit(U["c"], T1, ["同分系列的初始正文。", "A 先補上的一段內容，超過十個字。", "C 後補上的一段內容，也超過十個字。"])

ev_b = events(U["b"]["id"])
b3 = [e for e in ev_b if e["kind"] == "edit" and json.loads(e["detail"])["target"] == S3][0]
base3 = json.loads(b3["detail"])["base"]
rv = requests.post(f"{B}/api/revisions/{base3}/revert", json={"summary": "還原驗收"}, headers=H(U["c"]))
check("1c C 還原系列三 API 成功", rv.status_code == 201, rv.text[:120])
cv_before_recompute = cv()
run0 = recompute()
check("1d 重算不讓 content_version 增加", cv() == cv_before_recompute, (cv_before_recompute, cv()))

ev_a = events(U["a"]["id"])
a_s1 = [e for e in ev_a if e["kind"] == "edit" and json.loads(e["detail"])["target"] == S1]
check("1e A 在系列一連續兩次編輯合併成一筆", len(a_s1) == 1, len(a_s1))
check("1f 合併後改動 200 字以上＝30 分", a_s1 and a_s1[0]["points"] == 30, a_s1 and json.loads(a_s1[0]["detail"]))
check("1g 編輯 7 天內是待入帳（pending），總分 0", all(e["state"] == "pending" for e in ev_a if e["kind"] == "edit") and total(U["a"]["id"])[0] == 0, total(U["a"]["id"]))
a_s4 = [e for e in ev_a if e["kind"] == "edit" and json.loads(e["detail"])["target"] == S4]
check("1h 系列四 12 次編輯＝12 筆，每筆 20 分（不設每日上限）", len(a_s4) == 12 and all(e["points"] == 20 for e in a_s4), [e["points"] for e in a_s4])
ev_b = events(U["b"]["id"])
b1 = [e for e in ev_b if e["kind"] == "edit" and json.loads(e["detail"])["target"] == S1]
check("1i 只改標點空白＋5 個字＝極小修改 0 分（void／minor）", len(b1) == 1 and b1[0]["points"] == 0 and b1[0]["reason"] == "minor", b1 and (b1[0]["points"], b1[0]["reason"], json.loads(b1[0]["detail"])["chars"]))
b3 = [e for e in ev_b if e["kind"] == "edit" and json.loads(e["detail"])["target"] == S3][0]
check("1j 7 天內被還原＝不給分（reverted）", b3["state"] == "void" and b3["reason"] == "reverted", (b3["state"], b3["reason"]))
check("1k 還原本身不給分（C 沒有系列三的事件）", not [e for e in events(U["c"]["id"]) if json.loads(e["detail"]).get("target") == S3], "")
pend_a = total(U["a"]["id"])[1]
check("1l A 待入帳 30＋20＋240＋20＝310", pend_a == 310, pend_a)

# 過了 7 天才被還原：A 的藝人簡介
a_ai = [e for e in ev_a if e["kind"] == "edit" and json.loads(e["detail"])["target"] == AI][0]
rv2 = requests.post(f"{B}/api/revisions/{json.loads(a_ai['detail'])['base']}/revert", json={"summary": "晚還原"}, headers=H(U["c"]))
sql(f"UPDATE revisions SET created_at = '{iso(NOW + timedelta(days=8))}' WHERE id = {rv2.json().get('id', 0)}")

# ================= 2. 新增（經核准＋15）、管理員免審核 =================
rs = requests.post(B + "/api/catalog/submit", json={"type": "series", "artist": ART, "title": f"D送審{STAMP}", "seriesType": "專輯發行", "year": ""}, headers=H(U["d"]))
ri = requests.post(B + "/api/catalog/submit", json={"type": "item", "seriesKey": f"{ART}/1", "kind": "毛巾", "edition": "一般版"}, headers=H(U["d"]))
check("2a 會員送審：待審（approved=false）", rs.status_code == 201 and rs.json().get("approved") is False and ri.status_code == 201, (rs.text[:120], ri.text[:120]))
sid = sql(f"SELECT id, year, name, status FROM series WHERE artist_slug = '{ART}' AND title = 'D送審{STAMP}'")[0]
check("2b 送審時選「不記得」＝年份空白、名稱沒有年份", sid["year"] == "" and sid["name"].startswith("《"), sid)
iid = sql(f"SELECT i.id FROM items i JOIN series s ON s.id = i.series_id WHERE s.artist_slug = '{ART}' AND s.no = 1 AND i.kind = '毛巾'")[0]["id"]
recompute()
ev_d = events(U["d"]["id"])
check("2c 待審的新增不給分（not_approved）", [e["reason"] for e in ev_d if e["source"] in (f"series:{sid['id']}", f"item:{iid}")] == ["not_approved", "not_approved"], [(e["source"], e["reason"]) for e in ev_d if e["kind"] == "create"])
for typ, i_ in [("series", sid["id"]), ("item", iid)]:
    requests.post(B + "/api/admin/submissions", json={"type": typ, "id": str(i_), "approve": True}, headers=AH)
vid = sql(f"SELECT id FROM versions WHERE item_ref = {iid}")[0]["id"]
requests.post(B + "/api/admin/submissions", json={"type": "version", "id": str(vid), "approve": True}, headers=AH)
rv3 = requests.post(B + "/api/catalog/submit", json={"type": "version", "itemKey": f"{ART}/1#towel", "edition": "再版"}, headers=H(U["d"]))
v2 = sql(f"SELECT id FROM versions WHERE item_ref = {iid} AND version_id = 'v2'")
if v2:
    requests.post(B + "/api/admin/submissions", json={"type": "version", "id": str(v2[0]["id"]), "approve": False}, headers=AH)
recompute()
ev_d = events(U["d"]["id"])
cr = {e["source"]: (e["state"], e["reason"], e["points"]) for e in ev_d if e["kind"] == "create"}
check("2d 核准後系列、品項各 +15", cr.get(f"series:{sid['id']}") == ("credited", None, 15) and cr.get(f"item:{iid}") == ("credited", None, 15), cr)
check("2e 品項連帶的第一個版本不另外算", f"version:{vid}" not in cr, cr)
check("2f 被退回的版本不給分", v2 and cr.get(f"version:{v2[0]['id']}", ("", "", 0))[1] == "not_approved", (rv3.status_code, v2, cr))
ra2 = requests.post(B + "/api/catalog/submit", json={"type": "series", "artist": ART, "title": f"館長新增{STAMP}", "seriesType": "專輯發行", "year": "2025"}, headers=AH)
aw = sql(f"SELECT id, no, status FROM series WHERE artist_slug = '{ART}' AND title = '館長新增{STAMP}'")[0]
pend = requests.get(B + "/api/admin", headers=AH).json()
check("2g 管理員新增系列直接生效（approved=true、status=approved）", ra2.json().get("approved") is True and aw["status"] == "approved", (ra2.text[:120], aw))
check("2h 不在審核佇列", not any(p.get("title", "").find(f"館長新增{STAMP}") >= 0 for p in pend.get("pending", [])), len(pend.get("pending", [])))
check("2i 前台看得到（系列頁 200）", requests.get(f"{B}/artist/{ART}/{aw['no']}").status_code == 200)
ra3 = requests.post(B + "/api/catalog/submit", json={"type": "item", "seriesKey": f"{ART}/{aw['no']}", "kind": "CD", "edition": "一般版"}, headers=AH)
ra4 = requests.post(B + "/api/catalog/submit", json={"type": "version", "itemKey": f"{ART}/{aw['no']}#cd", "edition": "再版"}, headers=AH)
ra5 = requests.post(B + "/api/catalog/submit", json={"type": "artist", "name": f"館長藝人{STAMP}", "slug": f"lvadm{STAMP}"}, headers=AH)
st = sql(f"SELECT (SELECT i.status FROM items i JOIN series s ON s.id=i.series_id WHERE s.id={aw['id']} AND i.item_id='cd') it, "
         f"(SELECT group_concat(v.status) FROM versions v JOIN items i ON i.id=v.item_ref WHERE i.series_id={aw['id']}) vs, "
         f"(SELECT status FROM artists WHERE slug='lvadm{STAMP}') ar")[0]
check("2j 管理員新增的品項、版本、藝人也直接生效", st["it"] == "approved" and st["vs"] == "approved,approved" and st["ar"] == "approved", st)
logn = sql(f"SELECT COUNT(*) n FROM admin_log WHERE action = '新增（免審核）' AND created_at >= '{iso(NOW)}'")[0]["n"]
check("2k 管理員免審核寫操作紀錄（4 筆）", logn == 4, logn)

# ================= 3. 發炫收藏、辨識參考 =================
ev_d = events(U["d"]["id"])
sh = [e for e in ev_d if e["kind"] == "share"]
check("3a 今天 7 則：5 則有分、2 則超過每日上限", count(ev_d, "share", "credited") == 5 and count(ev_d, "share", reason="daily_cap") == 2, [(e["state"], e["reason"]) for e in sh])
refs = {e["source"]: (e["state"], e["reason"]) for e in ev_d if e["kind"] == "ref"}
check("3b 第 1 則勾辨識參考 +5；第 7 則收藏超過上限，辨識參考也不給", refs.get(f"ref:{share_no['d'][0]}") == ("credited", None) and refs.get(f"ref:{share_no['d'][6]}", ("",))[0] == "void", refs)
d_before = total(U["d"]["id"])[0]
requests.post(B + "/api/admin/hide", json={"type": "share", "key": str(share_no["d"][1]), "hidden": True}, headers=AH)
recompute()
ev_d = events(U["d"]["id"])
d_after = total(U["d"]["id"])[0]
check("3c 管理員下架一則有分的收藏：扣回 10 分，超過上限的那則不遞補", d_before - d_after == 10 and count(ev_d, "share", reason="daily_cap") == 2, (d_before, d_after))
requests.post(B + "/api/admin/hide", json={"type": "share", "key": str(share_no["d"][1]), "hidden": False}, headers=AH)

# ================= 4. 按讚、收到讚 =================
e_ok = 0
for no in share_no["x"]:
    e_ok += requests.post(B + "/api/me/likes", json={"share": no, "on": True}, headers=H(U["e"])).ok
requests.post(B + "/api/me/likes", json={"share": share_no["e"][0], "on": True}, headers=H(U["e"]))
recompute()  # 先統計一次，讓「取消讚」發生在已經有分之後
cv0 = cv()
requests.post(B + "/api/me/likes", json={"share": share_no["x"][4], "on": False}, headers=H(U["e"]))
check("4a 按讚、取消讚不讓 content_version 增加", cv() == cv0, (cv0, cv()))
recompute()
ev_e = events(U["e"]["id"])
check("4b E 今天讚 12 則：10 則有分、2 則超過每日上限、取消的那則作廢", count(ev_e, "like_give", "credited") == 9 and count(ev_e, "like_give", reason="daily_cap") == 2 and count(ev_e, "like_give", reason="removed") == 1,
      [(e["state"], e["reason"]) for e in ev_e if e["kind"] == "like_give"])
check("4c 讚自己的收藏沒有事件", not [e for e in ev_e if e["source"].endswith(f":{share_no['e'][0]}") and e["kind"] == "like_give"])
ev_x = events(U["x"]["id"])
rx = [e for e in ev_x if e["kind"] == "like_recv" and json.loads(e["detail"])["share"] == share_no["x"][0]]
check("4d 同一則收到 53 個讚，只計 50", count([e for e in rx], "like_recv", "credited") == 50 and sum(1 for e in rx if e["reason"] == "share_cap") == 3, (len(rx), sum(1 for e in rx if e["state"] == "credited")))
check("4e X 收到讚合計 60（第 1 則 50＋其他 10 則，取消的那個不算）", credited(ev_x, "like_recv") == 60, credited(ev_x, "like_recv"))
check("4f X 總分＝收藏 120＋收到讚 60＋收到留言 7＝187", total(U["x"]["id"])[0] == 187, total(U["x"]["id"]))
ev_p1, ev_p2 = events(U["p1"]["id"]), events(U["p2"]["id"])
check("4g 互讚合計 25 次只計 20：P1 給 10、P2 給 10", credited(ev_p1, "like_give") == 10 and credited(ev_p2, "like_give") == 10 and count(ev_p1, "like_give", reason="pair_cap") == 5,
      (credited(ev_p1, "like_give"), credited(ev_p2, "like_give")))
check("4h 互讚的收到讚同樣只計 20：P1 收 10、P2 收 10", credited(ev_p1, "like_recv") == 10 and credited(ev_p2, "like_recv") == 10, (credited(ev_p1, "like_recv"), credited(ev_p2, "like_recv")))

# ================= 5. 留言 =================
ev_f = events(U["f"]["id"])
check("5a F 今天 12 則：10 則有分、2 則超過每日上限", count(ev_f, "comment", "credited") == 10 and count(ev_f, "comment", reason="daily_cap") == 2, [(e["state"], e["reason"]) for e in ev_f if e["kind"] == "comment"])
check("5b 在自己收藏底下的留言沒有事件", count(ev_f, "comment") == 12, count(ev_f, "comment"))
check("5c 互留言合計 12 則只計 10：P1 7 則 14 分、P2 3 則 6 分", credited(ev_p1, "comment") == 14 and credited(ev_p2, "comment") == 6 and count(ev_p2, "comment", reason="pair_cap") == 2,
      (credited(ev_p1, "comment"), credited(ev_p2, "comment")))
fc = sql(f"SELECT id FROM comments WHERE author_id = '{U['f']['id']}' ORDER BY id LIMIT 1")[0]["id"]
cv0 = cv()
rdel = requests.delete(f"{B}/api/comments/{fc}", headers=H(U["f"]))
rpost = requests.post(B + "/api/comments", json={"share": share_no["x"][2], "body": "API 留一則"}, headers=H(U["f"]))
check("5d 留言、刪留言不讓 content_version 增加", rdel.ok and rpost.status_code == 201 and cv() == cv0, (rdel.status_code, rpost.status_code, cv0, cv()))
recompute()
ev_f = events(U["f"]["id"])
check("5e 刪掉一則有分的留言：扣回 2 分，超過上限的不遞補（今天第 13 則也不給）", credited(ev_f, "comment") == 18 and count(ev_f, "comment", reason="deleted") == 1 and count(ev_f, "comment", reason="daily_cap") == 3,
      (credited(ev_f, "comment"), [(e["state"], e["reason"]) for e in ev_f if e["kind"] == "comment"][-4:]))

# ================= 6. 成交 =================
ev_s, ev_bu = events(U["s"]["id"]), events(U["bu"]["id"])
check("6a 同一對買賣 3 筆成交只計 2 筆：賣家 +10、買家 +10", credited(ev_s, "deal") == 10 and credited(ev_bu, "deal") == 10 and count(ev_s, "deal", reason="pair_cap") == 1, (credited(ev_s, "deal"), credited(ev_bu, "deal")))
check("6b 作廢的成交不給分", count(ev_s, "deal", reason="voided") == 1 and count(ev_bu, "deal", reason="voided") == 1)

# ================= 7. 檢舉 =================
def rep(u, target, reason="fake"):
    return requests.post(B + "/api/reports", json={"target": target, "reason": reason}, headers=H(u))


for no in share_no["y"][:5]:
    rep(U["h"], f"share:{no}")
    requests.post(B + "/api/admin/targets", json={"target": f"share:{no}", "decision": "kept"}, headers=AH)
rep(U["h2"], f"share:{share_no['y'][5]}")
requests.post(B + "/api/admin/targets", json={"target": f"share:{share_no['y'][5]}", "decision": "unlocked"}, headers=AH)
yt = f"share:{share_no['y2'][0]}"
th = int(sql("SELECT value FROM settings WHERE key = 'report_threshold'")[0]["value"])
for n in range(1, th + 1):
    rep(U[f"r{n:02d}"], yt)
rep(U["r11"], yt)
zc = sql(f"SELECT id FROM comments WHERE author_id = '{U['z']['id']}'")[0]["id"]
zr = [rep(U[f"r{n:02d}"], f"comment:{zc}", "abuse").status_code for n in (1, 2, 3)]
recompute()
ev_h = events(U["h"]["id"])
check("7a 管理員維持鎖定＝檢舉成立 +10，7 天內待入帳", count(ev_h, "report_ok", "pending") == 5 and total(U["h"]["id"]) == (0, 50), (total(U["h"]["id"]), [(e["state"], e["reason"]) for e in ev_h]))
ev_h2 = events(U["h2"]["id"])
check("7b 管理員解鎖＝檢舉不成立 -5（總分 10－5＝5）", credited(ev_h2, "report_bad") == -5 and total(U["h2"]["id"])[0] == 5, total(U["h2"]["id"]))
ok10 = all(count(events(U[f"r{n:02d}"]["id"]), "report_ok", "pending") >= 1 for n in range(1, th + 1))
ev_r11 = events(U["r11"]["id"])
check(f"7c 達門檻（{th} 人）＝前 {th} 位檢舉成立（待入帳）", ok10)
check("7d 達門檻後才跟上的第 11 位不給分", not [e for e in ev_r11 if e["kind"] == "report_ok"], [(e["kind"], e["state"]) for e in ev_r11])
ev_y = events(U["y"]["id"])
check("7e 被檢舉成立的收藏扣回（Y 5 則 reported）", count(ev_y, "share", reason="reported") == 5, [(e["source"], e["reason"]) for e in ev_y if e["kind"] == "share"])
ev_y2 = events(U["y2"]["id"])
check("7f 達門檻被鎖的收藏扣回", count(ev_y2, "share", reason="reported") == 1, [(e["source"], e["reason"]) for e in ev_y2])
ev_r1 = events(U["r01"]["id"])
check("7g 留言被 3 人檢舉自動隱藏＝檢舉成立（待入帳）；留言者那則作廢", zr == [201, 201, 201] and any(e["source"].startswith("crok:") and e["state"] == "pending" for e in ev_r1) and count(events(U["z"]["id"]), "comment", reason="hidden") == 1,
      (zr, [(e["source"], e["state"]) for e in ev_r1]))
# 7 天後
recompute(8)
check("7h 7 天後檢舉成立入帳：H 50 分", total(U["h"]["id"])[0] == 50, total(U["h"]["id"]))
# 申訴翻案：解鎖 Y2 那則 → 前 10 位的 +10 作廢、所有人（含第 11 位）-5
requests.post(B + "/api/admin/targets", json={"target": yt, "decision": "unlocked"}, headers=AH)
recompute(8)
ev_r5, ev_r11 = events(U["r05"]["id"]), events(U["r11"]["id"])
check("7i 被翻案：原本成立的 +10 作廢（overturned）、改 -5", count(ev_r5, "report_ok", reason="overturned") == 1 and credited(ev_r5, "report_bad") == -5, [(e["kind"], e["state"], e["reason"]) for e in ev_r5])
check("7j 第 11 位也 -5（總分最低 0）", credited(ev_r11, "report_bad") == -5 and total(U["r11"]["id"])[0] == 0, total(U["r11"]["id"]))
check("7k 翻案後 Y2 的收藏分數回來", count(events(U["y2"]["id"]), "share", "credited") == 1)

# ================= 8. 補上缺漏資料 =================
fills = [requests.post(B + "/api/series/year", json={"key": f"{ART2}/{no}", "year": "2011"}, headers=H(U["k"])).status_code for no in (1, 2, 3, 4, 5, 6, 7)]
check("8a 補發行年 API 都成功", fills == [200] * 7, fills)
again = requests.post(B + "/api/series/year", json={"key": f"{ART2}/1", "year": "2012"}, headers=H(U["k2"]))
check("8b 已經有年份不能再補（409）", again.status_code == 409, again.status_code)
bad = requests.post(B + "/api/series/year", json={"key": f"{ART2}/8", "year": "99"}, headers=H(U["k2"]))
check("8c 年份格式不對 400", bad.status_code == 400, bad.status_code)
requests.post(B + "/api/series/year", json={"key": f"{ART2}/8", "year": "2013"}, headers=H(U["k2"]))
sql(f"UPDATE series SET year = '2014' WHERE artist_slug = '{ART2}' AND no = 8")
nm = sql(f"SELECT name FROM series WHERE artist_slug = '{ART2}' AND no = 1")[0]["name"]
check("8d 補上後系列名稱帶年份", nm == "2011《補年1》專輯發行", nm)
recompute()
ev_k = events(U["k"]["id"])
check("8e K 補 6 則別人的：5 則待入帳、1 則超過每日上限；補自己新增的沒有事件", count(ev_k, "fill", "pending") == 5 and count(ev_k, "fill", reason="daily_cap") == 1 and count(ev_k, "fill") == 6,
      [(e["source"], e["state"], e["reason"]) for e in ev_k])
check("8f 7 天內被改掉的不給分（changed）", count(events(U["k2"]["id"]), "fill", reason="changed") == 1, [(e["state"], e["reason"]) for e in events(U["k2"]["id"])])
recompute(8)
check("8g 7 天後入帳：K 補資料 50 分", credited(events(U["k"]["id"]), "fill") == 50, credited(events(U["k"]["id"]), "fill"))

# ================= 9. 停權：分數保留、停權期間凍結 =================
def now_iso():
    return iso(datetime.now(timezone.utc))


def suspend(t, code="other", note="等級驗收"):
    return requests.post(B + "/api/admin/members", json={"id": U[t]["id"], "action": "suspend", "reasonCode": code, "note": note}, headers=AH)


def restore(t):
    return requests.post(B + "/api/admin/members", json={"id": U[t]["id"], "action": "restore"}, headers=AH)


check("9a 停權前 I 10 分、P3 11 分（收藏＋L1 的讚）", total(U["i"]["id"])[0] == 10 and total(U["p3"]["id"])[0] == 11, (total(U["i"]["id"]), total(U["p3"]["id"])))
for t in ("i", "l1"):
    suspend(t)
# I 停權期間，O 讚了 I 的收藏（停權期間發生的事件不計）
sql(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U['o']['id']}', {share_no['i'][0]}, '{now_iso()}')")
recompute(8)
check("9b 停權後 I 分數保留 10（不歸零）", total(U["i"]["id"]) == (10, 0), total(U["i"]["id"]))
check("9c 按讚者 L1 被停權（原因：其他），他之前給的讚照算：P3 仍 11", total(U["p3"]["id"])[0] == 11, total(U["p3"]["id"]))
ev_i = events(U["i"]["id"])
check("9e 停權期間收到的讚不計（suspended）", count(ev_i, "like_recv", reason="suspended") == 1, [(e["kind"], e["state"], e["reason"]) for e in ev_i])
restore("i")
time.sleep(0.05)
sql(f"INSERT INTO likes (user_id, share_no, created_at) VALUES ('{U['m01']['id']}', {share_no['i'][0]}, '{now_iso()}')")
recompute(8)
check("9d 恢復後照常：I 10＋恢復後收到的讚 1＝11；停權期間那個讚仍不計", total(U["i"]["id"])[0] == 11 and count(events(U["i"]["id"]), "like_recv", reason="suspended") == 1, total(U["i"]["id"]))
su = sql(f"SELECT reason, note, ended_at FROM suspensions WHERE user_id = '{U['i']['id']}'")
check("9f 停權紀錄一筆、恢復時填上結束時間", len(su) == 1 and su[0]["reason"] == "other" and su[0]["ended_at"], su)
r0 = requests.post(B + "/api/admin/members", json={"id": U["q"]["id"], "action": "suspend"}, headers=AH)
r1 = requests.post(B + "/api/admin/members", json={"id": U["q"]["id"], "action": "suspend", "reasonCode": "other", "note": ""}, headers=AH)
r2 = requests.post(B + "/api/admin/members", json={"id": U["q"]["id"], "action": "suspend", "reasonCode": "abc", "note": "x"}, headers=AH)
check("9g 停權必填原因：沒選 400、選「其他」沒寫說明 400、不在選單內 400", (r0.status_code, r1.status_code, r2.status_code) == (400, 400, 400), (r0.text[:80], r1.text[:80], r2.text[:80]))
restore("l1")
suspend("l1", "sockpuppet", "驗收分身")
recompute(8)
ev_p3 = events(U["p3"]["id"])
check("9h 按讚者因「分身刷分」停權：他給的讚不計，P3 11 → 10（peer_sockpuppet）", total(U["p3"]["id"])[0] == 10 and count(ev_p3, "like_recv", reason="peer_sockpuppet") == 1, total(U["p3"]["id"]))
lg = sql(f"SELECT detail FROM admin_log WHERE target = 'user:{U['l1']['handle']}' AND action = '停權會員' ORDER BY id DESC LIMIT 1")
check("9i admin_log 記下原因代碼與說明", lg and json.loads(lg[0]["detail"]) == {"reason": "分身刷分：驗收分身", "code": "sockpuppet", "note": "驗收分身"}, lg)
ml = requests.get(B + "/api/admin/members", params={"q": U["l1"]["handle"]}, headers=AH).json()["members"]
check("9j 會員列表顯示停權原因", ml and ml[0]["suspendReason"] == "分身刷分：驗收分身", ml and ml[0].get("suspendReason"))

# ================= 10. 7 天後入帳：編輯 =================
ev_a = events(U["a"]["id"])
check("10a 7 天後 A 編輯入帳 310 分", total(U["a"]["id"]) == (310, 0), total(U["a"]["id"]))
a_ai = [e for e in ev_a if e["kind"] == "edit" and json.loads(e["detail"])["target"] == AI][0]
check("10b 過了 7 天才被還原，不影響（仍 credited）", a_ai["state"] == "credited", (a_ai["state"], a_ai["reason"]))
check("10c B 的極小修改與被還原的編輯 7 天後仍是 0 分", total(U["b"]["id"])[0] == 0, total(U["b"]["id"]))
check("10d D 總分＝收藏 50＋辨識參考 5＋新增 30＋收到留言 6＝91", total(U["d"]["id"])[0] == 91, (total(U["d"]["id"]), [(e["kind"], e["state"], e["reason"]) for e in events(U["d"]["id"]) if e["state"] == "credited"]))
p1s, p2s = total(U["p1"]["id"])[0], total(U["p2"]["id"])[0]
check("10e P1＝收藏 100＋給讚 10＋收讚 10＋留言 14＋收到留言 3＝137；P2＝150＋10＋10＋6＋7＝183", (p1s, p2s) == (137, 183), (p1s, p2s))
check("10f E＝收藏 10＋給讚 9＝19；F＝收藏 10＋留言 18＝28", (total(U["e"]["id"])[0], total(U["f"]["id"])[0]) == (19, 28), (total(U["e"]["id"]), total(U["f"]["id"])))

# ================= 11. 稱號 =================
def titles(uid):
    return sorted((r["kind"], r["ref"]) for r in sql(f"SELECT kind, ref FROM user_titles WHERE user_id = '{uid}'"))


check("11a 打假先鋒：H 檢舉成立 5 次", ("fakebuster", "") in titles(U["h"]["id"]), titles(U["h"]["id"]))
check("11b 檢舉成立 1 次的不給（R01）", ("fakebuster", "") not in titles(U["r01"]["id"]), titles(U["r01"]["id"]))
check("11c 頭號樂迷：A 是等級藝人的頭號樂迷（14 次有效編輯）", ("topfan", ART) in titles(U["a"]["id"]), titles(U["a"]["id"]))
check("11d 同分（A、C 各 1 次）取先達到的 A", ("topfan", ART3) in titles(U["a"]["id"]) and ("topfan", ART3) not in titles(U["c"]["id"]), (titles(U["a"]["id"]), titles(U["c"]["id"])))
one = sql(f"SELECT COUNT(*) n FROM user_titles WHERE kind = 'topfan' AND ref = '{ART3}'")[0]["n"]
check("11e 每位藝人只有一位頭號樂迷", one == 1, one)
# C 再改一次 → 2:1，C 取代 A
shift_last(T1)
edit(U["c"], T1, ["同分系列的初始正文。", "A 先補上的一段內容，超過十個字。", "C 後補上的一段內容，也超過十個字。", "C 又補了一段，超過十個字的內容。"])
recompute(8)
check("11f C 超過 A：頭號樂迷換人", ("topfan", ART3) in titles(U["c"]["id"]) and ("topfan", ART3) not in titles(U["a"]["id"]), (titles(U["a"]["id"]), titles(U["c"]["id"])))
# 打假先鋒被翻案一筆 → 4 次，稱號拿掉
requests.post(B + "/api/admin/targets", json={"target": f"share:{share_no['y'][0]}", "decision": "unlocked"}, headers=AH)
recompute(8)
check("11g 打假先鋒被翻案剩 4 次：稱號拿掉", ("fakebuster", "") not in titles(U["h"]["id"]), titles(U["h"]["id"]))
requests.post(B + "/api/admin/targets", json={"target": f"share:{share_no['y'][0]}", "decision": "kept"}, headers=AH)
recompute(8)
check("11h 恢復成立：稱號回來", ("fakebuster", "") in titles(U["h"]["id"]), titles(U["h"]["id"]))

# ================= 12. 顯示 =================
def strip(h):
    return h.replace("<!-- -->", "")


ph = strip(requests.get(f"{B}/u/{U['a']['handle']}").text)
check("12a 個人頁：暱稱旁等級（310 分＝專業樂迷 Lv.2，門檻 280）", re.search(r'class="lv-tag"[^>]*>專業樂迷 Lv\.2<', ph), re.findall(r'class="lv-tag"[^>]*>([^<]+)<', ph))
m = re.search(r'data-testid="score-now">([\d,]+)<', ph)
check("12b 個人頁：目前分數 310", m and m.group(1) == "310", m and m.group(1))
m = re.search(r'data-testid="score-next">([^<]+)<span class="num">([\d,]+)</span>', ph)
check("12c 個人頁：離專業樂迷 Lv.3（380）還差 70 分", m and "專業樂迷 Lv.3" in m.group(1) and m.group(2) == "70", m and m.groups())
m = re.search(r'data-testid="score-at">([^<]+)<', ph)
check("12d 個人頁：顯示「分數統計於」時間", m and re.match(r"分數統計於 \d{4}-\d\d-\d\d \d\d:\d\d", m.group(1)), m and m.group(1))
check("12e 個人頁：稱號「等級藝人頭號樂迷」，連到藝人頁", f'href="/artist/{ART}"' in ph and f"等級藝人{STAMP}頭號樂迷" in ph)
phh = strip(requests.get(f"{B}/u/{U['h']['handle']}").text)
check("12f H 個人頁顯示「打假先鋒」", "打假先鋒" in phh)
pad = strip(requests.get(f"{B}/u/yzadmin").text)
check("12g 管理員個人頁：固定顯示「館長」、不顯示分數", re.search(r'class="lv-tag"[^>]*>館長<', pad) and 'data-testid="score-now"' not in pad, re.findall(r'class="lv-tag"[^>]*>([^<]+)<', pad))
requests.post(B + "/api/comments", json={"share": share_no["x"][3], "body": "館長留言"}, headers=AH)
cl = requests.get(f"{B}/api/comments?share={share_no['x'][3]}").json()["comments"]
bdg = {c["author"]["handle"]: c["author"].get("badge") for c in cl}
check("12h 留言帶等級：F＝新晉樂迷 Lv.2（28 分，門檻 20）、管理員＝館長", bdg.get(U["f"]["handle"]) == "新晉樂迷 Lv.2" and bdg.get("yzadmin") == "館長", bdg)
sh3 = strip(requests.get(f"{B}/share/3").text)
offers = re.search(r'<section class="offers".*?</section>', sh3, re.S)
check("12i 出價列表：每位出價者旁有等級", offers and len(re.findall(r'class="lv-tag"', offers.group(0))) == len(re.findall(r'class="offer-row', offers.group(0))) > 0,
      offers and (len(re.findall(r'class="lv-tag"', offers.group(0))), len(re.findall(r'class="offer-row', offers.group(0)))))
s1 = strip(requests.get(f"{B}/artist/{ART}/1").text)
con = re.search(r'data-testid="contributors".*?</section>', s1, re.S)
tags = re.findall(r'href="/u/([^"]+)"[^>]*>[^<]*</a><span class="lv-tag"[^>]*>([^<]+)<', con.group(0) if con else "")
check("12j 資料貢獻者名單：每人旁有等級（A＝專業樂迷 Lv.2）", con and (U["a"]["handle"], "專業樂迷 Lv.2") in tags, tags)

# ================= 17. 收到留言 =================
add_shares("x2", 1, start=NOW - timedelta(days=2))
xs = share_no["x2"][0]
stmts = [f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({xs}, '{U[f'm{n:02d}']['id']}', '收到留言{n}', '{iso(NOW - timedelta(days=1) + timedelta(seconds=n))}')" for n in range(1, 53)]
stmts.append(f"INSERT INTO comments (share_no, author_id, body, created_at) VALUES ({xs}, '{U['x2']['id']}', '自己回自己', '{iso(NOW - timedelta(days=1, minutes=-5))}')")
sql(";\n".join(stmts))
recompute()
ev_x2 = events(U["x2"]["id"])
check("17a 同一則收藏收到 52 則留言，只計 50（share_cap 2）", count(ev_x2, "comment_recv", "credited") == 50 and count(ev_x2, "comment_recv", reason="share_cap") == 2, (count(ev_x2, "comment_recv", "credited"), count(ev_x2, "comment_recv", reason="share_cap")))
check("17b 在自己收藏底下留言不算（X2 沒有自己的留言事件）", count(ev_x2, "comment_recv") == 52 and count(ev_x2, "comment") == 0, count(ev_x2, "comment_recv"))
check("17c X2 總分＝收藏 10＋收到留言 50＝60", total(U["x2"]["id"])[0] == 60, total(U["x2"]["id"]))
ev_p1, ev_p2 = events(U["p1"]["id"]), events(U["p2"]["id"])
check("17d 互留言上限一起算：12 則只計 10，P2 收到 7、P1 收到 3（超過的 2 則兩邊都不給）",
      credited(ev_p2, "comment_recv") == 7 and credited(ev_p1, "comment_recv") == 3 and count(ev_p1, "comment_recv", reason="pair_cap") == 2 and count(ev_p2, "comment", reason="pair_cap") == 2,
      (credited(ev_p2, "comment_recv"), credited(ev_p1, "comment_recv")))
crd = sql(f"SELECT state, reason FROM score_events WHERE source = 'cr:{fc}'")
check("17e 留言被刪除：作者的收到留言扣回（deleted）", crd and crd[0]["reason"] == "deleted", crd)
zc = sql(f"SELECT id FROM comments WHERE author_id = '{U['z']['id']}' AND hidden_at IS NOT NULL LIMIT 1")
crh = sql(f"SELECT state, reason FROM score_events WHERE source = 'cr:{zc[0]['id']}'") if zc else []
check("17f 留言被隱藏：作者的收到留言扣回（hidden）", crh and crh[0]["reason"] == "hidden", (zc, crh))
px2 = strip(requests.get(f"{B}/u/{U['x2']['handle']}").text)
m = re.search(r'data-testid="score-next">離 ([^<]+) 還差 <span class="num">([\d,]+)</span>', px2)
check("17g 60 分＝新晉樂迷 Lv.3（門檻 50），離新晉樂迷 Lv.4（90）還差 30", re.search(r'class="lv-tag"[^>]*>新晉樂迷 Lv\.3<', px2) and m and m.groups() == ("新晉樂迷 Lv.4", "30"), m and m.groups())

# ================= 18. 補缺漏資料擴大 =================
sid1 = sql(f"SELECT id FROM series WHERE artist_slug = '{ART2}' AND no = 1")[0]["id"]
sql(f"INSERT INTO items (series_id, item_id, kind, status) VALUES ({sid1}, 'cd', 'CD', 'approved')")
iref = sql(f"SELECT id FROM items WHERE series_id = {sid1} AND item_id = 'cd'")[0]["id"]
sql(";\n".join(
    f"INSERT INTO versions (item_ref, version_id, edition, status, created_by) VALUES ({iref}, '{vid}', '{ed}', 'approved', {owner})"
    for vid, ed, owner in [("v1", "初版", "NULL"), ("v2", "再版", "NULL"), ("v3", "G 自己新增的版本", f"'{U['g']['id']}'")]
))
VK = {v: f"{ART2}/1#cd-{v}" for v in ("v1", "v2", "v3")}
vids = {r["version_id"]: r["id"] for r in sql(f"SELECT id, version_id FROM versions WHERE item_ref = {iref}")}
fl = lambda v, f, val, u="g": requests.post(B + "/api/fill", json={"key": VK[v], "field": f, "value": val}, headers=H(U[u]))
codes = [fl("v1", "year", "2011").status_code, fl("v1", "region", "台灣").status_code, fl("v1", "label", "驗收唱片").status_code,
         fl("v1", "catalog", "LV-001").status_code, fl("v1", "identifyBy", "側標印紅字").status_code, fl("v2", "packaging", "紙盒").status_code,
         fl("v3", "tracks", "1. 第一首").status_code]
check("18a 版本的發行年、地區、發行、目錄號、辨識特徵、包裝、曲目都能補（200）", codes == [200] * 7, codes)
check("18b 已經有值的不能再補（409）", fl("v1", "year", "2012").status_code == 409)
bad = [fl("v2", "barcode", "123").status_code, fl("v2", "year", "abc").status_code, fl("v2", "region", "  ").status_code]
check("18c 條碼不在清單、年份格式不對、空白 → 400", bad == [400, 400, 400], bad)
row = sql(f"SELECT year, region, label, catalog, identify_by FROM versions WHERE id = {vids['v1']}")[0]
check("18d 補上的值寫進版本", row == {"year": "2011", "region": "台灣", "label": "驗收唱片", "catalog": "LV-001", "identify_by": "側標印紅字"}, row)
recompute()
ev_g = events(U["g"]["id"])
check("18e G 補別人的 6 筆：5 筆待入帳、1 筆超過每日上限；補自己新增的版本沒有事件",
      count(ev_g, "fill") == 6 and count(ev_g, "fill", "pending") == 5 and count(ev_g, "fill", reason="daily_cap") == 1 and not [e for e in ev_g if e["source"] == f"fill:version:{vids['v3']}:tracks"],
      [(e["source"], e["state"], e["reason"]) for e in ev_g])
sql(f"UPDATE versions SET region = '日本' WHERE id = {vids['v1']}")
recompute()
check("18f 7 天內被改掉的不給分（changed）", count(events(U["g"]["id"]), "fill", reason="changed") == 1, [(e["source"], e["reason"]) for e in events(U["g"]["id"])])
recompute(8)
check("18g 7 天後入帳：G 補資料 40 分（5 筆有分、1 筆被改掉）", credited(events(U["g"]["id"]), "fill") == 40, credited(events(U["g"]["id"]), "fill"))
sp = requests.get(f"{B}/artist/{ART2}/1").text
check("18h 系列頁：還有空白欄位的版本出現「待補」與可補的欄位", f'data-vkey="{VK["v2"]}"' in sp and 'data-testid="fill-open-region"' in sp, sp.count('data-testid="field-missing"'))

# ================= 19. 管理員指定等級 =================
cv0 = cv()
lv = lambda body: requests.post(B + "/api/admin/members", json={"id": U["a"]["id"], **body}, headers=AH)
r0 = lv({"action": "set_level", "level": 13, "reason": ""})
r1 = lv({"action": "set_level", "level": 26, "reason": "x"})
check("19a 指定等級必填原因（400）、等級超出 1～25（400）", (r0.status_code, r1.status_code) == (400, 400), (r0.text[:80], r1.text[:80]))
r2 = lv({"action": "set_level", "level": 13, "reason": "驗收：資深貢獻"})
check("19b 指定 A 為資深樂迷 Lv.3（第 13 級）成功", r2.ok, r2.text[:100])
recompute(8)  # A 的編輯分數要是入帳狀態（前面 17、18 節用今天時間重算過，會回到待入帳）
pa = strip(requests.get(f"{B}/u/{U['a']['handle']}").text)
m = re.search(r'data-testid="score-next">離 ([^<]+) 還差 <span class="num">([\d,]+)</span>', pa)
check("19c 個人頁顯示指定的等級，不標示「指定」", re.search(r'class="lv-tag"[^>]*>資深樂迷 Lv\.3<', pa) and "指定" not in pa, re.findall(r'class="lv-tag"[^>]*>([^<]+)<', pa))
check("19d 分數照常累計（仍 310），離資深樂迷 Lv.4（1,550）還差 1,240", total(U["a"]["id"])[0] == 310 and m and m.groups() == ("資深樂迷 Lv.4", "1,240"), (total(U["a"]["id"]), m and m.groups()))
ma = requests.get(B + "/api/admin/members", params={"q": U["a"]["handle"]}, headers=AH).json()["members"][0]
check("19e 後台會員列表：等級＝資深樂迷 Lv.3、標示指定與原因", ma["level"] == "資深樂迷 Lv.3" and ma["override"] == 13 and ma["overrideReason"] == "驗收：資深貢獻", {k: ma[k] for k in ("level", "override", "overrideReason", "score")})
con = strip(requests.get(f"{B}/artist/{ART}/1?lv={STAMP}").text)
check("19f 資料貢獻者名單也顯示指定的等級", f'/u/{U["a"]["handle"]}' in con and "資深樂迷 Lv.3" in con)
lg = sql(f"SELECT action, detail FROM admin_log WHERE target = 'user:{U['a']['handle']}' ORDER BY id")
check("19g admin_log 記下指定等級（等級、原因）", lg and lg[-1]["action"] == "指定等級" and json.loads(lg[-1]["detail"])["level"] == 13 and json.loads(lg[-1]["detail"])["reason"] == "驗收：資深貢獻", lg[-1:])
radm = requests.post(B + "/api/admin/members", json={"id": admin["id"], "action": "set_level", "level": 5, "reason": "x"}, headers=AH)
check("19h 管理員固定館長，不能指定（403）", radm.status_code == 403, radm.status_code)
r3 = lv({"action": "clear_level"})
pa2 = strip(requests.get(f"{B}/u/{U['a']['handle']}").text)
lg2 = sql(f"SELECT action FROM admin_log WHERE target = 'user:{U['a']['handle']}' ORDER BY id DESC LIMIT 1")
check("19i 取消指定：回到計算值專業樂迷 Lv.2，留紀錄", r3.ok and re.search(r'class="lv-tag"[^>]*>專業樂迷 Lv\.2<', pa2) and lg2[0]["action"] == "取消指定等級", (r3.text[:80], re.findall(r'class="lv-tag"[^>]*>([^<]+)<', pa2)))
check("19j 指定、取消指定不讓 content_version 增加", cv() == cv0, (cv0, cv()))
trig = sql("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name IN ('suspensions', 'level_overrides')")
check("19k 兩張新表沒有內容版本觸發器", not trig, trig)

# ================= 20. 門檻表 =================
src = (SITE / "lib/levels.ts").read_text(encoding="utf-8")
blk = src[src.index("export const LEVELS"):src.index("] as const;", src.index("export const LEVELS"))]
nums = [int(x) for x in re.findall(r"\b\d+\b", re.sub(r"//.*", "", blk))]
EXPECT = [0, 20, 50, 90, 140, 200, 280, 380, 500, 650, 800, 1000, 1250, 1550, 1900, 2300, 2800, 3400, 4100, 5000, 6000, 7200, 8600, 10200, 12000]
check("20a 門檻換成降低版（25 級）", nums == EXPECT, nums)

# ================= 13. 快取 =================
cv0 = cv()
h1 = requests.get(f"{B}/share/95")
h2 = requests.get(f"{B}/share/95")
requests.post(B + "/api/me/likes", json={"share": 95, "on": True}, headers=H(U["e"]))
requests.post(B + "/api/comments", json={"share": 95, "body": f"快取驗收{STAMP}"}, headers=H(U["e"]))
recompute()
requests.get(f"{B}/u/{U['e']['handle']}")
h3 = requests.get(f"{B}/share/95")
requests.post(B + "/api/me/likes", json={"share": 95, "on": False}, headers=H(U["e"]))
check("13a 按讚、留言、重算分數、看個人頁：content_version 不變", cv() == cv0, (cv0, cv()))
check("13b 單則頁整頁快取前後都是 HIT", h2.headers.get("x-yz-cache") == "HIT" and h3.headers.get("x-yz-cache") == "HIT", (h1.headers.get("x-yz-cache"), h2.headers.get("x-yz-cache"), h3.headers.get("x-yz-cache")))
trig = sql("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (tbl_name IN ('score_events', 'user_scores', 'user_titles', 'counters'))")
check("13c 三張計分表與 counters 都沒有內容版本觸發器", not trig, trig)

# ================= 14. 藝人頁排序、發行年待補 =================
ah = strip(requests.get(f"{B}/artist/{ART}").text)
sec = re.search(r'<h2 class="block-title">系列</h2>.*?</ul>', ah, re.S)
titles_order = re.findall(r'class="tile-title">([^<]+)<', sec.group(0) if sec else "")
mine = [t for t in titles_order if STAMP in t and "送審" not in t and "館長" not in t]
check("14a 藝人頁系列：新的在前、年份不明排最後（2024、2021、2019、待補）", mine == [f"2024《系列三{STAMP}》專輯發行", f"2021《系列四{STAMP}》專輯發行", f"2019《系列一{STAMP}》專輯發行", f"《系列二{STAMP}》專輯發行"], titles_order)
all_years = [int(t[:4]) if t[:4].isdigit() else -1 for t in titles_order]
known = [y for y in all_years if y >= 0]
check("14b 全部系列（含送審、館長新增）也照同一規則", known == sorted(known, reverse=True) and all_years[len(known):] == [-1] * (len(all_years) - len(known)), all_years)
s2 = strip(requests.get(f"{B}/artist/{ART}/2").text)
check("14c 年份空白的系列頁有「發行年待補」", 'data-testid="year-missing"' in s2 and "發行年待補" in s2)
check("14d 有年份的系列頁沒有這行", 'data-testid="year-missing"' not in s1)

# ================= 15. 畫面（Playwright） =================
def rng_ok(page, sel):
    """用 Range 量文字的每個矩形，確認都在元素（扣掉 padding）裡面，沒被截斷"""
    return page.evaluate(
        """(sel) => {
      const el = document.querySelector(sel); if (!el) return {ok: false, why: 'no element'};
      const box = el.getBoundingClientRect(); const tile = el.closest('.stat').getBoundingClientRect();
      const cs = getComputedStyle(el.closest('.stat'));
      const inner = { l: tile.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) - 0.5, r: tile.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) + 0.5 };
      const r = document.createRange(); r.selectNodeContents(el);
      const rects = Array.from(r.getClientRects()).filter(x => x.width > 0);
      const bad = rects.filter(x => x.left < inner.l || x.right > inner.r);
      const s = getComputedStyle(el);
      return { ok: bad.length === 0 && s.textOverflow !== 'ellipsis' && !el.textContent.includes('…'), text: el.textContent,
               lines: new Set(rects.map(x => Math.round(x.top))).size, rightMax: Math.max(...rects.map(x => x.right)), innerRight: inner.r,
               font: s.fontSize, overflow: s.overflow, textOverflow: s.textOverflow, bad: bad.length };
    }""",
        sel,
    )


shots = []
recompute(8)  # 畫面用 7 天後的狀態（編輯已入帳、稱號出現）
with sync_playwright() as p:
    br = p.chromium.launch()
    for w, hgt in [(1440, 900), (390, 844)]:
        # 管理後台儀表板：成交總金額
        ctx = br.new_context(viewport={"width": w, "height": hgt})
        ctx.add_cookies([{"name": "yz_session", "value": admin["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m, errs=errs: errs.append(m.text) if m.type == "error" else None)
        pg.goto(B + "/admin", wait_until="networkidle")
        pg.wait_for_selector('[data-testid="st-amount"] .stat-value', timeout=15000)
        pg.evaluate("document.fonts.ready")
        # 儀表板統計有 10 分鐘快取：跟統計 API 回的數字比，不跟資料庫比
        amt = requests.get(B + "/api/admin/stats", headers=AH).json()["stats"]["trade"]["amount"]
        r = rng_ok(pg, '[data-testid="st-amount"] .stat-value')
        check(f"15a 成交總金額 {w}：Range 量每個字都在框內、沒有省略號", r["ok"], r)
        check(f"15b 成交總金額 {w}：顯示完整金額 NT${amt:,}", r.get("text") == f"NT${amt:,}", (r.get("text"), amt))
        # 金額變長（假資料撐到九位數）也不截斷
        pg.evaluate("""() => { const b = document.querySelector('[data-testid="st-amount"] .stat-value'); b.lastElementChild.textContent = '123,456,789'; b.classList.add('stat-value-long'); }""")
        r2 = rng_ok(pg, '[data-testid="st-amount"] .stat-value')
        check(f"15c 金額九位數 {w}：仍不截斷（放不下時換行，行數 {r2.get('lines')}）", r2["ok"], r2)
        pg.reload(wait_until="networkidle")
        pg.wait_for_selector('[data-testid="st-amount"]', timeout=15000)
        pg.locator('[data-testid="stats-content"]').scroll_into_view_if_needed()
        pg.screenshot(path=str(IMG / f"admin_dash_{w}.jpg"), type="jpeg", quality=80, full_page=True)
        ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        shots.append(("admin_dash", w, ov, list(errs)))
        ctx.close()

        # 個人頁（A 本人看：有待入帳那行的話會出現）、H、管理員；留言、出價、貢獻者、藝人頁、系列頁（待補）
        for name, path, tok in [
            ("profile_a", f"/u/{U['a']['handle']}", U["a"]["tok"]),
            ("profile_h", f"/u/{U['h']['handle']}", None),
            ("profile_admin", "/u/yzadmin", None),
            ("share_comments", f"/share/{share_no['x'][3]}", None),
            ("share_offers", "/share/3", None),
            ("series_contrib", f"/artist/{ART}/1", None),
            ("artist_sort", f"/artist/{ART}", None),
        ]:
            ctx = br.new_context(viewport={"width": w, "height": hgt})
            if tok:
                ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m, errs=errs: errs.append(m.text) if m.type == "error" else None)
            pg.goto(B + path, wait_until="networkidle")
            pg.evaluate("document.fonts.ready")
            if name == "share_comments":
                pg.wait_for_selector('[data-testid="comment-list"] .lv-tag', timeout=15000)
                n_tag = pg.locator('[data-testid="comment-list"] .lv-tag').count()
                n_com = pg.locator('[data-testid="comment-list"] .comment').count()
                check(f"15d 留言畫面 {w}：每則留言都有等級（{n_tag}/{n_com}）", n_tag == n_com and n_com > 0, (n_tag, n_com))
                pg.locator('[data-testid="comment-list"]').scroll_into_view_if_needed()
            if name == "share_offers":
                pg.locator("section.offers").scroll_into_view_if_needed()
            if name == "series_contrib":
                pg.locator('[data-testid="contributors"]').scroll_into_view_if_needed()
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=name.startswith("profile"))
            ov = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            shots.append((name, w, ov, list(errs)))
            ctx.close()

    # 補發行年（畫面操作）：K2 在系列二按「我知道，補上」
    ctx = br.new_context(viewport={"width": 390, "height": 844})
    ctx.add_cookies([{"name": "yz_session", "value": U["k2"]["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(f"{B}/artist/{ART}/2", wait_until="networkidle")
    pg.wait_for_selector('[data-testid="year-open"]')
    pg.wait_for_timeout(500)
    pg.click('[data-testid="year-open"]')
    pg.fill('[data-testid="year-input"]', "2017")
    pg.screenshot(path=str(IMG / "year_fill_390.jpg"), type="jpeg", quality=80)
    pg.click('[data-testid="year-send"]')
    pg.wait_for_selector("text=已補上發行年 2017", timeout=10000)
    shots.append(("year_fill", 390, pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), list(errs)))
    ctx.close()
    s2b = strip(requests.get(f"{B}/artist/{ART}/2").text)
    check("15e 畫面上補發行年：補完後「發行年待補」消失、標題帶 2017", 'data-testid="year-missing"' not in s2b and f"2017《系列二{STAMP}》專輯發行" in s2b)
    ah2 = strip(requests.get(f"{B}/artist/{ART}").text)
    t2 = re.findall(r'class="tile-title">([^<]+)<', re.search(r'<h2 class="block-title">系列</h2>.*?</ul>', ah2, re.S).group(0))
    check("15f 補上 2017 後系列二排到 2019 之後", [t for t in t2 if STAMP in t and "送審" not in t and "館長" not in t][-1] == f"2017《系列二{STAMP}》專輯發行", t2)
    recompute()
    check("15g K2 畫面補的那筆算「補上缺漏資料」（待入帳）", count(events(U["k2"]["id"]), "fill", "pending") == 1, [(e["source"], e["state"]) for e in events(U["k2"]["id"])])

    # 「這裡沒有，我要新增」新增系列：發行年＋不記得
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": U["d"]["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(B + "/share/new", wait_until="networkidle")
    pg.wait_for_timeout(800)
    pg.fill("#share-form-about", f"等級藝人{STAMP}")
    pg.locator(".suggest button", has_text=f"等級藝人{STAMP}").first.click()
    pg.locator('[data-testid="pick-series"] .pick-add').click()
    pg.wait_for_selector('[data-testid="submit-series"]')
    box = pg.locator('[data-testid="submit-series"]')
    box.locator("input").nth(0).fill(f"畫面送審{STAMP}")
    box.locator('button:has-text("送出審核")').click()
    pg.wait_for_selector("text=填發行年（西元四位數），或勾「不記得」")
    check("15h 新增系列：沒填年份也沒勾不記得 → 提示", True)
    pg.check('[data-testid="submit-series-noyear"]')
    check("15i 勾「不記得」後年份欄停用", pg.is_disabled('[data-testid="submit-series-year"]'))
    box.scroll_into_view_if_needed()
    pg.screenshot(path=str(IMG / "submit_series_1440.jpg"), type="jpeg", quality=80)
    box.locator('button:has-text("送出審核")').click()
    pg.wait_for_selector("text=已送出，等管理員審核", timeout=10000)
    row = sql(f"SELECT year, status FROM series WHERE title = '畫面送審{STAMP}'")
    check("15j 送出後：待審、年份空白", row and row[0] == {"year": "", "status": "pending"}, row)
    shots.append(("submit_series", 1440, pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), list(errs)))
    ctx.close()
    # 定案修改的畫面：後台停權原因、指定等級；系列頁補資料
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": admin["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.goto(B + "/admin/members", wait_until="networkidle")
    pg.fill("#member-q", U["q"]["handle"])
    rowq = pg.locator(f'tr[data-handle="{U["q"]["handle"]}"]')
    rowq.wait_for(timeout=10000)
    rowq.locator('[data-testid="suspend"]').click()
    rowq.locator('[data-testid="suspend-confirm"]').click()
    pg.wait_for_timeout(300)
    no_code = rowq.locator(".field-error").inner_text()
    rowq.locator('[data-testid="suspend-code"]').select_option("spam")
    rowq.locator('[data-testid="suspend-note"]').fill("畫面驗收")
    rowq.locator('[data-testid="suspend-confirm"]').click()
    pg.wait_for_selector(f'tr[data-handle="{U["q"]["handle"]}"][data-status="suspended"]', timeout=10000)
    txt = pg.locator(f'tr[data-handle="{U["q"]["handle"]}"] [data-testid="suspend-reason"]').inner_text()
    check("21a 後台停權：沒選原因會提示；選「洗版或騷擾」加說明後停權，列表顯示原因", no_code == "選一個停權原因" and txt == "洗版或騷擾：畫面驗收", (no_code, txt))
    pg.screenshot(path=str(IMG / "admin_members_suspend.jpg"), type="jpeg", quality=80, full_page=True)
    pg.fill("#member-q", U["g"]["handle"])
    rowg = pg.locator(f'tr[data-handle="{U["g"]["handle"]}"]')
    rowg.wait_for(timeout=10000)
    rowg.locator('[data-testid="level-open"]').click()
    rowg.locator('[data-testid="level-select"]').select_option("5")
    rowg.locator('[data-testid="level-reason"]').fill("畫面驗收")
    rowg.locator('[data-testid="level-confirm"]').click()
    pg.wait_for_selector(f'tr[data-handle="{U["g"]["handle"]}"] [data-testid="level-override"]', timeout=10000)
    lbl = rowg.locator('[data-testid="level-label"]').inner_text()
    pg.screenshot(path=str(IMG / "admin_members_level.jpg"), type="jpeg", quality=80, full_page=True)
    rowg.locator('[data-testid="level-clear"]').click()
    pg.wait_for_selector(f'tr[data-handle="{U["g"]["handle"]}"] [data-testid="level-override"]', state="detached", timeout=10000)
    lbl2 = rowg.locator('[data-testid="level-label"]').inner_text()
    check("21b 後台指定等級：新晉樂迷 Lv.5 → 取消指定回到計算值", lbl == "新晉樂迷 Lv.5" and lbl2 == "新晉樂迷 Lv.1", (lbl, lbl2))
    shots.append(("admin_members_new", 1440, pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), list(errs)))
    ctx.close()
    for w, hgt in [(1440, 900), (390, 844)]:
        ctx = br.new_context(viewport={"width": w, "height": hgt})
        ctx.add_cookies([{"name": "yz_session", "value": U["o"]["tok"], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.goto(f"{B}/artist/{ART2}/1", wait_until="networkidle")
        box = pg.locator(f'[data-testid="field-missing"][data-vkey="{VK["v2"]}"]:has([data-testid="fill-open-year"])')
        box.scroll_into_view_if_needed()
        if w == 1440:
            try:
                pg.wait_for_selector(f'[data-testid="field-missing"][data-vkey="{VK["v2"]}"] [data-testid="fill-open-catalog"]', timeout=10000)
                cat = 1
            except Exception:
                cat = 0
            box.locator('[data-testid="fill-open-region"]').click()
            pg.locator('[data-testid="fill-input"]').fill("香港")
            pg.locator('[data-testid="fill-send"]').click()
            pg.wait_for_selector("text=已補上地區，謝謝", timeout=10000)
            reg = sql(f"SELECT region FROM versions WHERE id = {vids['v2']}")[0]["region"]
            check("21c 系列頁畫面補版本地區：寫進資料、顯示謝謝；登入後辨識細節也有目錄號待補", reg == "香港" and cat == 1, (reg, cat))
        pg.screenshot(path=str(IMG / f"field_fill_{w}.jpg"), type="jpeg", quality=80)
        shots.append(("field_fill", w, pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth"), list(errs)))
        ctx.close()
    br.close()

for name, w, ov, errs in shots:
    check(f"16 {name} {w}：無橫向溢出、console error 0", ov <= 0 and not errs, (ov, errs[:2]))

# 還原暫時改動：L1、Q 恢復
restore("l1")
restore("q")
recompute()

(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"stamp": STAMP, "results": res}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n{sum(r['ok'] for r in res)}/{len(res)}")
sys.exit(0 if all(r["ok"] for r in res) else 1)
