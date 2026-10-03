"""後台左側選單＋條款公告關閉 本機驗收（2026-10-03）。

前提：本機建置版跑在 8791，D1 是正式站備份還原到 scratchpad（--persist-to），已套 0031。
用法：python3 _驗收_本機.py <本機 D1 sqlite 檔>
測試資料（臨時管理員、兩個會員、待處理樣本）只寫進這個本機 D1。
"""
import hashlib
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8791"
DB = sys.argv[1]
OUT = Path(__file__).parent
IMG = OUT / "img"
IMG.mkdir(exist_ok=True)
results = []


def check(name, ok, detail=""):
    results.append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""))


def db():
    c = sqlite3.connect(DB, timeout=30)
    c.isolation_level = None
    return c


TOK = {"admin": "tok-admin-navtest-0001", "a": "tok-member-a-0001", "b": "tok-member-b-0001"}


def setup_users():
    c = db()
    pw = c.execute("SELECT password_hash FROM users LIMIT 1").fetchone()[0]
    rows = [
        ("navadmin", "admin@demo.yinzang.test", "navadmin", "後台驗收", "1.2", "admin"),
        ("navmema", "nav-a@demo.yinzang.test", "navmema", "會員甲", "1.0", "a"),
        ("navmemb", "nav-b@demo.yinzang.test", "navmemb", "會員乙", "1.2", "b"),
    ]
    for uid, email, handle, name, tv, tk in rows:
        c.execute(
            "INSERT OR IGNORE INTO users (id, email, email_verified_at, password_hash, handle, name, terms_version, terms_accepted_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, email, "2026-10-01T00:00:00.000Z", pw, handle, name, tv, "2026-10-01T00:00:00.000Z"),
        )
        sid = hashlib.sha256(TOK[tk].encode()).hexdigest()
        c.execute("INSERT OR IGNORE INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", (sid, uid, "2026-12-31T00:00:00.000Z"))
    c.execute("DELETE FROM user_notices WHERE user_id IN ('navmema','navmemb')")
    c.close()


