# MusicBrainz 匯入與曲目顯示＋照片上傳框手機虛線：本機驗收（2026-09-28）
# 用法：python3 _驗收_本機.py <網址，例 http://127.0.0.1:8791> <網站資料夾> [--skip-rerun]
# 前提：本機已跑過 node scripts/import-musicbrainz.mjs --local。可重跑：每次自己建新會員、挑還沒被補過曲目的版本
import io, json, re, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path

import requests

_orig = requests.Session.request
requests.Session.request = lambda self, *a, **kw: _orig(self, *a, **{"timeout": 30, **kw})
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
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js"]
LOCAL = ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]
HOST = B.split("//")[1].split(":")[0]
TURNSTILE_STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){}};"


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:400]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(W + ["d1", "execute", "DB", *LOCAL, "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def one(cmd):
    r = sql(cmd)
    return list(r[0].values())[0] if r else None


def login(email, pw="yinzang-demo"):
    r = requests.post(B + "/api/auth/login", json={"email": email, "password": pw, "turnstileToken": TT, "client": "app"})
    j = r.json()
    if "token" not in j:
        raise SystemExit(f"登入失敗 {email} {j}")
    return {"tok": j["token"], "id": j["user"]["id"], "handle": j["user"]["handle"], "email": email, "name": j["user"]["name"]}


H = lambda u: {"Authorization": f"Bearer {u['tok']}"}
sql("DELETE FROM rate_limits WHERE key LIKE 'register:%' OR key LIKE 'share:%' OR key LIKE 'login:%' OR key LIKE 'edit:%'")
sql("DELETE FROM counters WHERE key LIKE 'quota:detail:%'")
PW = one("SELECT password_hash FROM users WHERE email = 'admin@demo.yinzang.test'")


def mkuser(tag):
    h = f"m{tag}{ST}"
    uid = f"u-{h}"
    sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES "
        f"('{uid}', '{h}@q.test', '{iso(NOW)}', '{PW}', '{h}', '曲目{tag}{ST}', '{iso(NOW)}', '{iso(NOW)}')")
    return login(f"{h}@q.test")


def img_bytes(w, h, color):
    b = io.BytesIO()
    Image.new("RGB", (w, h), color).save(b, "WEBP", quality=80)
    return b.getvalue()


def ctx_for(browser, u=None, w=1280, h=900, mobile=False):
    c = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=TURNSTILE_STUB))
    if u:
        c.add_cookies([{"name": "yz_session", "value": u["tok"], "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")


def skey_of_version(vid):
    r = sql(f"SELECT w.artist_slug || '/' || w.no AS sk, i.item_id AS item, v.version_id AS ver FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = {vid}")[0]
    return r["sk"], f"{r['item']}-{r['ver']}"


# ============================ A. 匯入後的資料 ============================
check("A1 遷移：versions 有 mbid／source／release_date／track_list，series 有 mbid／source，artists 有 mbid",
      all(one(f"SELECT COUNT(*) FROM pragma_table_info('{t}') WHERE name = '{c}'") == 1 for t, c in
          [("versions", "mbid"), ("versions", "source"), ("versions", "release_date"), ("versions", "track_list"), ("series", "mbid"), ("series", "source"), ("items", "source"), ("artists", "mbid")]))
n = sql("SELECT (SELECT COUNT(*) FROM series WHERE source = 'musicbrainz') s, (SELECT COUNT(*) FROM versions WHERE source = 'musicbrainz') v, (SELECT COUNT(*) FROM versions WHERE mbid IS NOT NULL AND source IS NULL) vm, (SELECT COUNT(*) FROM artists WHERE mbid IS NOT NULL) a")[0]
check("A2 有匯入資料（系列、版本、合併版本、藝人 MBID）", n["s"] > 0 and n["v"] > 0 and n["vm"] > 0 and n["a"] == 14, n)
out = sql("SELECT COUNT(*) c FROM series WHERE source = 'musicbrainz' AND artist_slug NOT IN (SELECT slug FROM artists WHERE mbid IS NOT NULL)")[0]["c"]
check("A3 範圍：新建系列都掛在對應成功的 24 位藝人底下", out == 0, out)
dig = one("SELECT COUNT(*) FROM versions WHERE source = 'musicbrainz' AND (edition LIKE '%數位%' OR edition LIKE '%Digital%')")
check("A4 沒有數位發行被建成版本", dig == 0, dig)

if "--skip-rerun" not in sys.argv:
    r = subprocess.run(["node", "scripts/import-musicbrainz.mjs", "--local"], cwd=SITE, capture_output=True, text=True)
    m = re.search(r"本次實際變化： (\{.*\})", r.stdout)
    d = json.loads(m.group(1)) if m else {}
    check("A5 腳本重跑一次：新增、合併、曲目增加都是 0", m and all(v == 0 for v in d.values()), d)

# ============================ B. 頁面 ============================
# 收斂水：2009 首版 14 首、2015 再版 17 首（曲目不同）
SL = sql("SELECT artist_slug || '/' || no AS sk FROM series WHERE mbid = '0164d77e-0e07-42e4-9f28-c03b39a8ece5'")[0]["sk"]
# 多碟：曲目裡有「【第 2 碟」的 MusicBrainz 版本
MV = sql("SELECT id FROM versions WHERE track_list LIKE '%【第 2 碟%' AND mbid IS NOT NULL ORDER BY id LIMIT 1")[0]["id"]
MSK, MANCH = skey_of_version(MV)
# 有條碼的 MusicBrainz 版本（條碼只給登入會員看）
BC = sql("SELECT id, barcode FROM versions WHERE source = 'musicbrainz' AND barcode NOT IN ('', '無條碼') ORDER BY id LIMIT 1")[0]
BSK, BANCH = skey_of_version(BC["id"])

html = requests.get(B + f"/artist/{SL}").text.replace("<!-- -->", "")
check("B1 系列頁有主要曲目區塊，註明依哪個版本", 'data-testid="main-tracks"' in html and "main-tracks-basis" in html,
      re.search(r'main-tracks-basis">([^<]+)<', html).group(1) if "main-tracks-basis" in html else "")
row = re.search(r'data-testid="track-diff-row">(.*?)</tr>', html, re.S)
cells = re.findall(r'data-testid="track-diff">([^<]*)<', row.group(1)) if row else []
check("B2 版本比較表有「曲目差異」列，標出再版多的曲目", row and "比較基準" in cells and any("多了第 15～17 首" in c or "多了第 14～16 首" in c or re.search(r"多了第 1\d", c) for c in cells), cells)
check("B3 來源標示：MusicBrainz 連到 release 頁", re.search(r'href="https://musicbrainz.org/release/[0-9a-f-]{36}"[^>]*>MusicBrainz<', html) is not None)
hb = requests.get(B + f"/artist/{BSK}").text
check("B4 條碼不出現在公開頁面（辨識細節只給登入會員）", BC["barcode"] not in hb, BC["barcode"])

U1, U2 = mkuser("a"), mkuser("b")
det = requests.get(B + f"/api/details?series={BSK}", headers=H(U1))
check("B5 登入會員從 /api/details 拿得到條碼", BC["barcode"] in det.text, det.status_code)

errors = []
with sync_playwright() as pw:
    br = pw.chromium.launch()
    # ---- 多碟、收合 ----
    c = ctx_for(br)
    p = c.new_page()
    p.on("console", lambda m: errors.append(f"{p.url} {m.text}") if m.type == "error" else None)
    p.goto(B + f"/artist/{MSK}#{MANCH}")
    settle(p)
    det_el = p.locator(f"#{MANCH} [data-testid=version-tracks]")
    closed = det_el.evaluate("e => !e.open")
    det_el.locator("summary").click()
    opened = det_el.evaluate("e => e.open")
    discs = det_el.locator(".disc-title").count()
    check("B6 版本的曲目預設收合、點開可展開，多碟分開列", closed and opened and discs >= 2, f"closed={closed} opened={opened} discs={discs}")
    det_el.scroll_into_view_if_needed()
    p.screenshot(path=str(IMG / "多碟曲目_1280.jpg"), type="jpeg", quality=80, full_page=False)
    c.close()

    # ---- 補空白曲目（算補缺漏資料） ----
    EV = sql("SELECT v.id FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id "
             "WHERE v.track_list = '[]' AND v.status = 'approved' AND v.deleted_at IS NULL AND v.hidden_at IS NULL AND i.deleted_at IS NULL AND i.hidden_at IS NULL AND w.status = 'approved' AND w.deleted_at IS NULL AND w.hidden_at IS NULL "
             "AND i.kind = 'CD' AND (v.created_by IS NULL) ORDER BY v.id DESC LIMIT 1")[0]["id"]
    ESK, EANCH = skey_of_version(EV)
    c = ctx_for(br, U1)
    p = c.new_page()
    p.on("console", lambda m: errors.append(f"{p.url} {m.text}") if m.type == "error" else None)
    p.goto(B + f"/artist/{ESK}#{EANCH}")
    settle(p)
    link = p.locator(f"#{EANCH} [data-testid=tracks-edit]")
    txt = link.text_content()
    p.locator(f"#{EANCH} [data-testid=version-tracks] summary").click()
    link.click()
    p.wait_for_selector("#wiki-text")
    p.fill("#wiki-text", "1. 驗收歌一 (3:01)\n2. 驗收歌二 (4:02)\n3. 驗收歌三")
    p.fill("#wiki-summary", "補上曲目")
    p.click("[data-testid=wiki-form] button[type=submit]")
    p.wait_for_url(re.compile(r"^(?!.*edit=).*$"))
    settle(p)
    tl = one(f"SELECT track_list FROM versions WHERE id = {EV}")
    tr = one(f"SELECT tracks FROM versions WHERE id = {EV}")
    ev = sql(f"SELECT kind, points, source FROM score_events WHERE user_id = '{U1['id']}'")
    check("B7 空白版本顯示「補上曲目」，補上後存進版本（3 首）", txt == "補上曲目" and json.loads(tl)[0].startswith("1. 驗收歌一") and tr == "3 首", f"{txt} {tl} {tr}")
    check("B8 補空白曲目記一筆補缺漏資料（fill +10）", any(e["kind"] == "fill" and e["source"] == f"fill:version:{EV}:trackList" and e["points"] == 10 for e in ev), ev)
    body = p.locator(f"#{EANCH} [data-testid=tracks-source]").text_content()
    check("B9 人工補上的曲目顯示修改者", U1["name"] in body, body)
    p.goto(B + f"/artist/{ESK}/history?tracks={EANCH}")
    settle(p)
    revs = p.locator("text=補上曲目").count()
    check("B10 曲目歷史頁列出這次修改", revs >= 1 and "曲目" in p.title(), p.title())
    p.screenshot(path=str(IMG / "曲目歷史_1280.jpg"), type="jpeg", quality=80)
    c.close()

    # ---- 修改 MusicBrainz 帶入的曲目（算編輯） ----
    MBV = sql("SELECT v.id FROM versions v WHERE v.source = 'musicbrainz' AND v.track_list <> '[]' AND v.status = 'approved' AND NOT EXISTS (SELECT 1 FROM revisions r WHERE r.field = 'tracks' AND r.target LIKE '%#' || (SELECT item_id FROM items WHERE id = v.item_ref) || '-' || v.version_id AND r.target LIKE 'tracks:' || (SELECT w.artist_slug || '/' || w.no FROM items i JOIN series w ON w.id = i.series_id WHERE i.id = v.item_ref) || '#%') ORDER BY v.id DESC LIMIT 1")[0]["id"]
    MSK2, MANCH2 = skey_of_version(MBV)
    old = json.loads(one(f"SELECT track_list FROM versions WHERE id = {MBV}"))
    r = requests.post(B + "/api/revisions", headers=H(U2), json={"target": f"tracks:{MSK2}#{MANCH2}", "content": old[:-1] + [old[-1] + "（驗收修正）"], "summary": "修正最後一首歌名", "baseId": 0})
    ev2 = sql(f"SELECT kind, detail FROM score_events WHERE user_id = '{U2['id']}'")
    base = sql(f"SELECT author_id, summary FROM revisions WHERE target = 'tracks:{MSK2}#{MANCH2}' ORDER BY id")
    check("B11 修改匯入的曲目：先存初始版本（取自 MusicBrainz），再存修改，記一筆編輯事件",
          r.status_code == 201 and len(base) == 2 and base[0]["author_id"] is None and "MusicBrainz" in base[0]["summary"] and any(e["kind"] == "edit" for e in ev2), f"{r.status_code} {base} {ev2}")
    h2 = requests.get(B + f"/artist/{MSK2}").text.replace("<!-- -->", "")
    blk = h2[h2.index(f'id="{MANCH2}"'):]
    blk = blk[:blk.index("</details>")]
    check("B12 人工修改過的 MusicBrainz 曲目：同時顯示來源與修改者", "MusicBrainz" in blk and U2["name"] in blk, re.sub("<[^>]+>", " ", blk[-400:]))

    # ---- 寬度：受影響頁面 320／390／1440 無溢出、console 0 ----
    pages = [f"/artist/{SL}", f"/artist/{MSK}", f"/artist/{ESK}/history?tracks={EANCH}", "/share/new"]
    bad = []
    for w in (320, 390, 1440):
        c = ctx_for(br, w=w, h=900, mobile=w < 700)
        p = c.new_page()
        p.on("console", lambda m: errors.append(f"{p.url} {m.text}") if m.type == "error" else None)
        for path in pages:
            p.goto(B + path)
            settle(p)
            p.evaluate("document.querySelectorAll('details.tracks').forEach(d => d.open = true)")
            o = p.evaluate("() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth})")
            if o["sw"] > o["cw"]:
                bad.append((w, path, o))
            if path == f"/artist/{SL}":
                p.locator("[data-testid=track-diff-row]").first.scroll_into_view_if_needed()
                p.screenshot(path=str(IMG / f"曲目差異_{w}.jpg"), type="jpeg", quality=80)
                p.locator("[data-testid=main-tracks]").scroll_into_view_if_needed()
                p.screenshot(path=str(IMG / f"主要曲目_{w}.jpg"), type="jpeg", quality=80)
        c.close()
    check("B13 受影響頁面 320／390／1440 無橫向溢出", not bad, bad)

    # ---- C. 照片上傳框手機虛線 ----
    meas = []
    for w in (320, 360, 375, 390, 414):
        c = ctx_for(br, w=w, h=800, mobile=True)
        p = c.new_page()
        p.on("console", lambda m: errors.append(f"{p.url} {m.text}") if m.type == "error" else None)
        p.goto(B + "/share/new")
        settle(p)
        m = p.evaluate("""() => {const d = document.querySelector('label.drop'); const main = document.querySelector('main'); const cs = getComputedStyle(main);
            const mr = main.getBoundingClientRect(); const r = d.getBoundingClientRect(); const ds = getComputedStyle(d);
            return {vw: innerWidth, dl: r.left, dr: r.right, cl: mr.left + parseFloat(cs.paddingLeft), cr: mr.right - parseFloat(cs.paddingRight),
                    bl: ds.borderLeftStyle + ' ' + ds.borderLeftWidth, br: ds.borderRightStyle + ' ' + ds.borderRightWidth}}""")
        m["w"] = w
        meas.append(m)
        p.locator("label.drop").scroll_into_view_if_needed()
        p.screenshot(path=str(IMG / f"上傳框_{w}.jpg"), type="jpeg", quality=80)
        c.close()
    okm = all(m["dl"] >= 0 and m["dr"] <= m["vw"] and abs(m["dl"] - m["cl"]) <= 2 and abs(m["dr"] - m["cr"]) <= 2 and "dashed" in m["bl"] and "dashed" in m["br"] for m in meas)
    check("C1 /share/new 照片上傳框 320／360／375／390／414：左右緣在畫面內、與正文左右緣差 2px 內、左右都是虛線", okm,
          [(m["w"], m["dl"], m["dr"], m["cl"], m["cr"]) for m in meas])

    # 編輯照片（單則頁）也用同一個元件：建一則自己的收藏再開編輯照片
    def upload(u):
        r = requests.post(B + "/api/uploads", headers=H(u), files={"image": ("p.webp", img_bytes(800, 600, (90, 60, 60)), "image/webp"), "thumb": ("t.webp", img_bytes(320, 240, (90, 60, 60)), "image/webp")}, data={"purpose": "share"})
        return r.json()["id"]
    aname = one("SELECT name FROM artists WHERE slug = 'gordon'")
    rs = requests.post(B + "/api/shares", headers=H(U1), json={"photoIds": [upload(U1)], "about": [aname], "kind": "T 恤", "story": "", "tags": [], "sale": {"state": "share"}})
    sn = rs.json().get("n")
    meas2 = []
    for w in (320, 390):
        c = ctx_for(br, U1, w=w, h=800, mobile=True)
        p = c.new_page()
        p.goto(B + f"/share/{sn}")
        settle(p)
        p.click("[data-testid=photo-edit-open]")
        p.wait_for_selector("[data-testid=photo-edit] label.drop")
        m = p.evaluate("""() => {const d = document.querySelector('[data-testid=photo-edit] label.drop'); const box = d.closest('.pp').getBoundingClientRect(); const r = d.getBoundingClientRect();
            return {vw: innerWidth, dl: r.left, dr: r.right, pl: box.left, pr: box.right}}""")
        m["w"] = w
        meas2.append(m)
        p.locator("[data-testid=photo-edit] label.drop").scroll_into_view_if_needed()
        p.screenshot(path=str(IMG / f"編輯照片_{w}.jpg"), type="jpeg", quality=80)
        c.close()
    check("C2 單則頁「編輯照片」的上傳框：左右緣在畫面內、撐滿編輯框內緣", sn and all(m["dl"] >= 0 and m["dr"] <= m["vw"] and abs(m["dl"] - m["pl"]) <= 2 and abs(m["dr"] - m["pr"]) <= 2 for m in meas2),
          [(m["w"], m["dl"], m["dr"], m["pl"], m["pr"]) for m in meas2])
    br.close()

errs = [e for e in errors if "turnstile" not in e.lower()]
check("D1 以上頁面 console error 0", not errs, errs[:5])

ok = sum(r["ok"] for r in res)
print(f"\n{ok}/{len(res)} 通過")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps({"at": iso(datetime.now(timezone.utc)), "pass": ok, "total": len(res), "results": res}, ensure_ascii=False, indent=1))
