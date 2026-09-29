"""浮水印查證碼：正式站驗收。測試帳號 vctest0929＋session 直接寫 D1，上傳一張照片、發一則收藏（不連系列），
驗完另外跑 _清除測試資料_正式站.py 刪乾淨。token 存 scratchpad，不進 git。"""
import hashlib, json, os, re, secrets, subprocess, time, datetime
from pathlib import Path
import requests
from playwright.sync_api import sync_playwright

B = "https://yinzang.dblzm.workers.dev"
SITE = "/home/dz/AboutAI/專案/music-collectibles/網站"
SP = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/31bf47e6-14cc-465a-a25c-a9df73c93de8/scratchpad"
PHOTO = f"{SP}/wm/record_p.jpg"
IMG = Path(__file__).parent / "img" / "正式站"
IMG.mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
CODE_RE = re.compile(r"^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$")
res = []


def sql(cmd):
    r = subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--remote",
                        "--config", "wrangler.production.jsonc", "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL failed: {r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def check(n, ok, d=""):
    res.append((n, ok))
    print(("PASS " if ok else "FAIL ") + n, str(d)[:300])


def iso(dt=None):
    dt = dt or datetime.datetime.now(datetime.timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


state_f = f"{SP}/vc_prod_state.json"
if os.path.exists(state_f):
    st = json.load(open(state_f))
else:
    uid, handle = "u-vctest0929", "vctest0929"
    tok = secrets.token_urlsafe(32)
    if not sql(f"SELECT id FROM users WHERE id = '{uid}'"):
        sql(f"INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, created_at, updated_at) VALUES ('{uid}', 'vctest0929@vctest.test', '{iso()}', 'disabled', '{handle}', '查證碼驗收帳號', '{iso()}', '{iso()}')")
    exp = iso(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=1))
    sql(f"INSERT INTO sessions (id, user_id, client, expires_at) VALUES ('{hashlib.sha256(tok.encode()).hexdigest()}', '{uid}', 'web', '{exp}')")
    st = {"uid": uid, "handle": handle, "tok": tok}
    json.dump(st, open(state_f, "w"))