def seed_queue():
    """本機待處理樣本：每一類都放「該算」與「不該算」的各一些"""
    c = db()
    # 重跑：先清掉上一輪的樣本
    for sql in [
        "DELETE FROM feedback WHERE body LIKE '[navtest]%'",
        "DELETE FROM error_reports WHERE reporter_id='navmema'",
        "DELETE FROM dm_reports WHERE reporter_id IN ('navmema','navmemb')",
        "DELETE FROM threads WHERE buyer_id='navmema'",
        "DELETE FROM takedown_notices WHERE claimant_name='[navtest]'",
        "DELETE FROM deletion_requests WHERE reason='[navtest]'",
        "DELETE FROM artist_photos WHERE r2_key='r/navtest.jpg'",
        "DELETE FROM reports WHERE reporter_id IN ('navmema','navmemb')",
        "DELETE FROM target_decisions WHERE decided_by='navadmin'",
        "DELETE FROM appeals WHERE text='[navtest]'",
        "DELETE FROM comment_reports WHERE reporter_id='navmema'",
        "DELETE FROM comments WHERE body LIKE '[navtest]%'",
    ]:
        c.execute(sql)
    q = c.execute
    q("INSERT INTO feedback (kind, body, status) VALUES ('bug','[navtest] 未處理 1','open'),('idea','[navtest] 未處理 2','open'),('idea','[navtest] 已處理','done')")
    q("INSERT INTO error_reports (share_no, reporter_id, reason, status) VALUES (3,'navmema','other','open'),(4,'navmema','other','open'),(5,'navmema','other','fixed')")
    q("INSERT INTO threads (share_no, buyer_id) VALUES (3,'navmema'),(4,'navmema')")
    tid = q("SELECT MAX(id) FROM threads").fetchone()[0]
    q("INSERT INTO dm_reports (thread_id, reporter_id, reported_id, reason, status) VALUES (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)",
      (tid, "navmema", "navmemb", "spam", "open", tid, "navmemb", "navmema", "spam", "open", tid - 1, "navmema", "navmemb", "other", "done"))
    for st in ("pending", "removed", "counter", "rejected"):
        q("INSERT INTO takedown_notices (status, claimant_name, claimant_email, role, right_type, work, detail) VALUES (?,?,?,?,?,?,?)",
          (st, "[navtest]", "t@example.com", "owner", "copyright", "作品", "說明"))
    q("INSERT INTO deletion_requests (user_id, reason, status) VALUES ('navmemb','[navtest]','pending')")
    q("INSERT INTO artist_photos (artist_slug, source, status, r2_key, thumb_key, content_type, license) VALUES ('hyukoh','member','pending','r/navtest.jpg','r/navtest_t.jpg','image/jpeg','CC BY-SA 4.0')")
    # 檢舉：share:3 兩人檢舉未裁決（算）、share:4 一人檢舉已維持鎖定（不算）
    q("INSERT INTO reports (target, reporter_id, reason) VALUES ('share:3','navmema','fake'),('share:3','navmemb','fake'),('share:4','navmema','fake')")
    q("INSERT OR IGNORE INTO target_decisions (target, decision, decided_by) VALUES ('share:4','kept','navadmin')")
    # 申訴：待處理一筆（算）、已解鎖一筆（不算）
    q("INSERT INTO appeals (target, by_id, text, status) VALUES ('share:3','navmemb','[navtest]','pending'),('share:4','navmemb','[navtest]','unlocked')")
    # 留言：被檢舉未處理（算）、被檢舉但管理員已恢復（不算）
    q("INSERT INTO comments (share_no, author_id, body) VALUES (3,'navmemb','[navtest] 被檢舉'),(3,'navmemb','[navtest] 已恢復')")
    m = q("SELECT MAX(id) FROM comments").fetchone()[0]
    q("UPDATE comments SET decision='kept' WHERE id=?", (m,))
    q("INSERT INTO comment_reports (comment_id, reporter_id, reason) VALUES (?,?,?),(?,?,?)", (m - 1, "navmema", "spam", m, "navmema", "spam"))
    c.close()


