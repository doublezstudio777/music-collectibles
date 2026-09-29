# 新手指南批次驗收（2026-09-29）：/guide、/feedback、補上按鈕、/ranking、新增 +15 當下入帳
# 用法：python3 _驗收_本機.py http://127.0.0.1:8791
# 只動本機資料庫。榮譽榜的測試分數用 source 以 'rktest:' 開頭的事件，每次開跑先清掉上一輪的
import json, re, subprocess, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
SITE = OUT.parent.parent / "網站"
HOST = B.split("//")[1].split(":")[0]
TT = "XXXX.DUMMY.TOKEN.XXXX"
STUB = "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('XXXX.DUMMY.TOKEN.XXXX')},30);return 'stub'},remove:function(){},reset:function(){}};"
ST = str(int(time.time()))[-5:]
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js"]
LOCAL = ["--local", "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state"]
PHOTO = next(p for p in (OUT.parent / "20260929_用字與版本欄" / "img").glob("*.jpg"))
res = []


def check(n, ok, d=""):
    res.append({"name": n, "ok": bool(ok), "detail": str(d)[:600]})
    print(("PASS " if ok else "FAIL ") + n, str(d)[:260], flush=True)


def sql(cmd):
    r = subprocess.run(W + ["d1", "execute", "DB", *LOCAL, "--json", "--command", cmd], cwd=SITE, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"SQL 失敗：{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]


def login(email):
    return requests.post(B + "/api/auth/login", json={"email": email, "password": "yinzang-demo", "turnstileToken": TT, "client": "app"}, timeout=30).json()["token"]


def recompute(tok):
    r = requests.post(B + "/api/admin/scores", json={}, headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    assert r.status_code == 200, r.text
    return r.json()


sql("DELETE FROM rate_limits WHERE key LIKE 'login:%' OR key LIKE 'feedback:%' OR key LIKE 'submit:%' OR key LIKE 'fill:%'")
sql("DELETE FROM counters WHERE key LIKE 'quota:%'")
TOK = login("r01@demo.yinzang.test")
ADM = login("admin@demo.yinzang.test")
R01 = sql("SELECT id, email FROM users WHERE email = 'r01@demo.yinzang.test'")[0]


def ctx(br, w, h=900, mobile=False, tok=TOK):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, is_mobile=mobile, has_touch=mobile)
    c.route("https://challenges.cloudflare.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body=STUB))
    if tok:
        c.add_cookies([{"name": "yz_session", "value": tok, "domain": HOST, "path": "/", "httpOnly": True}])
    return c


def settle(p):
    p.wait_for_load_state("networkidle")
    p.evaluate("document.fonts.ready")
    time.sleep(0.4)


def shot(p, name, full=False):
    p.screenshot(path=str(IMG / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def overflow(p):
    return p.evaluate("() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })")


def load_all_images(p):
    p.evaluate("""async () => { for (const i of document.querySelectorAll('img[loading=lazy]')) i.loading = 'eager';
      await Promise.all([...document.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); }""")


# ---------- 期望正文：v3 草稿 ----------
v3 = (OUT / "文案草稿_v3.md").read_text(encoding="utf-8").splitlines()
expect = []
for ln in v3:
    s = ln.strip()
    if not s or s.startswith("# ") or re.match(r"^\|[-: |]+\|$", s):
        continue
    if s.startswith("## "):
        expect.append(s[3:])
    elif s.startswith("- "):
        expect.append(s[2:])
    elif s.startswith("|"):
        expect.append(" | ".join(x.strip() for x in s.strip("|").split("|")))
    else:
        expect.append(s)

GUIDE_TOKENS_JS = """() => { const out = []; const root = document.querySelector('[data-testid=guide-content]');
  for (const el of root.querySelectorAll('h2, h3, li, p, tr')) {
    if (el.tagName === 'TR') out.push([...el.children].map(c => c.innerText.trim()).join(' | '));
    else if (!el.closest('li') || el.tagName === 'LI') out.push(el.innerText.trim());
  }
  return out; }"""

levels_ts = (SITE / "lib/levels.ts").read_text(encoding="utf-8")
_blk = re.search(r"export const LEVELS = \[(.*?)\] as const", levels_ts, re.S).group(1)
LEVELS = [int(x) for l in _blk.splitlines() for x in re.findall(r"\d+", l.split("//")[0])]
TIERS = re.findall(r'"([^"]+)"', re.search(r"export const TIERS = \[(.*?)\]", levels_ts).group(1))
rules = (SITE / "lib/score-rules.ts").read_text(encoding="utf-8")
num = lambda k: int(re.search(rf"\b{k}: (-?\d+)", rules).group(1))
const = lambda k: int(re.search(rf"export const {k} = (\d+)", rules).group(1))
pts = lambda x: f"−{abs(x)}" if x < 0 else f"+{x}"
POINT_EXPECT = [
    ["編輯藝人頁、專輯頁", f"{pts(num('edit'))}；單次 {const('BIG_CHARS')} 字以上 {pts(num('editBig'))}", "無"],
    ["新增藝人、專輯、版本", pts(num("create")), "無"],
    ["藝人照片獲採用", pts(num("create")), "無"],
    ["發布收藏", pts(num("share")), f"{num('shareDay')} 則"],
    ["補上空白資料", pts(num("fill")), f"{num('fillDay')} 次"],
    ["檢舉成立", pts(num("reportOk")), "無"],
    ["檢舉不成立", pts(num("reportBad")), "無"],
    ["成交", pts(num("deal")), "無"],
    ["留言", pts(num("comment")), f"{num('commentDay')} 則"],
    ["按讚", pts(num("likeGive")), f"{num('likeGiveDay')} 次"],
    ["收到讚、收到留言", pts(num("likeRecv")), f"每則收藏各 {num('likeRecvPerShare')}"],
]

with sync_playwright() as pw:
    br = pw.chromium.launch()

    # ---------- 1. /guide 正文逐字、表格、圖 ----------
    for w, h, mob in ((1440, 900, False), (390, 844, True)):
        c = ctx(br, w, h, mob, tok=None)
        p = c.new_page()
        cerr = []
        p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
        p.goto(B + "/guide")
        settle(p)
        load_all_images(p)
        got = p.evaluate(GUIDE_TOKENS_JS)
        body = got[: len(got) - 4]  # 最後兩段「開發中」「意見回饋」是 v3 之外補的
        if w == 1440:
            check("1a /guide 正文與 v3 逐字相同（標題、條列、段落、表格逐列）", body == expect, [(i, a, b) for i, (a, b) in enumerate(zip(body, expect)) if a != b][:5] or (len(body), len(expect)))
            check("1b 最後兩段：開發中／更多功能開發中、意見回饋／連到 /feedback", got[-4:-2] == ["開發中", "更多功能開發中"] and got[-2] == "意見回饋"
                  and p.locator("#feedback a[href='/feedback']").count() == 1, got[-4:])
            lv = p.evaluate("() => [...document.querySelectorAll('[data-testid=guide-levels] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
            want = [[TIERS[t]] + [f"{v:,}" for v in LEVELS[t * 5: t * 5 + 5]] for t in range(5)]
            check("1c 等級表 25 個門檻與 lib/levels.ts 一致", lv == want, lv)
            pt = p.evaluate("() => [...document.querySelectorAll('[data-testid=guide-points] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
            check("1d 得分表 11 列×3 欄與 lib/score-rules.ts 常數一致", pt == POINT_EXPECT, pt)
            ids = p.evaluate("() => [...document.querySelectorAll('[data-testid=guide-content] [id]')].map(e => e.id)")
            check("1e 各段錨點", ids == ["share", "contribute", "trade", "report", "levels", "titles", "upcoming", "feedback"], ids)
            where = p.evaluate("""() => Object.fromEntries([...document.querySelectorAll('[data-guide-img]')].map(i => [i.dataset.guideImg, i.closest('section').id + (i.closest('#titles') ? '#titles' : '')]))""")
            check("1f 圖放在對的段落", where == {"howto-share": "share", "howto-edit": "contribute", "howto-report": "report", "levels-desktop": "levels", "points-desktop": "levels", "titles": "levels#titles"}, where)
            alts = p.evaluate("() => [...document.querySelectorAll('[data-guide-img]')].map(i => i.alt)")
            check("1g 每張圖都有 alt（圖上內容摘要）", all(len(a) > 8 for a in alts), alts)
        imgs = p.evaluate("() => [...document.querySelectorAll('[data-guide-img]')].map(i => ({ k: i.dataset.guideImg, src: i.currentSrc.split('/').pop(), ok: i.complete && i.naturalWidth > 0 }))")
        kind = "mobile" if w == 390 else "desktop"
        pics = {x["k"]: x["src"] for x in imgs}
        check(f"1h {w} 等級階梯、得分方式載入{('手機' if w == 390 else '桌機')}版", pics["levels-desktop"].startswith(f"levels-{kind}") and pics["points-desktop"].startswith(f"points-{kind}"), pics)
        check(f"1i {w} 8 張圖全部載入成功", len(imgs) == 6 and all(x["ok"] for x in imgs), imgs)
        o = overflow(p)
        check(f"1j {w} /guide 無橫向溢出", o["sw"] <= o["cw"], o)
        check(f"1k {w} /guide console error 0", not cerr, cerr)
        shot(p, f"G{w}_01_新手指南", full=True)
        p2 = c.new_page()
        p2.goto(B + "/guide#levels")
        settle(p2)
        shot(p2, f"G{w}_02_新手指南_等級段")
        c.close()

    # 320 溢出
    c = ctx(br, 320, 700, True, tok=None)
    p = c.new_page()
    for path in ("/guide", "/feedback", "/ranking"):
        p.goto(B + path)
        settle(p)
        o = overflow(p)
        check(f"1l 320 {path} 無橫向溢出", o["sw"] <= o["cw"], o)
    c.close()

    # ---------- 2. 等級標籤 → /guide#levels ----------
    c = ctx(br, 1440, tok=None)
    p = c.new_page()
    p.goto(B + "/")
    settle(p)
    tags = p.locator("[data-testid=lv-tag]")
    nested = p.evaluate("() => [...document.querySelectorAll('[data-testid=lv-tag]')].filter(t => t.parentElement.closest('a')).length")
    check("2a 首頁等級標籤都是連結、沒有包在別的連結裡", tags.count() > 0 and nested == 0 and all(h == "/guide#levels" for h in p.evaluate("() => [...document.querySelectorAll('[data-testid=lv-tag]')].map(t => t.getAttribute('href'))")), (tags.count(), nested))
    tags.first.click()
    p.wait_for_url(re.compile(r"/guide#levels$"), timeout=15000)
    settle(p)
    top = p.evaluate("() => document.getElementById('levels').getBoundingClientRect().top")
    check("2b 點卡片上的等級標籤跳到 /guide#levels，等級段在畫面頂端", 0 <= top < 200, top)
    shot(p, "L1440_01_點等級標籤後")
    sh = sql("SELECT no FROM shares WHERE deleted_at IS NULL AND hidden_at IS NULL ORDER BY no DESC LIMIT 1")[0]["no"]
    p.goto(B + f"/share/{sh}")
    settle(p)
    p.locator(".detail-by [data-testid=lv-tag]").click()
    p.wait_for_url(re.compile(r"/guide#levels$"), timeout=15000)
    check("2c 單則頁發文者的等級標籤也連到 /guide#levels", True)
    c.close()

    # ---------- 3. 個人頁「新手指南」對話框 ----------
    for w, h, mob in ((1440, 900, False), (390, 844, True)):
        c = ctx(br, w, h, mob)
        p = c.new_page()
        cerr = []
        p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
        p.goto(B + "/u/r01")
        settle(p)
        p.click("[data-testid=guide-open]")
        p.wait_for_selector("[data-testid=guide-dialog]")
        time.sleep(0.6)
        toks = p.evaluate(GUIDE_TOKENS_JS)
        check(f"3a {w} 對話框內容與 /guide 相同", toks[: len(toks) - 4] == expect and toks[-4:-2] == ["開發中", "更多功能開發中"], len(toks))
        box = p.evaluate("() => { const r = document.querySelector('[data-testid=guide-dialog]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, width: r.width, vh: innerHeight, vw: innerWidth }; }")
        if w == 390:
            check("3b 390 對話框從底部滑出（貼齊底部、滿寬）", abs(box["bottom"] - box["vh"]) <= 1 and box["left"] == 0 and abs(box["width"] - box["vw"]) <= 1, box)
        else:
            check("3b 1440 對話框置中", abs(box["left"] + box["width"] / 2 - box["vw"] / 2) <= 1, box)
        shot(p, f"D{w}_01_個人頁新手指南對話框")
        o = overflow(p)
        check(f"3c {w} 對話框開著無橫向溢出", o["sw"] <= o["cw"], o)
        p.keyboard.press("Escape")
        time.sleep(0.3)
        check(f"3d {w} Esc 關閉", p.locator("[data-testid=guide-dialog]").count() == 0)
        check(f"3e {w} 個人頁 console error 0", not cerr, cerr)
        c.close()
    c = ctx(br, 1440)
    p = c.new_page()
    p.goto(B + "/u/r02")
    settle(p)
    check("3f 看別人的個人頁沒有「新手指南」按鈕", p.locator("[data-testid=guide-open]").count() == 0)
    c.close()

    # ---------- 4. 意見回饋 ----------
    sql("DELETE FROM rate_limits WHERE key LIKE 'feedback:%'")
    before = sql("SELECT COALESCE(MAX(id), 0) AS m FROM feedback")[0]["m"]
    # 4a 未登入
    c = ctx(br, 390, 844, True, tok=None)
    p = c.new_page()
    p.goto(B + "/feedback")
    settle(p)
    shot(p, "F390_01_意見回饋_未登入")
    p.click("[data-testid=fb-kind-suggest]")
    p.fill("[data-testid=fb-body]", f"驗收：未登入送出 {ST}")
    p.click("[data-testid=fb-submit]")
    time.sleep(0.5)
    check("4a 未登入沒填 Email 擋下", "Email" in p.inner_text("[data-testid=fb-error]"))
    p.fill("[data-testid=fb-email]", f"guest{ST}@example.com")
    p.set_input_files("[data-testid=fb-photo]", str(PHOTO))
    p.wait_for_selector(".fb-thumb")
    p.click("[data-testid=fb-submit]")
    p.wait_for_selector("[data-testid=feedback-done]", timeout=20000)
    check("4b 未登入送出顯示「已收到」", p.inner_text("[data-testid=feedback-done]").strip() == "已收到")
    shot(p, "F390_02_已收到")
    row = sql(f"SELECT * FROM feedback WHERE id > {before} ORDER BY id DESC LIMIT 1")[0]
    check("4c 資料庫：類型功能建議、user_id 空、Email、附件照片", row["kind"] == "suggest" and row["user_id"] is None and row["email"] == f"guest{ST}@example.com" and row["photo_key"].startswith("f/"), row)
    c.close()
    # 4d 已登入
    c = ctx(br, 1440)
    p = c.new_page()
    p.goto(B + "/feedback")
    settle(p)
    p.wait_for_function("() => document.querySelector('[data-testid=fb-email]').value !== ''", timeout=10000)
    pre = p.input_value("[data-testid=fb-email]")
    check("4d 已登入 Email 預設帶自己的", pre == R01["email"], pre)
    shot(p, "F1440_01_意見回饋_已登入")
    p.click("[data-testid=fb-kind-data]")
    p.fill("[data-testid=fb-body]", f"驗收：已登入送出 {ST}")
    p.click("[data-testid=fb-submit]")
    p.wait_for_selector("[data-testid=feedback-done]", timeout=20000)
    row2 = sql(f"SELECT * FROM feedback WHERE id > {row['id']} ORDER BY id DESC LIMIT 1")[0]
    check("4e 已登入送出：user_id＝r01、Email＝帳號的、沒有照片", row2["user_id"] == R01["id"] and row2["email"] == R01["email"] and row2["photo_key"] is None and row2["kind"] == "data", row2)
    c.close()
    # 4f Turnstile
    n0 = sql("SELECT COUNT(*) n FROM feedback")[0]["n"]
    r = requests.post(B + "/api/feedback", files={"kind": (None, "other"), "body": (None, "沒有 token"), "email": (None, "x@example.com"), "turnstileToken": (None, "")}, timeout=30)
    check("4f Turnstile 沒過 → 400 TURNSTILE_FAILED，沒有寫入", r.status_code == 400 and r.json()["error"]["code"] == "TURNSTILE_FAILED" and sql("SELECT COUNT(*) n FROM feedback")[0]["n"] == n0, r.text)
    # 4g 頻率：每 IP 每小時 5 則（前面 UI 已送 2 則，先清掉重算）
    sql("DELETE FROM rate_limits WHERE key LIKE 'feedback:%'")
    codes = [requests.post(B + "/api/feedback", files={"kind": (None, "other"), "body": (None, f"頻率 {i} {ST}"), "email": (None, "rl@example.com"), "turnstileToken": (None, TT)}, timeout=30).status_code for i in range(6)]
    check("4g 第 1～5 則 201，第 6 則 429", codes == [201] * 5 + [429], codes)
    r = requests.post(B + "/api/feedback", files={"kind": (None, "other"), "body": (None, "字" * 2001), "email": (None, "rl@example.com"), "turnstileToken": (None, TT)}, timeout=30)
    check("4h 超過 2000 字擋下", r.status_code in (400, 429), r.status_code)
    sql("DELETE FROM rate_limits WHERE key LIKE 'feedback:%'")
    # 4i 後台
    c = ctx(br, 1440, tok=ADM)
    p = c.new_page()
    p.goto(B + "/admin")
    settle(p)
    p.wait_for_selector("[data-testid=queue-feedback]", timeout=15000)
    openN = sql("SELECT COUNT(*) n FROM feedback WHERE status = 'open'")[0]["n"]
    check("4i 儀表板顯示未處理件數", p.inner_text("[data-testid=queue-feedback] b").strip() == str(openN), (p.inner_text("[data-testid=queue-feedback]"), openN))
    p.goto(B + "/admin/feedback")
    settle(p)
    p.wait_for_selector("[data-testid=fb-open]")
    item = p.locator(f"[data-testid=fb-item][data-id='{row['id']}']")
    check("4j 後台看得到未登入那則（含附件照片）", item.count() == 1 and item.locator("img").count() == 1 and p.evaluate(f"() => document.querySelector(\"[data-testid=fb-item][data-id='{row['id']}'] img\").naturalWidth") > 0)
    item.locator("[data-testid=fb-note]").fill("已回信說明")
    item.locator("[data-testid=fb-save-note]").click()
    p.wait_for_selector("text=已儲存")
    shot(p, "A1440_01_後台意見回饋")
    item.locator("[data-testid=fb-done]").click()
    p.wait_for_selector(f"[data-testid=fb-done-list] [data-testid=fb-item][data-id='{row['id']}']", timeout=10000)
    row3 = sql(f"SELECT status, note, handled_by FROM feedback WHERE id = {row['id']}")[0]
    check("4k 標記已處理＋內部備註寫進資料庫", row3["status"] == "done" and row3["note"] == "已回信說明" and row3["handled_by"], row3)
    shot(p, "A1440_02_標記已處理後", full=True)
    r = requests.get(B + f"/api/admin/feedback/photo?id={row['id']}&size=thumb", headers={"Authorization": f"Bearer {TOK}"}, timeout=30)
    check("4l 附件照片一般會員拿不到（403／401）", r.status_code in (401, 403), r.status_code)
    c.close()
    # 4m 法務頁連結預選類型
    c = ctx(br, 1440, tok=None)
    p = c.new_page()
    for path, kind in (("/privacy", "privacy"), ("/terms", "takedown")):
        p.goto(B + path)
        settle(p)
        txt = p.inner_text("main")
        p.click("[data-testid=legal-feedback]")
        p.wait_for_url(re.compile(rf"/feedback\?type={kind}$"))
        settle(p)
        check(f"4m {path} 沒有「聯絡信箱待補」，連結預選「{kind}」", "待補" not in txt and p.is_checked(f"[data-testid=fb-kind-{kind}]"))
    c.close()

    # ---------- 5. 補上按鈕：發行年待補 ----------
    sql("DELETE FROM rate_limits WHERE key LIKE 'fill:%'")
    w5 = sql(f"SELECT id, artist_slug, no, created_by FROM series WHERE status = 'approved' AND deleted_at IS NULL AND hidden_at IS NULL AND kind != 'misc' AND year NOT GLOB '[0-9][0-9][0-9][0-9]*' AND (created_by IS NULL OR created_by != '{R01['id']}') AND artist_slug IN (SELECT slug FROM artists WHERE deleted_at IS NULL AND hidden_at IS NULL AND status = 'approved') ORDER BY id DESC LIMIT 1")
    if not w5:
        check("5 找得到發行年待補的系列", False)
    else:
        w5 = w5[0]
        skey = f"{w5['artist_slug']}/{w5['no']}"
        recompute(ADM)
        pend0 = (sql(f"SELECT pending FROM user_scores WHERE user_id = '{R01['id']}'") or [{"pending": 0}])[0]["pending"]
        # 訪客點「補上」→ 登入面板 → 登入後回到原頁繼續
        c = ctx(br, 390, 844, True, tok=None)
        p = c.new_page()
        p.goto(B + f"/artist/{skey}")
        settle(p)
        btn = p.locator("[data-testid=year-open]")
        check("5a 發行年待補旁邊是「補上」按鈕（雙字）", btn.inner_text().strip() == "補上", btn.inner_text())
        shot(p, "B390_01_發行年待補")
        btn.click()
        p.wait_for_selector("[data-testid=auth-panel]")
        check("5b 訪客點了先請他登入", p.locator("[data-testid=auth-panel]").is_visible())
        p.fill("[data-testid=auth-panel] input[type=email]", "r01@demo.yinzang.test")
        p.fill("[data-testid=auth-panel] input[type=password]", "yinzang-demo")
        time.sleep(0.5)
        p.click("[data-testid=auth-panel] button[type=submit]")
        p.wait_for_selector("[data-testid=year-input]", timeout=15000)
        check("5c 登入後回到原頁、直接進入發行年的編輯", p.url.endswith(f"/artist/{skey}") and p.locator("[data-testid=year-input]").is_visible(), p.url)
        p.fill("[data-testid=year-input]", "2011")
        p.click("[data-testid=year-send]")
        p.wait_for_selector("text=已補上發行年 2011", timeout=15000)
        shot(p, "B390_02_補上發行年後")
        y = sql(f"SELECT year FROM series WHERE id = {w5['id']}")[0]["year"]
        ev = sql(f"SELECT points, state FROM score_events WHERE source = 'fill:series:{w5['id']}:year'")
        recompute(ADM)
        pend1 = sql(f"SELECT pending FROM user_scores WHERE user_id = '{R01['id']}'")[0]["pending"]
        check("5d 欄位＝2011、補資料事件 +10 待入帳、待入帳分數 +10", y == "2011" and ev and ev[0]["points"] == 10 and pend1 - pend0 == 10, (y, ev, pend0, pend1))
        c.close()
    # 5e 其他空白欄位：簡介、版本欄位、曲目
    c = ctx(br, 1440)
    p = c.new_page()
    a5 = sql("SELECT slug FROM artists WHERE status = 'approved' AND deleted_at IS NULL AND hidden_at IS NULL AND (intro IS NULL OR intro = '[]' OR intro = '') AND display = 'on' LIMIT 1") or sql("SELECT slug FROM artists WHERE status = 'approved' AND deleted_at IS NULL AND hidden_at IS NULL AND (intro IS NULL OR intro = '[]' OR intro = '') LIMIT 1")
    p.goto(B + f"/artist/{a5[0]['slug']}")
    settle(p)
    ib = p.locator("[data-testid=intro-fill]")
    check("5e 藝人頁沒有簡介 → 「簡介待補」旁有「補上」", ib.count() == 1 and ib.inner_text().strip() == "補上", a5)
    ib.click()
    p.wait_for_url(re.compile(r"\?edit=1#intro$"))
    settle(p)
    check("5f 點了直接進簡介編輯", p.locator("#intro textarea, #intro [contenteditable]").count() > 0, p.url)
    if "skey" in dir():
        p.goto(B + f"/artist/{skey}")
        settle(p)
        labels = p.evaluate("() => [...document.querySelectorAll('[data-testid^=fill-open-], [data-testid=tracks-edit].fill-btn, [data-testid=body-fill]')].map(b => b.innerText.trim())")
        check("5g 系列頁版本欄位、曲目、正文的空白處按鈕一律「補上」", labels and set(labels) == {"補上"}, labels)
        shot(p, "B1440_03_系列頁補上按鈕", full=True)
    c.close()

    # ---------- 6. 新增 +15 當下入帳 ----------
    s0 = (sql(f"SELECT score FROM user_scores WHERE user_id = '{R01['id']}'") or [{"score": 0}])[0]["score"]
    r = requests.post(B + "/api/catalog/submit", json={"type": "artist", "name": f"驗收藝人{ST}"}, headers={"Authorization": f"Bearer {TOK}"}, timeout=30)
    slug = r.json().get("key")
    s1 = sql(f"SELECT score FROM user_scores WHERE user_id = '{R01['id']}'")[0]["score"]
    ca = sql(f"SELECT id FROM catalog_additions WHERE type = 'artist' AND ref = '{slug}'")[0]["id"]
    ev = sql(f"SELECT state, points FROM score_events WHERE source = 'artist:ca:{ca}'")
    check("6a 新增藝人：不等排程，分數當下 +15、事件已入帳", r.status_code == 201 and s1 - s0 == 15 and ev == [{"state": "credited", "points": 15}], (r.status_code, s0, s1, ev))
    recompute(ADM)
    s2 = sql(f"SELECT score FROM user_scores WHERE user_id = '{R01['id']}'")[0]["score"]
    check("6b 排程重算後不會重複給分", s2 == s1 and len(sql(f"SELECT id FROM score_events WHERE source LIKE 'artist:ca:{ca}'")) == 1, (s1, s2))
    sql(f"UPDATE artists SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = '{slug}'")
    recompute(ADM)
    s3 = sql(f"SELECT score FROM user_scores WHERE user_id = '{R01['id']}'")[0]["score"]
    check("6c 藝人被合併／刪除後，下次彙總扣回 15", s2 - s3 == 15, (s2, s3))

    # ---------- 7. 榮譽榜 ----------
    sql("DELETE FROM score_events WHERE source LIKE 'rktest:%'")
    users = sql("SELECT id, handle FROM users WHERE status = 'active' AND email LIKE 'r%@demo.yinzang.test' ORDER BY email LIMIT 8")
    adm = sql("SELECT id FROM users WHERE email = 'admin@demo.yinzang.test'")[0]
    sus = sql("SELECT id, handle FROM users WHERE status = 'suspended' LIMIT 1")
    ins = []
    big = [900000, 800000, 700000, 600000, 500000, 400000]
    for i, u in enumerate(users[:6]):
        ins.append(f"('{u['id']}', 'create', 'rktest:m:{u['id']}', {big[i]}, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'credited', '{{\"type\":\"rktest\"}}')")
    ins.append(f"('{adm['id']}', 'create', 'rktest:m:{adm['id']}', 990000, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'credited', '{{\"type\":\"rktest\"}}')")
    if sus:
        ins.append(f"('{sus[0]['id']}', 'create', 'rktest:m:{sus[0]['id']}', 995000, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'credited', '{{\"type\":\"rktest\"}}')")
    # 打假先鋒：先給 4 人（不到 5 人整榜不顯示）
    fb_users = users[:4]
    existing_fb = sql("SELECT COUNT(*) n FROM user_titles WHERE kind = 'fakebuster'")[0]["n"]
    for u in fb_users:
        for k in range(5):
            ins.append(f"('{u['id']}', 'report_ok', 'rktest:r:{u['id']}:{k}', 10, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', 'credited', '{{\"report\":-1,\"target\":\"share:999999999\"}}')")
    sql("INSERT INTO score_events (user_id, kind, source, points, occurred_at, available_at, state, detail) VALUES " + ",".join(ins))
    recompute(ADM)
    m = sql("SELECT r.pos, r.user_id, r.points FROM rankings r WHERE board = 'month' ORDER BY pos")
    tot = sql("SELECT r.pos, r.user_id, r.points FROM rankings r WHERE board = 'total' ORDER BY pos")
    top6 = [u["id"] for u in users[:6]]
    check("7a 本月榜前 6 名照本月分數排序（測試分數）", [x["user_id"] for x in m[:6]] == top6 and all(m[i]["points"] >= m[i + 1]["points"] for i in range(len(m) - 1)) and len(m) <= 20, m[:7])
    check("7b 總榜照累計分數排序、最多 20 名", all(tot[i]["points"] >= tot[i + 1]["points"] for i in range(len(tot) - 1)) and len(tot) <= 20 and tot[0]["user_id"] == top6[0], tot[:3])
    excl = [adm["id"]] + ([sus[0]["id"]] if sus else [])
    check("7c 館長與停權帳號不在任何榜（兩人本月測試分數最高）", not sql(f"SELECT 1 FROM rankings WHERE user_id IN ({','.join(repr(x) for x in excl)})"), excl)
    fbn = sql("SELECT COUNT(DISTINCT user_id) n FROM rankings WHERE board = 'fakebuster'")[0]["n"]
    c = ctx(br, 1440, tok=None)
    p = c.new_page()
    p.goto(B + "/ranking?t=" + ST)
    settle(p)
    shown = p.evaluate("() => [...document.querySelectorAll('.rank-list')].map(l => l.dataset.testid)")
    check("7d 打假先鋒不到 5 人時整榜不顯示", (fbn < 5 and "rank-fakebuster" not in shown) or (fbn >= 5 and "rank-fakebuster" in shown), (fbn, existing_fb, shown))
    first = p.evaluate("() => [...document.querySelectorAll('[data-testid=rank-month] .rank-row')].slice(0, 6).map(r => r.dataset.handle)")
    check("7e 頁面本月榜順序跟資料一致", first == [u["handle"] for u in users[:6]], first)
    cols = p.evaluate("() => { const r = document.querySelector('[data-testid=rank-month] .rank-row'); return [...r.children].map(c => c.className); }")
    check("7f 每列只有名次、大頭貼＋暱稱、等級、分數", cols == ["rank-pos num", "rank-who", "lv-tag", "rank-pts num"], cols)
    shot(p, "R1440_01_榮譽榜", full=True)
    c.close()
    # 第 5 位打假先鋒 → 整榜出現
    u5 = users[4]
    sql("INSERT INTO score_events (user_id, kind, source, points, occurred_at, available_at, state, detail) VALUES " + ",".join(
        f"('{u5['id']}', 'report_ok', 'rktest:r:{u5['id']}:{k}', 10, '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z', 'credited', '{{\"report\":-1,\"target\":\"share:999999999\"}}')" for k in range(5)))
    recompute(ADM)
    fbn2 = sql("SELECT COUNT(DISTINCT user_id) n FROM rankings WHERE board = 'fakebuster'")[0]["n"]
    c = ctx(br, 390, 844, True, tok=None)
    p = c.new_page()
    p.goto(B + "/ranking?t=" + ST + "b")
    settle(p)
    check("7g 打假先鋒滿 5 人後整榜出現", fbn2 >= 5 and p.locator("[data-testid=rank-fakebuster]").count() == 1, fbn2)
    o = overflow(p)
    check("7h 390 榮譽榜無橫向溢出", o["sw"] <= o["cw"], o)
    shot(p, "R390_01_榮譽榜", full=True)
    # 個人頁「本月第 N 名」
    p.goto(B + f"/u/{users[1]['handle']}")
    settle(p)
    check("7i 上榜的人個人頁顯示「本月第 2 名」", p.locator("[data-testid=profile-month-rank]").inner_text().strip() == "本月第 2 名")
    shot(p, "R390_02_個人頁本月名次")
    off = sql(f"SELECT handle FROM users WHERE status = 'active' AND id NOT IN (SELECT user_id FROM rankings WHERE board = 'month') AND email LIKE '%demo.yinzang.test' AND email NOT LIKE 'admin%' LIMIT 1")[0]["handle"]
    p.goto(B + f"/u/{off}")
    settle(p)
    check("7j 沒上榜的人不顯示名次", p.locator("[data-testid=profile-month-rank]").count() == 0, off)
    c.close()
    c = ctx(br, 1440)
    p = c.new_page()
    p.goto(B + "/")
    settle(p)
    p.click(".me-menu summary")
    check("7k 頭像選單有「收藏榮譽榜」、頁尾有「新手指南」「收藏榮譽榜」", p.locator("[data-testid=menu-ranking]").is_visible()
          and p.locator(".foot-links a[href='/guide']").count() == 1 and p.locator(".foot-links a[href='/ranking']").count() == 1)
    c.close()
    # 清掉測試分數，重算回原狀
    sql("DELETE FROM score_events WHERE source LIKE 'rktest:%'")
    recompute(ADM)
    br.close()

ok = sum(r["ok"] for r in res)
print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_本機.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