handle = st["handle"]

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch()

    def ctx(w, h, login=False, mobile=False):
        c = br.new_context(viewport={"width": w, "height": h}, user_agent=UA, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile)
        if login:
            c.add_cookies([{"name": "yz_session", "value": st["tok"], "domain": "yinzang.dblzm.workers.dev", "path": "/", "httpOnly": True, "secure": True}])
        p = c.new_page()
        p.on("console", lambda m, u=w: m.type == "error" and errs.append(f"{u} {p.url}: {m.text[:200]}"))
        return c, p

    # ---------- 1. 新上傳一張、發一則 ----------
    if "n" not in st:
        c, pg = ctx(1440, 900, login=True)
        pg.goto(B + "/share/new", wait_until="networkidle")
        with pg.expect_response(lambda x: x.url.endswith("/api/uploads") and x.request.method == "POST", timeout=90000) as ri:
            pg.locator("input[type=file]").first.set_input_files(PHOTO)
        up = ri.value.json()
        check("1a 正式站上傳成功、帶查證碼", CODE_RE.match(up.get("code", "")) is not None, up)
        r = pg.evaluate("""async (id) => { const r = await fetch('/api/shares', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin',
            body: JSON.stringify({photoIds: [id], about: ['落日飛車'], story: '查證碼驗收，驗完刪除', tags: [], sale: {state: 'share'}, kind: 'CD'})}); return [r.status, await r.text()]; }""", up["id"])
        check("1b 發文成功", r[0] == 201, r)
        st.update({"n": json.loads(r[1])["n"], "pid": up["id"], "code": up["code"], "thumb": up["thumbUrl"], "main": up["url"]})
        json.dump(st, open(state_f, "w"))
        c.close()
    N, CODE = st["n"], st["code"]
    row = sql(f"SELECT verify_code, share_no, thumb_key, r2_key FROM photos WHERE id = '{st['pid']}'")[0]
    check("1c D1 verify_code 與上傳回傳相同、掛在新收藏", row["verify_code"] == CODE and row["share_no"] == N, row)

    # 公開網址直接開
    c, pg = ctx(1000, 1000)
    resp = pg.goto(B + st["thumb"])
    check("2a 縮圖公開網址（沒登入）200", resp.status == 200, resp.status)
    pg.screenshot(path=str(IMG / "直接開縮圖網址_新上傳_沒登入.jpg"), type="jpeg", quality=80)
    c.close()
    c, pg = ctx(1300, 1700, login=True)
    resp = pg.goto(B + st["main"])
    check("2b 主圖網址（登入）200", resp.status == 200, resp.status)
    pg.screenshot(path=str(IMG / "直接開主圖網址_新上傳_登入.jpg"), type="jpeg", quality=80)
    c.close()

    # ---------- 3. /verify 查新碼 ----------
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = ctx(w, h, mobile=mob)
        pg.goto(f"{B}/verify?c={CODE}", wait_until="networkidle")
        ok = pg.locator("[data-testid=verify-found]").count() == 1 and pg.locator("[data-testid=verify-share]").get_attribute("href") == f"/share/{N}" \
            and pg.locator("[data-testid=verify-author]").get_attribute("href") == f"/u/{handle}"
        ov = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"3a /verify 新碼 {w} 查到正確收藏、發文者、無溢出", ok and ov <= 0, (pg.url, ov))
        pg.screenshot(path=str(IMG / f"verify_查到_{w}.jpg"), type="jpeg", quality=80, full_page=True)
        c.close()

    # ---------- 4. 單則頁、收藏頁（首頁）、使用者的第 3、4 則 ----------
    for path, name in [(f"/share/{N}", f"單則頁_新上傳"), ("/share/4", "單則頁_第4則"), ("/share/3", "單則頁_第3則"), ("/", "首頁收藏")]:
        for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
            c, pg = ctx(w, h, mobile=mob)
            pg.goto(B + path, wait_until="networkidle")
            ov = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
            info = ""
            if path.startswith("/share/"):
                pc = pg.locator("[data-testid=photo-code]")
                info = pc.inner_text() if pc.count() else ""
                check(f"4a {name} {w} 照片下方有查證碼", bool(re.fullmatch(r"查證碼 #[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}", info.strip())), info)
                if path == f"/share/{N}":
                    check(f"4b {name} {w} 碼正確", info.strip() == f"查證碼 #{CODE}", info)
                pc.scroll_into_view_if_needed() if pc.count() else None
            check(f"4c {name} {w} 無水平溢出", ov <= 0, ov)
            pg.screenshot(path=str(IMG / f"{name}_{w}.jpg"), type="jpeg", quality=80)
            c.close()
    # 頁尾
    c, pg = ctx(1440, 900)
    pg.goto(B + "/", wait_until="networkidle")
    check("4d 頁尾有照片查證", pg.locator("footer a[href='/verify']", has_text="照片查證").count() == 1)
    c.close()

    # ---------- 5. 舊照片：舊網址 404、每張都查得到 ----------
    rep = json.load(open(Path(__file__).parent / "重燒報告_正式站.json"))
    olds = [k for it in rep["照片"] for k in it["舊"] if k]
    codes = sql("SELECT p.id, p.verify_code, p.share_no, p.r2_key FROM photos p WHERE p.purpose = 'share' AND p.deleted_at IS NULL AND p.id != '" + st["pid"] + "'")
    st404 = [requests.get(f"{B}/img/{k}", headers={"User-Agent": UA}, timeout=20).status_code for k in olds]
    check(f"5a 重燒前的舊網址 {len(olds)} 個全部 404", all(s == 404 for s in st404), st404)
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")
    detail = []
    for p in codes:
        html = requests.get(f"{B}/verify?c={p['verify_code']}", headers={"User-Agent": UA}, timeout=20).text
        m = re.search(r'data-testid="verify-share"[^>]*href="(/share/\d+)"|href="(/share/\d+)"[^>]*data-testid="verify-share"', html)
        got = (m.group(1) or m.group(2)) if m else ("查無" if "verify-none" in html else "下架" if "verify-gone" in html else "?")
        want = f"/share/{p['share_no']}" if p["share_no"] else "查無"
        detail.append((p["verify_code"], p["share_no"], got))
        check(f"5b 舊照片 {p['id']} #{p['verify_code']} → {want}", got == want and CODE_RE.match(p["verify_code"] or "") is not None, got)
    check("5c 每張照片的查證碼都不同", len({p["verify_code"] for p in codes}) == len(codes))

    # ---------- 6. 查無、已隱藏、限流 ----------
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = ctx(w, h, mobile=mob)
        pg.goto(f"{B}/verify?c=ZZZZZ", wait_until="networkidle")
        check(f"6a 查無 {w}", pg.locator("[data-testid=verify-none]").inner_text() == "查無此查證碼")
        pg.screenshot(path=str(IMG / f"verify_查無_{w}.jpg"), type="jpeg", quality=80, full_page=True)
        c.close()
    sql(f"UPDATE shares SET hidden_at = '{iso()}' WHERE no = {N}")
    for w, h, mob in [(1440, 900, False), (390, 844, True), (360, 780, True)]:
        c, pg = ctx(w, h, mobile=mob)
        pg.goto(f"{B}/verify?c={CODE}", wait_until="networkidle")
        t = pg.locator("[data-testid=verify-gone]").inner_text() if pg.locator("[data-testid=verify-gone]").count() else ""
        check(f"6b 已隱藏 {w}", t == f"這張照片來自樂迷藏會員 @{handle}，收藏已下架", t)
        pg.screenshot(path=str(IMG / f"verify_已下架_{w}.jpg"), type="jpeg", quality=80, full_page=True)
        c.close()
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")
    sts = [requests.get(f"{B}/verify?c=ZZZZ{'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[i]}", headers={"User-Agent": UA}, timeout=20).status_code for i in range(30)]
    c, pg = ctx(390, 844, mobile=True)
    pg.goto(f"{B}/verify?c={CODE}", wait_until="networkidle")
    check("6c 同一 IP 第 31 次被限流", pg.locator("[data-testid=verify-limited]").count() == 1 and pg.locator("[data-testid=verify-gone]").count() == 0, sts[-3:])
    pg.screenshot(path=str(IMG / "verify_限流_390.jpg"), type="jpeg", quality=80, full_page=True)
    c.close()
    keys = sql("SELECT key, count FROM rate_limits WHERE key LIKE 'verify:%'")
    check("6d 限流記在 rate_limits（verify:IP）", len(keys) >= 1 and keys[0]["count"] >= 30, [k["count"] for k in keys])
    sql("DELETE FROM rate_limits WHERE key LIKE 'verify:%'")

    # ---------- 7. 使用條款、robots、預覽圖 ----------
    c, pg = ctx(1440, 900)
    pg.goto(B + "/terms", wait_until="networkidle")
    body = pg.locator("main").inner_text()
    check("7a 條款分享照片段落、沒有「禁止」", "分享時須保留照片上的浮水印" in body and "不得移除、裁掉、遮蓋或修改照片上的浮水印" in body and "禁止" not in body)
    pg.locator("#share-photos").scroll_into_view_if_needed()
    pg.screenshot(path=str(IMG / "使用條款_分享照片_1440.jpg"), type="jpeg", quality=80)
    og = next((k for it in rep["照片"] for k in it["新"] if k.endswith("_og.jpg")), None)
    if og:
        resp = pg.goto(f"{B}/img/{og}")
        check("7b 重燒後的分享預覽圖 200", resp.status == 200, og)
        pg.screenshot(path=str(IMG / "直接開預覽圖網址_重燒後.jpg"), type="jpeg", quality=80)
    c.close()
    rb = requests.get(B + "/robots.txt", headers={"User-Agent": UA}, timeout=20).text
    (IMG.parent / "robots_正式站.txt").write_text(rb, encoding="utf-8")
    bots = ["GPTBot", "ChatGPT-User", "OAI-SearchBot", "Google-Extended", "CCBot", "ClaudeBot", "anthropic-ai", "PerplexityBot", "Bytespider", "Applebot-Extended"]
    check("7c robots.txt 拒絕 AI 爬蟲、一般規則不變", all(f"User-agent: {b}\nDisallow: /\n" in rb for b in bots) and rb.startswith("User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n"))
    hr = requests.get(B + "/", headers={"User-Agent": UA}, timeout=20)
    check("7d noindex 照舊", "noindex" in hr.headers.get("X-Robots-Tag", "") and 'content="noindex' in hr.text)
    br.close()

check("8 console error 0", not errs, errs[:5])
# ---------- 9. 連續瀏覽 100 次 ----------
paths = ["/", "/artists", "/share/3", "/share/4", "/share/5", "/verify", "/about", "/terms", "/guide", "/artist/sunset-rollercoaster"]
codes100 = []
for i in range(100):
    try:
        codes100.append(requests.get(B + paths[i % len(paths)], headers={"User-Agent": UA}, timeout=20).status_code)
    except Exception as e:  # noqa: BLE001
        codes100.append(str(e)[:40])
from collections import Counter
cnt = Counter(codes100)
check("9 連續瀏覽 100 次 503 為 0", cnt.get(503, 0) == 0 and cnt.get(200, 0) == 100, dict(cnt))
print(f"\n{sum(1 for _, ok in res if ok)}/{len(res)} 通過；測試收藏 {N}、碼 {CODE}")