def ctx_for(browser, who=None, **kw):
    ctx = browser.new_context(**kw)
    if who:
        ctx.add_cookies([{"name": "yz_session", "value": TOK[who], "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    return ctx


def settle(page):
    page.wait_for_load_state("load")
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(600)


PAGES = [
    ("/admin", "儀表板"), ("/admin/moderation", "檢舉與下架"), ("/admin/dm-reports", "私訊檢舉"), ("/admin/takedowns", "侵權通知"),
    ("/admin/error-reports", "錯誤回報"), ("/admin/additions", "待確認的新增"), ("/admin/duplicates", "疑似重複藝人"),
    ("/admin/artist-photos", "藝人照片"), ("/admin/spotify-picks", "推薦歌曲"), ("/admin/members", "會員管理"),
    ("/admin/deletions", "刪帳申請"), ("/admin/feedback", "意見回饋"), ("/admin/seo", "SEO"), ("/admin/status", "網站狀態"),
]


def nav_badges(page):
    return page.evaluate(
        """() => Object.fromEntries([...document.querySelectorAll('.admin-nav-link')].map(a => {
            const b = a.querySelector('.admin-badge'); return [a.getAttribute('href'), b ? b.textContent : '0'];
        }))"""
    )


def page_counts(page):
    """每一頁「列出、要處理」的筆數：讀頁面上的區塊數字／列，跟頁面同一支 API 的資料"""
    out = {}

    def go(path, testid=None):
        page.goto(BASE + path)
        settle(page)
        if testid:
            page.wait_for_selector(f'[data-testid="{testid}"]', timeout=20000)

    go("/admin/moderation")
    page.wait_for_selector("#pending .count", timeout=20000)
    ov = page.evaluate("fetch('/api/admin').then(r => r.json())")
    dom = page.evaluate(
        """() => ({
          pending: +document.querySelector('#pending .count').textContent,
          comments: +document.querySelector('#comments .count').textContent,
          avatars: +document.querySelector('#avatars .count').textContent,
          appealsPending: document.querySelectorAll('li.appeal[data-status="pending"]').length,
          reportRows: [...document.querySelectorAll('tr[data-target]')].map(t => t.dataset.target),
        })"""
    )
    undecided = [t["target"] for t in ov["targets"] if t["total"] > 0 and t["decision"] is None]
    assert all(t in dom["reportRows"] for t in undecided)
    out["moderation"] = {
        "page": dom["pending"] + len(undecided) + dom["appealsPending"] + dom["comments"] + dom["avatars"],
        "how": f"待審核新增 {dom['pending']}＋檢舉表未裁決 {len(undecided)}（表上共 {len(dom['reportRows'])} 列）＋申訴待處理 {dom['appealsPending']}＋被檢舉留言 {dom['comments']}＋被檢舉大頭貼 {dom['avatars']}",
    }
    go("/admin/dm-reports")
    page.wait_for_selector("text=每日開新對話上限", timeout=20000)
    n = page.locator('tr[data-status="open"]').count()
    out["dmReports"] = {"page": n, "how": f"檢舉表狀態「待處理」列 {n}（表上共 {page.locator('tr[data-status]').count()} 列）"}
    go("/admin/takedowns")
    page.wait_for_selector("text=處理中", timeout=20000)
    n = page.locator('[data-testid="td-item"][data-status="pending"], [data-testid="td-item"][data-status="counter"]').count()
    allopen = page.evaluate("+[...document.querySelectorAll('.block-title')].find(h => h.textContent.startsWith('處理中')).querySelector('.count').textContent")
    out["takedowns"] = {"page": n, "how": f"「處理中」{allopen} 筆裡，狀態是待處理或會員提出回復通知的 {n} 筆（已移除、已轉送在等對方）"}
    for key, path, testid, label in [
        ("errorReports", "/admin/error-reports", "er-open", "待處理"),
        ("feedback", "/admin/feedback", "fb-open", "未處理"),
        ("artistPhotos", "/admin/artist-photos", "ap-pending", "待審投稿"),
        ("additions", "/admin/additions", "add-open", "待確認"),
        ("duplicates", "/admin/duplicates", "duplicates", "疑似重複藝人"),
    ]:
        go(path, testid)
        sec = page.locator(f'[data-testid="{testid}"]')
        n = int(sec.locator(".count").first.text_content())
        items = sec.locator(".ap-list > li, .ap-list > *").count() if key != "duplicates" else None
        out[key] = {"page": n, "how": f"「{label}」區塊數字 {n}" + (f"、列出 {items} 項" if items is not None else "")}
    go("/admin/deletions", "deletions")
    n = int(page.locator('[data-testid="deletions"] .block').first.locator(".count").text_content())
    out["deletions"] = {"page": n, "how": f"「待處理」區塊數字 {n}"}
    return out


def counts_table(page, label):
    page.goto(BASE + "/admin")
    settle(page)
    api = page.evaluate("fetch('/api/admin/nav-counts?detail=1').then(r => r.json())")
    pc = page_counts(page)
    page.goto(BASE + "/admin")
    settle(page)
    page.wait_for_timeout(1500)
    badges = nav_badges(page)
    href = {"moderation": "/admin/moderation", "dmReports": "/admin/dm-reports", "takedowns": "/admin/takedowns", "errorReports": "/admin/error-reports",
            "additions": "/admin/additions", "duplicates": "/admin/duplicates", "artistPhotos": "/admin/artist-photos", "deletions": "/admin/deletions", "feedback": "/admin/feedback"}
    rows = []
    for k, v in api["counts"].items():
        shown = badges.get(href[k], "0")
        ok = v == pc[k]["page"] and str(v if v else 0) == shown
        rows.append({"key": k, "api": v, "badge": shown, "page": pc[k]["page"], "how": pc[k]["how"], "ok": ok})
        check(f"{label} 計數 {k}", ok, f"API {v}／選單 {shown}／頁面 {pc[k]['page']}")
    return {"label": label, "detail": api.get("detail"), "rows": rows}


def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")


def main():
    setup_users()
    errors = []
    tables = []
    with sync_playwright() as p:
        b = p.webkit.launch()

        def hook(pg, tag):
            # 資源載入失敗的 console 訊息不帶網址，另外記回應網址分類
            pg.on("console", lambda m: m.type == "error" and errors.append(f"{tag} {pg.url} {m.text} @ {m.location.get('url', '')}"))
            pg.on("pageerror", lambda e: errors.append(f"{tag} {pg.url} pageerror {e}"))

        # ---------- 未登入 /admin ----------
        ctx = ctx_for(b, viewport={"width": 1440, "height": 900})
        pg = ctx.new_page(); hook(pg, "anon")
        pg.goto(BASE + "/admin"); settle(pg)
        check("未登入 /admin 只顯示「只有管理員進得去」", pg.locator('[data-testid="admin-denied"]').count() == 1 and pg.locator("#admin-side").count() == 0)
        r = pg.evaluate("fetch('/api/admin/nav-counts').then(r => r.status)")
        check("未登入 nav-counts 401", r == 401, str(r))
        ctx.close()

        # ---------- 計數核對：正式站資料原樣 ----------
        ctx = ctx_for(b, "admin", viewport={"width": 1440, "height": 900})
        pg = ctx.new_page(); hook(pg, "admin")
        tables.append(counts_table(pg, "正式站備份原樣"))
        seed_queue()
        tables.append(counts_table(pg, "加本機待處理樣本後"))

        # ---------- 13＋1 頁從選單點過 ----------
        pg.goto(BASE + "/admin"); settle(pg)
        for href, label in PAGES:
            link = pg.locator(f'#admin-side a.admin-nav-link[href="{href}"]')
            link.click()
            pg.wait_for_url(re.compile(re.escape(href) + r"$"), timeout=20000)
            settle(pg)
            cur = pg.locator('#admin-side a[aria-current="page"]')
            ok = cur.count() == 1 and cur.get_attribute("href") == href and pg.locator("h1.page-title").count() == 1
            check(f"點選單 → {label}", ok and overflow(pg) <= 0, f"aria-current={cur.get_attribute('href') if cur.count() else None} 溢出={overflow(pg)}")
        pg.locator('[data-testid="admin-back"]').click()
        pg.wait_for_url(BASE + "/", timeout=20000)
        settle(pg)
        pg.wait_for_timeout(1500)
        check("「← 回到前台」回首頁", pg.url == BASE + "/")

        # ---------- 規格：nav、寬度、點擊範圍、不截斷 ----------
        pg.goto(BASE + "/admin/feedback"); settle(pg)
        m = pg.evaluate(
            """() => {
              const side = document.querySelector('#admin-side');
              const r = side.getBoundingClientRect();
              const hits = [...side.querySelectorAll('a, button')].filter(e => e.offsetParent).map(e => ({t: e.textContent.trim(), h: e.getBoundingClientRect().height}));
              const cut = [...side.querySelectorAll('.admin-nav-label, .admin-group-title')].filter(e => e.scrollWidth > e.clientWidth + 0.5 || e.getClientRects().length > 1 && e.getBoundingClientRect().height > 30).map(e => e.textContent);
              const st = getComputedStyle(side);
              return { w: r.width, pos: st.position, oy: st.overflowY, nav: document.querySelector('nav.admin-nav').getAttribute('aria-label'),
                       minH: Math.min(...hits.map(h => h.h)), small: hits.filter(h => h.h < 40), cut,
                       radius: [...side.querySelectorAll('*')].some(e => parseFloat(getComputedStyle(e).borderRadius) > 0),
                       shadow: [...side.querySelectorAll('*')].some(e => getComputedStyle(e).boxShadow !== 'none') };
            }"""
        )
        check("桌機選單寬 220～240、sticky、獨立捲動", 220 <= m["w"] <= 240 and m["pos"] == "sticky" and m["oy"] == "auto", json.dumps({k: m[k] for k in ("w", "pos", "oy")}))
        check("nav aria-label", m["nav"] == "管理後台")
        check("選單點擊範圍 ≥40px", m["minH"] >= 40, f"最小 {m['minH']} {m['small']}")
        check("選單文字不截斷", not m["cut"], str(m["cut"]))
        check("選單直角無陰影", not m["radius"] and not m["shadow"])
        # 選單自己捲：把視窗壓矮，選單 scrollHeight > clientHeight 且能捲
        pg.set_viewport_size({"width": 1440, "height": 420})
        sc = pg.evaluate("(() => { const s = document.querySelector('#admin-side'); s.scrollTop = 999; return [s.scrollHeight > s.clientHeight, s.scrollTop > 0, window.scrollY]; })()")
        check("視窗矮時選單自己捲動、頁面不跟著捲", sc[0] and sc[1] and sc[2] == 0, str(sc))
        pg.set_viewport_size({"width": 1440, "height": 900})

        # ---------- 收合＋localStorage ----------
        pg.goto(BASE + "/admin/feedback"); settle(pg)
        btn = pg.locator('[data-testid="admin-group-catalog"]')
        btn.click()
        check("收合 資料庫：aria-expanded=false、清單隱藏", btn.get_attribute("aria-expanded") == "false" and not pg.locator("#admin-g-catalog").is_visible())
        sumb = btn.locator(".admin-badge")
        check("收合後分組標題顯示合計數字", sumb.count() == 1, sumb.text_content() if sumb.count() else "")
        pg.reload(); settle(pg)
        check("重新整理後仍收合（localStorage）", pg.locator('[data-testid="admin-group-catalog"]').get_attribute("aria-expanded") == "false")
        pg.goto(BASE + "/admin/additions"); settle(pg)
        check("進到收合分組裡的頁：該分組自動展開、目前頁高亮", pg.locator('[data-testid="admin-group-catalog"]').get_attribute("aria-expanded") == "true"
              and pg.locator('#admin-side a[aria-current="page"]').get_attribute("href") == "/admin/additions")
        pg.goto(BASE + "/admin/feedback"); settle(pg)
        check("回到別的頁，資料庫仍是收起來", pg.locator('[data-testid="admin-group-catalog"]').get_attribute("aria-expanded") == "false")
        pg.locator('[data-testid="admin-group-catalog"]').click()
        ctx.close()

        # localStorage 會丟例外的環境
        ctx = ctx_for(b, "admin", viewport={"width": 1440, "height": 900})
        ctx.add_init_script("Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });")
        pg = ctx.new_page()
        perr = []
        pg.on("pageerror", lambda e: perr.append(str(e)))
        pg.goto(BASE + "/admin/members"); settle(pg)
        pg.locator('[data-testid="admin-group-members"]').click()
        check("localStorage 讀寫丟例外：選單照常、收合照常", not perr and pg.locator('[data-testid="admin-group-members"]').get_attribute("aria-expanded") == "false", str(perr[:2]))
        ctx.close()

        # ---------- 各寬度截圖＋抽屜 ----------
        for w, h in [(1440, 900), (1024, 768), (768, 1024), (390, 844), (320, 640)]:
            ctx = ctx_for(b, "admin", viewport={"width": w, "height": h}, device_scale_factor=2)
            pg = ctx.new_page(); hook(pg, f"{w}")
            for href, label in PAGES:
                pg.goto(BASE + href); settle(pg)
                ov = overflow(pg)
                check(f"{w} {label} 橫向溢出 0", ov <= 0, str(ov))
            pg.goto(BASE + "/admin/moderation"); settle(pg)
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(IMG / f"{w}_檢舉與下架.jpg"), type="jpeg", quality=80)
            btn = pg.locator('[data-testid="admin-menu-btn"]')
            if w >= 1024:
                check(f"{w} 桌機：側欄可見、沒有選單鈕", pg.locator("#admin-side").is_visible() and not btn.is_visible())
                pg.goto(BASE + "/admin"); settle(pg); pg.wait_for_timeout(1500)
                pg.screenshot(path=str(IMG / f"{w}_儀表板.jpg"), type="jpeg", quality=80)
            else:
                bb = btn.bounding_box()
                check(f"{w} 選單鈕在左上、≥40px、aria-expanded=false", bb and bb["x"] < 40 and bb["height"] >= 40 and btn.get_attribute("aria-expanded") == "false", str(bb))
                check(f"{w} 抽屜關著時看不到、不能 Tab 進去", not pg.locator("#admin-side").is_visible())
                pg.screenshot(path=str(IMG / f"{w}_抽屜關.jpg"), type="jpeg", quality=80)
                btn.click(); pg.wait_for_timeout(400)
                side = pg.locator("#admin-side")
                sb = side.bounding_box()
                check(f"{w} 抽屜從左滑出、遮罩出現、aria-expanded=true", side.is_visible() and sb["x"] == 0 and pg.locator('[data-testid="admin-scrim"]').is_visible()
                      and btn.get_attribute("aria-expanded") == "true", f"x={sb['x']} w={sb['width']}")
                check(f"{w} 抽屜 role=dialog aria-modal", side.get_attribute("role") == "dialog" and side.get_attribute("aria-modal") == "true")
                pg.mouse.move(w - 5, 5)
                pg.screenshot(path=str(IMG / f"{w}_抽屜開.jpg"), type="jpeg", quality=80)
                check(f"{w} 開抽屜後焦點在抽屜內", pg.evaluate("document.querySelector('#admin-side').contains(document.activeElement)"))
                inside = all(pg.keyboard.press("Tab") or pg.evaluate("document.querySelector('#admin-side').contains(document.activeElement)") for _ in range(40))
                back = all(pg.keyboard.press("Shift+Tab") or pg.evaluate("document.querySelector('#admin-side').contains(document.activeElement)") for _ in range(25))
                check(f"{w} 焦點鎖在抽屜內（Tab 40 次、Shift+Tab 25 次）", inside and back)
                cut = pg.evaluate("[...document.querySelectorAll('#admin-side .admin-nav-label')].filter(e => e.scrollWidth > e.clientWidth + .5).length")
                check(f"{w} 抽屜文字不截斷", cut == 0)
                pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
                check(f"{w} Esc 關抽屜、焦點回選單鈕", not side.is_visible() and pg.evaluate("document.activeElement?.dataset.testid") == "admin-menu-btn")
                btn.click(); pg.wait_for_timeout(400)
                pg.mouse.click(w - 5, h // 2); pg.wait_for_timeout(400)
                check(f"{w} 點遮罩關抽屜", not side.is_visible())
                btn.click(); pg.wait_for_timeout(400)
                pg.locator('#admin-side a[href="/admin/feedback"]').click()
                pg.wait_for_url(re.compile(r"/admin/feedback$")); settle(pg)
                check(f"{w} 抽屜點選項換頁後抽屜關上、目前頁高亮", not pg.locator("#admin-side").is_visible()
                      and pg.locator('#admin-side a[aria-current="page"]').get_attribute("href") == "/admin/feedback")
            ctx.close()

        # ---------- 條款更新公告 ----------
        def notice_visible(pg, path="/"):
            pg.goto(BASE + path); settle(pg); pg.wait_for_timeout(1200)
            return pg.locator('[data-testid="terms-notice"]').count() > 0

        ctx = ctx_for(b, viewport={"width": 390, "height": 844}, device_scale_factor=3)
        pg = ctx.new_page(); hook(pg, "notice-anon")
        check("公告：訪客第一次看得到", notice_visible(pg))
        with pg.expect_response("**/api/notice") as resp:
            pg.locator(".terms-notice-x").click()
        sc = resp.value.headers.get("set-cookie", "")
        check("公告：關閉時伺服器發 cookie lmb_tn=1.2（一年、Path=/、SameSite=Lax）", "lmb_tn=1.2" in sc and "Max-Age=31536000" in sc and "Path=/" in sc and "SameSite=Lax" in sc, sc)
        check("公告：關閉後重新整理不出現", not notice_visible(pg))
        check("公告：換頁不出現", not notice_visible(pg, "/artists"))
        pg.close()
        pg = ctx.new_page(); hook(pg, "notice-anon2")
        check("公告：關掉分頁重開不出現", not notice_visible(pg))
        pg.evaluate("localStorage.clear()")
        check("公告：清掉 localStorage 只留 cookie 也不出現", not notice_visible(pg))
        ctx.close()
        # cookie 也沒有、只有 localStorage（舊版關過的人）
        ctx = ctx_for(b, viewport={"width": 390, "height": 844})
        ctx.add_init_script("try { localStorage.setItem('lmb_terms_notice_1.2', '1') } catch {}")
        pg = ctx.new_page()
        check("公告：只有舊的 localStorage 紀錄也不出現", not notice_visible(pg))
        ctx.close()
        # 只關過 1.1（舊版）→ 1.2 要出現一次
        ctx = ctx_for(b, viewport={"width": 390, "height": 844})
        ctx.add_cookies([{"name": "lmb_tn", "value": "1.1", "domain": "127.0.0.1", "path": "/"}])
        pg = ctx.new_page()
        check("公告：只關過 1.1 的，1.2 照樣出現一次", notice_visible(pg))
        ctx.close()
        # 登入會員（同意 1.0）：關一次，換一個全新瀏覽器 context 登入也不出現
        ctx = ctx_for(b, "a", viewport={"width": 390, "height": 844})
        pg = ctx.new_page(); hook(pg, "notice-a")
        check("公告：會員甲（同意 1.0）看得到", notice_visible(pg))
        with pg.expect_response("**/api/notice"):
            pg.locator(".terms-notice-x").click()
        ctx.close()
        c = db(); row = c.execute("SELECT version FROM user_notices WHERE user_id='navmema'").fetchone(); c.close()
        check("公告：會員關閉後伺服器記 user_notices=1.2", row and row[0] == "1.2", str(row))
        ctx = ctx_for(b, "a", viewport={"width": 390, "height": 844})
        pg = ctx.new_page(); hook(pg, "notice-a2")
        check("公告：會員甲換新的瀏覽器 context 登入不出現", not notice_visible(pg))
        ck = [x["name"] for x in ctx.cookies()]
        check("（那個新 context 沒有 lmb_tn cookie，靠的是伺服器）", "lmb_tn" not in ck, str(ck))
        ctx.close()
        ctx = ctx_for(b, "b", viewport={"width": 390, "height": 844})
        pg = ctx.new_page(); hook(pg, "notice-b")
        check("公告：會員乙（註冊時同意 1.2）不出現", not notice_visible(pg))
        ctx.close()
        b.close()

    # 已知、跟這次無關：站外備份的 R2 沒有藝人照片（r/）與照片檔，本機 /img/ 404；未登入那一筆 401 是故意打的
    known = re.compile(r"@ http://127\.0\.0\.1:8791/(img/|r/)|anon http://127\.0\.0\.1:8791/admin .*401")
    real = [e for e in errors if not known.search(e)]
    check("console error 0", not real, "\n".join(real[:10]))
    (OUT / "驗收結果_本機.json").write_text(json.dumps({"at": time.strftime("%Y-%m-%d %H:%M"), "results": results, "counts": tables, "console": errors}, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = [r for r in results if not r["ok"]]
    print(f"\n{len(results) - len(bad)}/{len(results)} 通過")


if __name__ == "__main__":
    main()
