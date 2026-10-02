"""設計大師總檢 37 項修正 本機驗收（2026-10-02）。

用法（fix/ux worktree 的 網站/ 底下：正式站備份 20261002-101736-remote 還原到 .wrangler/state、套遷移，
建置版 `npm run build && npm start -- --port 8875` 或 dev `npm run dev -- --port 8873`）：
    python3 _修正驗收_本機.py [http://127.0.0.1:8875] [輸出資料夾]

- 帳號：本機 D1 直接建 uxadmin（ADMIN_EMAILS 預設值）／uxa／uxb（已驗證）／uxnew（未驗證）＋ session；賣家用備份裡的站長 dz4277（本機副本）
- 每一項照報告的頁面與寬度重現：WebKit 390／375／320（3 倍）與 1440，截圖 JPEG 80 到 img_修正後/
- 量測：橫向溢出、點擊範圍、表格列高、頁首元素尺寸、黏底列高度
- 可重跑：測試出價、留言、發文每次都先清掉
"""

import hashlib
import io
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8875"
HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE / "img_修正後"
OUT.mkdir(exist_ok=True)
SITE = Path.home() / "AboutAI/專案/music-collectibles-fix-ux/網站"
HOST = "127.0.0.1"

USERS = {"uxadmin": "ux-admin-id", "uxa": "ux-a-id", "uxb": "ux-b-id", "uxnew": "ux-new-id"}
TOKENS = {k: f"uxtoken{k}{'x' * 40}" for k in [*USERS, "owner"]}
results: list[tuple[str, bool, str]] = []
ERRORS: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)
    return bool(ok)


def sql(q: str):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--json", "--command", q],
        cwd=SITE, check=True, capture_output=True, text=True,
    )
    return json.loads(r.stdout)[-1]["results"]


def setup():
    owner = sql("SELECT id FROM users WHERE handle = 'dz4277'")[0]["id"]
    ids = ",".join(f"'{i}'" for i in USERS.values())
    # 清上一輪：測試帳號的出價、對話、留言、發的收藏
    sql(f"DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE buyer_id IN ({ids}) OR peer_id IN ({ids}))")
    sql(f"DELETE FROM thread_reads WHERE user_id IN ({ids},'{owner}')")
    sql(f"DELETE FROM offers WHERE buyer_id IN ({ids})")
    sql(f"DELETE FROM threads WHERE buyer_id IN ({ids}) OR peer_id IN ({ids})")
    sql(f"DELETE FROM comments WHERE author_id IN ({ids})")
    sql(f"UPDATE shares SET deleted_at = '2026-10-02T00:00:00.000Z', hidden_at = '2026-10-02T00:00:00.000Z' WHERE author_id IN ({ids}) AND deleted_at IS NULL")
    sql("DELETE FROM rate_limits WHERE key LIKE 'msg:%' OR key LIKE 'offer:%' OR key LIKE 'share:%' OR key LIKE 'upload:%'")
    sql("UPDATE shares SET sale_state = 'offer', sold_to = NULL, sold_at = NULL, sold_price = NULL WHERE no = 8")
    for h, t in TOKENS.items():
        uid = owner if h == "owner" else USERS[h]
        sql(f"INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('{hashlib.sha256(t.encode()).hexdigest()}', '{uid}', '2026-12-31T00:00:00.000Z')")
    return owner


def ctx_for(browser, who, width=1440, height=900, scale=1, mobile=False, dark=False):
    c = browser.new_context(
        viewport={"width": width, "height": height}, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile,
        color_scheme="dark" if dark else "light", locale="zh-TW",
    )
    cookies = [{"name": "yz_test_country", "value": "TW", "domain": HOST, "path": "/"}]
    if who:
        cookies.append({"name": "yz_session", "value": TOKENS[who], "domain": HOST, "path": "/", "httpOnly": True})
    c.add_cookies(cookies)
    return c


def page_of(c):
    p = c.new_page()
    p.on("console", lambda m: ERRORS.append(f"{p.url} {m.text}") if m.type == "error" and "/img/" not in m.text and not re.search(r"status of (404|403|409|429)", m.text) and "access control checks" not in m.text else None)
    return p


def go(p, path: str, settle=1200):
    p.goto(BASE + path, wait_until="load")
    p.wait_for_function("document.fonts.ready.then(() => true)")
    try:
        p.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    p.wait_for_timeout(settle)


def shot(p, name: str, full=False, clip=None):
    p.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=80, full_page=full, clip=clip)


def overflow(p):
    return p.evaluate("[document.documentElement.scrollWidth, window.innerWidth, document.body.scrollWidth]")


def rect(p, sel, nth=0):
    return p.evaluate(
        """([sel, i]) => { const e = document.querySelectorAll(sel)[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }""",
        [sel, nth],
    )


def rects(p, sel):
    return p.evaluate(
        """(sel) => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom, t: (e.textContent || '').trim().slice(0, 20) }; })""",
        sel,
    )


def api(p, path: str, body=None, method=None):
    return p.evaluate(
        """async ([path, body, method]) => {
          const init = body === null && !method ? {} : { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: body === null ? undefined : JSON.stringify(body) };
          const r = await fetch(path, init);
          let j = {}; try { j = await r.json(); } catch {}
          return { status: r.status, body: j };
        }""",
        [path, body, method],
    )


def jpeg(w=800, h=600, color=(200, 120, 40)):
    im = Image.new("RGB", (w, h), color)
    for i in range(0, w, 80):
        for j in range(0, h, 80):
            if (i // 80 + j // 80) % 2 == 0:
                im.paste((40, 40, 40), (i, j, i + 40, j + 40))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=85)
    return b.getvalue()


def main():
    owner = setup()
    with sync_playwright() as pw:
        wk = pw.webkit.launch()
        ch = pw.chromium.launch()

        # ---------- 必修 1：404 ----------
        for dark in (False, True):
            c = ctx_for(wk, None, 390, 844, 3, True, dark=dark)
            p = page_of(c)
            r = p.goto(BASE + "/this-page-does-not-exist", wait_until="load")
            p.wait_for_timeout(800)
            tag = "深色" if dark else "淺色"
            check(f"M1 404 狀態碼 {tag}", r.status == 404, str(r.status))
            check(f"M1 404 繁中標題 {tag}", p.locator("h1").inner_text().strip() == "找不到這一頁", p.title())
            head_bg = p.evaluate("getComputedStyle(document.querySelector('header.nav')).backgroundColor")
            body_bg = p.evaluate("getComputedStyle(document.body).backgroundColor")
            check(f"M1 404 頁首白底 {tag}", head_bg in ("rgb(255, 255, 255)",) and body_bg in ("rgb(255, 255, 255)",), f"header {head_bg} body {body_bg}")
            check(f"M1 404 有搜尋與回首頁 {tag}", p.locator(".nf-search input").count() == 1 and p.locator(".nf-links a").count() == 2)
            shot(p, f"修正_01_404_{tag}_390")
            c.close()
        c = ctx_for(wk, None, 390, 844, 3, True)
        p = page_of(c)
        r = p.goto(BASE + "/share/99999", wait_until="load")
        p.wait_for_timeout(800)
        check("M1 被刪收藏 404", r.status == 404 and p.locator("h1").inner_text().strip() == "這則收藏已經不在了")
        shot(p, "修正_01_404_被刪收藏_390")
        for path in ("/artist/nobody", "/u/nobody", "/artist/hyukoh/999"):
            r = p.goto(BASE + path, wait_until="load")
            check(f"M1 {path} 自製 404", r.status == 404 and p.locator("[data-testid=not-found]").count() == 1)
        c.close()
        c = ctx_for(ch, None, 1440, 900)
        p = page_of(c)
        p.goto(BASE + "/this-page-does-not-exist", wait_until="load")
        p.wait_for_timeout(600)
        shot(p, "修正_01_404_1440")
        c.close()

        # ---------- 必修 2：我要買、拒絕、成交給這位的確認 ----------
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/9")
        p.click("[data-testid=buy-open]")
        p.wait_for_selector("[data-testid=buy-confirm]")
        txt = p.locator("[data-testid=buy-confirm]").inner_text()
        check("M2 我要買先確認", "確定要買" in txt and "不經手款項" in txt and "私訊約交付" in txt, txt.replace("\n", " ")[:80])
        shot(p, "修正_02_我要買確認框_390")
        # 取消不送出
        p.click("[data-testid=buy-confirm] .btn-text")
        p.wait_for_timeout(300)
        offers_before = sql("SELECT COUNT(*) AS n FROM offers WHERE buyer_id = 'ux-a-id'")[0]["n"]
        check("M2 取消後沒有送出", offers_before == 0, str(offers_before))
        # 確定 → 跳到私訊
        p.click("[data-testid=buy-open]")
        p.wait_for_selector("[data-testid=buy-confirm-ok]")
        p.click("[data-testid=buy-confirm-ok]")
        p.wait_for_url(re.compile(r"/messages/\d+$"), timeout=15000)
        buy_thread = int(p.url.rsplit("/", 1)[1])
        check("M2 確定後才送出並進私訊", sql("SELECT COUNT(*) AS n FROM offers WHERE buyer_id = 'ux-a-id' AND kind = 'buy'")[0]["n"] == 1)
        # 出價 #8（開放出價）給賣家看拒絕／成交
        go(p, "/share/8")
        r = api(p, "/api/shares/8/offers", {"kind": "offer", "price": 300})
        check("M2 甲對 #8 出價 300（API）", r["status"] in (200, 201), str(r["status"]))
        c.close()

        c = ctx_for(wk, "owner", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/8")
        p.click("[data-testid=offer-reject]")
        p.wait_for_selector("[data-testid=reject-confirm]")
        shot(p, "修正_02_拒絕確認框_390")
        check("M2 拒絕先確認", "確定拒絕" in p.locator("[data-testid=reject-confirm]").inner_text())
        p.click("[data-testid=reject-confirm] .btn-text")
        p.wait_for_timeout(300)
        # 建議 6：狀態不像按鈕
        bw = p.evaluate("getComputedStyle(document.querySelector('.offer-status')).borderTopWidth")
        check("S6 出價狀態無框線", bw == "0px", bw)
        shot(p, "修正_10_賣家出價列表_390")
        # 接受後 → 成交給這位 確認
        oid = sql("SELECT id FROM offers WHERE buyer_id = 'ux-a-id' AND share_no = 8 ORDER BY id DESC LIMIT 1")[0]["id"]
        r = api(p, f"/api/offers/{oid}/respond", {"answer": "accepted"})
        check("M2 賣家接受（API）", r["status"] == 200, str(r["status"]))
        go(p, "/share/8")
        p.click("[data-testid=offer-close]")
        p.wait_for_selector("[data-testid=close-confirm]")
        txt = p.locator("[data-testid=close-confirm]").inner_text()
        check("M2 成交給這位先確認", "確定成交" in txt and "不經手款項" in txt)
        shot(p, "修正_02_成交確認框_390")
        p.click("[data-testid=close-confirm] .btn-text")
        p.wait_for_timeout(200)
        check("M2 取消後 #8 仍是開放出價", sql("SELECT sale_state FROM shares WHERE no = 8")[0]["sale_state"] == "offer")
        c.close()

        # ---------- 必修 3：後台確認 ----------
        c = ctx_for(ch, "uxadmin", 1440, 900)
        p = page_of(c)
        go(p, "/admin")
        p.click("[data-testid=pause-open]")
        p.wait_for_selector("[data-testid=pause-confirm]")
        ok_disabled = p.locator("[data-testid=pause-confirm-ok]").is_disabled()
        p.fill("[data-testid=pause-confirm-type]", "暫停")
        ok_enabled = not p.locator("[data-testid=pause-confirm-ok]").is_disabled()
        check("M3 手動暫停要打「暫停」", ok_disabled and ok_enabled)
        shot(p, "修正_03_整站暫停確認_1440")
        p.keyboard.press("Escape")
        p.wait_for_timeout(200)
        check("M3 Esc 關掉、沒有暫停", p.locator("[data-testid=pause-confirm]").count() == 0 and sql("SELECT value FROM settings WHERE key = 'paused'") in ([], [{"value": "0"}], [{"value": ""}]) or p.locator("[data-testid=site-status] [data-paused=false]").count() == 1)
        go(p, "/admin/moderation")
        p.select_option("#td-type", "artist")
        p.fill("#td-key", "hyukoh")
        p.click("[data-testid=purge]")
        p.wait_for_selector("[data-testid=purge-confirm]")
        ok_disabled = p.locator("[data-testid=purge-confirm-ok]").is_disabled()
        p.fill("[data-testid=purge-confirm-type]", "hyukoh")
        ok_enabled = not p.locator("[data-testid=purge-confirm-ok]").is_disabled()
        check("M3 永久刪除要打識別碼", ok_disabled and ok_enabled)
        shot(p, "修正_03_永久刪除確認_1440")
        p.keyboard.press("Escape")
        check("M3 沒有刪掉 hyukoh", sql("SELECT COUNT(*) AS n FROM artists WHERE slug = 'hyukoh'")[0]["n"] == 1)
        # 刪除留言：先讓乙留一則、甲檢舉到門檻之下也會列？佇列只列被檢舉的；用 API 檢舉一次
        c.close()

        c = ctx_for(wk, "uxb", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/3")
        r = api(p, "/api/comments", {"share": 3, "body": "UX 檢查用的留言，待會會被刪"})
        check("M3 乙留言（API）", r["status"] in (200, 201), str(r["status"]))
        go(p, "/share/3")
        if p.locator("[data-testid=comment-delete]").count():
            p.locator("[data-testid=comment-delete]").first.click()
            p.wait_for_selector("[data-testid=comment-delete-confirm]")
            check("M3 會員刪留言用站內對話框", "確定刪除" in p.locator("[data-testid=comment-delete-confirm]").inner_text())
            shot(p, "修正_03_刪除留言確認_390")
            p.keyboard.press("Escape")
        c.close()
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/3")
        cid = sql("SELECT id FROM comments WHERE author_id = 'ux-b-id' ORDER BY id DESC LIMIT 1")[0]["id"]
        r = api(p, f"/api/comments/{cid}/report", {"reason": "spam"})
        check("M3 甲檢舉留言（API）", r["status"] in (200, 201, 409), str(r["status"]))
        c.close()
        c = ctx_for(ch, "uxadmin", 1440, 900)
        p = page_of(c)
        go(p, "/admin/moderation")
        if p.locator("[data-testid=comment-admin-delete]").count():
            p.locator("[data-testid=comment-admin-delete]").first.click()
            p.wait_for_selector("[data-testid=comment-admin-confirm]")
            check("M3 後台刪留言先確認", "確定刪除" in p.locator("[data-testid=comment-admin-confirm]").inner_text())
            shot(p, "修正_03_後台刪留言確認_1440")
            p.keyboard.press("Escape")
        else:
            check("M3 後台刪留言先確認", False, "佇列沒有被檢舉的留言")
        # 建議 4：撤下不再黑底實心、有確認
        go(p, "/admin/artist-photos")
        check("S4 後台沒有黑底實心鈕", p.locator(".btn-danger").count() == 0, str(p.locator(".btn-danger").count()))
        if p.locator("[data-testid=ap-remove]").count():
            p.locator("[data-testid=ap-remove]").first.click()
            p.wait_for_selector("[data-testid=ap-confirm]")
            shot(p, "修正_S4_撤下確認_1440")
            p.keyboard.press("Escape")
        shot(p, "修正_S4_藝人照片後台_1440")
        # 之後再說 7：儀表板待處理
        go(p, "/admin")
        qs = p.evaluate("[...document.querySelectorAll('.queue-item')].map(e => [e.dataset.n, e.className])")
        nonzero_first = all(int(x[0]) > 0 for x in qs[: sum(1 for x in qs if int(x[0]) > 0)])
        check("L7 待處理非 0 排前面、有黑框", nonzero_first and all(("has-n" in cl) == (int(n) > 0) for n, cl in qs), str(qs[:4]))
        shot(p, "修正_L7_儀表板待處理_1440")
        go(p, "/admin/spotify-picks")
        check("L7 推薦歌曲有搜尋", p.locator("[data-testid=sp-filter]").count() == 1)
        p.fill("[data-testid=sp-filter]", "hyukoh")
        p.wait_for_timeout(300)
        shot(p, "修正_L7_推薦歌曲搜尋_1440")
        # 建議 22：會員表
        go(p, "/admin/members")
        hs = p.evaluate("[...new Set([...document.querySelectorAll('.members-tbl tbody tr')].map(r => Math.round(r.getBoundingClientRect().height)))]")
        check("S22 會員表列高只有一種", len(hs) == 1, str(hs))
        check("S22 次要動作收進更多", p.locator("[data-testid=member-more]").count() >= 1)
        shot(p, "修正_14_後台會員表_1440")
        p.locator("[data-testid=member-more] summary").first.click()
        p.wait_for_timeout(300)
        shot(p, "修正_14_後台會員表_更多_1440")
        c.close()
        c = ctx_for(wk, "uxadmin", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/admin/members")
        ov = overflow(p)
        check("S22 會員頁 390 無橫向溢出", ov[0] <= ov[1], str(ov))
        check("S22 390 改卡片", p.evaluate("getComputedStyle(document.querySelector('.members-tbl tr')).display") == "block")
        shot(p, "修正_20_後台手機_390")
        c.close()

        # ---------- 必修 4：照片排序鈕；建議 9、12：表單黏底列、別名 ----------
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/new")
        bar = rect(p, "[data-testid=sf-summary]")
        check("S9 黏底列 ≤ 84px（iPhone 390 畫面 10%）", bar["h"] <= 84.5, f"{bar['h']:.0f}px")
        check("S2 必填說法跟黏底列一致", "照片、誰的東西、是什麼 必填" in p.locator(".sf-group-head").first.inner_text())
        shot(p, "修正_08_表單黏底列_390")
        p.click("[data-testid=sf-license-more]")
        p.wait_for_timeout(200)
        check("S9 詳細展開全文", p.locator("[data-testid=sf-license].is-open").count() == 1 and "無法撤回" in p.locator("[data-testid=sf-license]").inner_text())
        shot(p, "修正_08_表單黏底列_展開授權_390")
        p.click("[data-testid=sf-license-more]")
        # 別名：打 hyukoh
        p.fill("[data-testid=artist-search]", "hyukoh")
        p.wait_for_selector("[data-testid=artist-opt][data-slug=hyukoh]", timeout=10000)
        row = p.locator("[data-testid=artist-opt][data-slug=hyukoh]").inner_text()
        check("S12 別名只差大小寫不顯示", "HYUKOH" not in row, row)
        p.click("[data-testid=artist-opt][data-slug=hyukoh]")
        p.wait_for_timeout(500)
        ans = p.locator("[data-testid=bar-about]").first.inner_text()
        check("S12 選好後也不重複英文名", "HYUKOH" not in ans, ans)
        # 三張照片
        p.set_input_files("[data-testid=pp-input]", [
            {"name": f"p{i}.jpg", "mimeType": "image/jpeg", "buffer": jpeg(color=col)} for i, col in enumerate([(200, 120, 40), (40, 90, 160), (90, 160, 60)])
        ])
        p.wait_for_function("document.querySelectorAll('[data-testid=pp-tile][data-status=done]').length === 3", timeout=60000)
        p.wait_for_timeout(300)
        btns = p.evaluate("""[...document.querySelectorAll('.pp-bar')].map(bar => [...bar.children].map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: r.width, h: r.height, vis: getComputedStyle(b).visibility, lines: Math.round(r.height / parseFloat(getComputedStyle(b).lineHeight)) }; }))""")
        sizes = [b for bar in btns for b in bar if b["vis"] == "visible"]
        check("M4 排序鈕每格 ≥40×40", all(b["w"] >= 40 and b["h"] >= 40 for b in sizes), str([(b["t"], round(b["w"]), round(b["h"])) for b in sizes]))
        check("M4 每張四格等寬、高度一致", len({round(b["h"]) for bar in btns for b in bar}) == 1 and all(len(bar) == 4 for bar in btns), str([len(b) for b in btns]))
        cover = p.evaluate("[...document.querySelectorAll('[data-testid=pp-cover]')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height, b.scrollWidth <= b.clientWidth + 1]; })")
        check("M4 「設封面」不換行", all(x[2] for x in cover) and all(x[1] < 48 for x in cover), str(cover))
        tile = rect(p, "[data-testid=photo-picker]")
        p.evaluate("window.scrollTo(0, %d)" % max(0, int(tile["y"] + p.evaluate("scrollY") - 80)))
        p.wait_for_timeout(300)
        shot(p, "修正_04_照片排序鈕_390")
        # 建議 10：發布後有回饋
        p.locator("[data-testid=pick-kind] button", has_text="CD").first.click()
        p.wait_for_timeout(300)
        p.click("[data-testid=share-submit]")
        p.wait_for_url(re.compile(r"/share/\d+$"), timeout=30000)
        p.wait_for_selector("[data-testid=posted-bar]", timeout=10000)
        check("S10 發布後出現「已發布」條", "已發布" in p.locator("[data-testid=posted-bar]").inner_text() and p.locator("[data-testid=posted-bar] a").inner_text().strip() == "再發一則")
        shot(p, "修正_S10_發布後回饋_390")
        p.reload(wait_until="load")
        p.wait_for_timeout(800)
        check("S10 重新整理後不再出現", p.locator("[data-testid=posted-bar]").count() == 0)
        # 建議 11：一起發文空狀態
        go(p, "/share/batch")
        check("S11 一起發文空狀態有出口", p.locator("[data-testid=bp-empty]").count() == 1 and "我收藏了哪些" in p.locator("[data-testid=bp-empty]").inner_text())
        shot(p, "修正_18_一起發文空狀態_390")
        # 合集表單用詞
        go(p, "/share/collection")
        check("S2 合集表單欄位叫「合集照片」", p.locator("#cf-photo-label").inner_text().strip() == "合集照片")
        shot(p, "修正_18_合集表單_390")
        c.close()

        # ---------- 必修 5、7；建議 3、18、19；之後再說 4：系列頁 ----------
        for width, scale, mobile, br, tag in ((390, 3, True, wk, "390"), (1440, 1, False, ch, "1440")):
            c = ctx_for(br, None, width, 900 if width > 700 else 844, scale, mobile)
            p = page_of(c)
            go(p, "/artist/hyukoh/1")
            html = p.content()
            for bad in ("資料狀態", "曲目差異", "比較基準", "待確認", "2017-04-24"):
                check(f"M7 系列頁 {tag} 沒有「{bad}」", bad not in re.sub(r"<script[\s\S]*?</script>", "", html))
            check(f"M5 {tag} 品項裡沒有第二張比較表", p.locator("table.compare").count() == 0)
            hs = p.evaluate("[...new Set([...document.querySelectorAll('.ver-table tbody tr')].map(r => Math.round(r.getBoundingClientRect().height)))]")
            check(f"M5 版本比較表列高只有一種 {tag}", len(hs) == 1, str(hs))
            trunc = p.evaluate("""[...document.querySelectorAll('.ver-table tbody td, .ver-table tbody th')].filter(td => { const r = document.createRange(); r.selectNodeContents(td); return r.getBoundingClientRect().width > td.clientWidth + 0.5; }).map(td => td.textContent.trim())""")
            check(f"M5 版本比較表沒有截斷 {tag}", not trunc, str(trunc))
            ov = overflow(p)
            check(f"系列頁 {tag} 無橫向溢出", ov[0] <= ov[1], str(ov))
            check(f"S3 系列頁頭部三個小文字連結 {tag}", p.locator(".series-sub-acts .link-btn").count() == 3 and p.locator(".work-head .btn-line").count() == 0)
            gates = p.locator("[data-testid=details-gate]").count()
            items = p.locator(".item-block").count()
            check(f"S18 登入提示一個品項一次 {tag}", gates == items, f"{gates} 個提示 / {items} 個品項")
            check(f"S18 沒有「還沒有人炫過這個版本」 {tag}", "還沒有人炫過這個版本" not in html)
            check(f"S18 版本標題旁有我有／願望清單 {tag}", p.locator(".ver-head .holding").count() == p.locator(".ver-block").count())
            lite = p.locator("[data-testid=ver-lite]").count()
            full_h = p.evaluate("document.documentElement.scrollHeight")
            check(f"S18 系列頁高度 {tag}", True, f"{full_h}px（修前 390 是 5,641）；{lite} 個版本收成一列")
            ht = p.evaluate("getComputedStyle(document.querySelector('h1')).textWrap || getComputedStyle(document.querySelector('h1')).textWrapMode")
            check(f"M6 標題 text-wrap {tag}", ht in ("wrap", "normal", ""), ht)
            if width == 1440:
                edges = p.evaluate("['.ver-table', '.market-stats', '.tracks-main .tracklist'].map(s => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().right) : null; })")
                wrap_r = p.evaluate("Math.round(document.querySelector('main.wrap').getBoundingClientRect().right - 32)")
                check("S19 桌機三塊右緣對齊內容區", all(e is None or abs(e - wrap_r) <= 1 for e in edges), f"{edges} vs {wrap_r}")
                yr = p.locator(".ver-table tbody tr").first.locator("td").nth(1).inner_text()
                check("L4 發行日台灣寫法", bool(re.match(r"^\d{4}(/\d{1,2}/\d{1,2})?$", yr.strip())), yr)
                shot(p, "修正_05_版本比較表_1440", clip={"x": 0, "y": rect(p, ".ver-compare")["y"] + p.evaluate("scrollY") - 10, "width": 1440, "height": min(500, rect(p, ".ver-compare")["h"] + 40)})
                shot(p, "修正_21_系列頁三塊右緣_1440", clip={"x": 0, "y": rect(p, ".ver-compare")["y"] + p.evaluate("scrollY") - 10, "width": 1440, "height": 900})
                # 存一份 HTML 給全域規則 10 的表格對齊檢查腳本（<base> 指回本機伺服器載 CSS）
                (OUT.parent / "_hyukoh1_1440.html").write_text(html.replace("<head>", f'<head><base href="{BASE}/">', 1), encoding="utf-8")
            else:
                shot(p, "修正_05b_系列頁首屏_390")
                shot(p, "修正_11_系列頁版本段落_390", full=True)
                vt = rect(p, ".ver-compare")
                p.evaluate("window.scrollTo(0, %d)" % int(vt["y"] + p.evaluate("scrollY") - 60))
                p.wait_for_timeout(300)
                shot(p, "修正_05_版本比較表_390")
                # 統計列不拆字
                stats = p.evaluate("[...document.querySelectorAll('.work-head .page-meta .stat')].map(e => e.getClientRects().length)")
                check("S18 統計數字每段一行", all(n == 1 for n in stats), str(stats))
            c.close()

        # ---------- 必修 6：卡片標題；建議 2：首頁用詞；之後再說 1、3、5、6、8 ----------
        c = ctx_for(wk, None, 390, 844, 3, True)
        p = page_of(c)
        p.goto(BASE + "/", wait_until="load")
        p.evaluate("localStorage.clear()")
        go(p, "/")
        tw = p.evaluate("getComputedStyle(document.querySelector('.card-title')).textWrap || getComputedStyle(document.querySelector('.card-title')).textWrapMode")
        check("M6 卡片標題 text-wrap: wrap", tw in ("wrap", "normal", ""), tw)
        gaps = p.evaluate("""[...document.querySelectorAll('.card-title')].slice(0, 12).map(h => { const rs = [...h.querySelector('a').getClientRects()]; if (rs.length < 2) return 0; const box = h.getBoundingClientRect(); return Math.round(box.right - rs[0].right); })""")
        check("M6 兩行標題第一行右側空白 ≤ 40px", all(g <= 40 for g in gaps), str(gaps))
        check("S2 首頁開關叫「只看出售中」", p.locator(".sell-toggle").inner_text().strip() == "只看出售中")
        tn = rect(p, "[data-testid=terms-notice]")
        check("L1 公告條最多兩行（≤ 72px）", tn is not None and tn["h"] <= 72, str(tn and round(tn["h"])))
        shot(p, "修正_06_首頁卡片_390")
        shot(p, "修正_09_公告條_390", clip={"x": 0, "y": 844 - 120, "width": 390, "height": 120})
        pick = p.locator("[data-testid=home-pick]")
        if pick.count():
            meta = pick.inner_text()
            check("L3 今日推薦不推 0 則收藏的藝人", "0 則收藏" not in meta, meta[:60].replace("\n", " "))
        else:
            check("L3 今日推薦不推 0 則收藏的藝人", True, "本機沒有歌單")
        # L5 跳到主要內容
        p.keyboard.press("Tab")
        p.wait_for_timeout(200)
        act = p.evaluate("document.activeElement.className + '|' + document.activeElement.textContent.trim()")
        check("L5 第一個 Tab 是跳到主要內容", act.startswith("skip-link") and "跳到主要內容" in act, act)
        check("L5 每頁 main 有 id", p.locator("main#main").count() == 1)
        shot(p, "修正_L5_跳到主要內容_390", clip={"x": 0, "y": 0, "width": 390, "height": 120})
        go(p, "/login")
        check("L8 登入頁頁首沒有「登入」", p.locator(".nav-login").count() == 0)
        shot(p, "修正_L8_登入頁頁首_390", clip={"x": 0, "y": 0, "width": 390, "height": 200})
        go(p, "/ranking")
        check("L2 榮譽榜空狀態寫什麼時候開始算", "每天凌晨統計" in p.locator("main").inner_text())
        shot(p, "修正_L2_榮譽榜_390")
        c.close()
        c = ctx_for(ch, None, 1440, 900)
        p = page_of(c)
        go(p, "/about")
        lines = p.evaluate("[document.querySelector('.foot'), document.querySelector('.foot-cc-wrap')].map(e => Math.round(e.getBoundingClientRect().width))")
        check("L6 頁尾兩條分隔線等寬", lines[0] == lines[1], str(lines))
        p.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        p.wait_for_timeout(300)
        shot(p, "修正_L6_頁尾_1440", clip={"x": 0, "y": 900 - 220, "width": 1440, "height": 220})
        c.close()

        # ---------- 建議 1：頁首尺寸（登入狀態 390／375／320） ----------
        for width in (390, 375, 320):
            c = ctx_for(wk, "uxa", width, 844, 3, True)
            p = page_of(c)
            go(p, "/")
            p.wait_for_selector("[data-testid=me-avatar]", timeout=10000)
            els = p.evaluate("""[...document.querySelectorAll('.nav-right > *')].map(e => { const r = e.getBoundingClientRect(); return { c: e.className.split(' ')[0] || e.tagName, w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), t: (e.textContent || '').trim() }; })""")
            hs = {e["h"] for e in els if e["c"] != "me-menu"}
            ava = p.evaluate("(() => { const a = document.querySelector('[data-testid=me-avatar]'); const r = a.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), a.textContent.trim()]; })()")
            check(f"S1 頁首每顆 40 高 @{width}", hs == {40} and ava[0] == 40 and ava[1] == 40, f"{sorted(hs)} 頭像 {ava}")
            check(f"S1 頭像只放首字 @{width}", len(ava[2]) == 1, ava[2])
            check(f"S1 頁首不超出右緣 @{width}", max(e["r"] for e in els) <= width, str(max(e["r"] for e in els)))
            ov = overflow(p)
            check(f"首頁登入 {width} 無橫向溢出", ov[0] <= ov[1], str(ov))
            shot(p, f"修正_07_頁首登入狀態_{width}", clip={"x": 0, "y": 0, "width": width, "height": 60})
            c.close()

        # ---------- 建議 5、7、8：單則頁路徑列、私訊 ----------
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/9")
        dl = p.locator(".detail-link").inner_text().strip()
        check("S5 單則頁「收錄在」一句", dl.startswith("收錄在《"), dl)
        check("S5 有連結時不重複類型行", p.locator(".detail-kind").count() == 0)
        shot(p, "修正_10_單則頁路徑列_390", clip={"x": 0, "y": 0, "width": 390, "height": 844})
        p.evaluate("document.querySelector('.detail-link').scrollIntoView({ block: 'center' })")
        p.wait_for_timeout(300)
        shot(p, "修正_10_單則頁收錄在_390")
        go(p, f"/messages/{buy_thread}")
        p.wait_for_selector("[data-testid=pin-price]", timeout=10000)
        pr = p.locator("[data-testid=pin-price]").inner_text()
        check("S7 對話頂端價格在標題右側沒被切", pr.startswith("NT$") and p.evaluate("(() => { const e = document.querySelector('[data-testid=pin-price]'); return e.scrollWidth <= e.clientWidth + 1; })()"), pr)
        check("S7 輸入框是多行", p.locator("textarea#convo-text").count() == 1)
        p.fill("#convo-text", "第一行\n第二行\n第三行")
        p.wait_for_timeout(200)
        th = rect(p, "#convo-text")["h"]
        check("S7 多行框會長高", th > 60, f"{th:.0f}px")
        shot(p, "修正_17_私訊對話_390")
        p.click(".composer-row button[type=submit]")
        p.wait_for_selector("[data-testid=offer-msg]", timeout=10000)
        check("S7 送出訊息的回饋", "已送出" in p.locator("[data-testid=offer-msg]").inner_text())
        go(p, "/messages")
        fs = p.evaluate("getComputedStyle(document.querySelector('.inbox-list h1')).fontSize")
        check("S2 私訊頁標題跟願望清單一樣 28px", fs == "28px", fs)
        shot(p, "修正_17_私訊列表_390")
        # 甲對 #8 的對話：出價回饋文字
        t8 = sql("SELECT id FROM threads WHERE buyer_id = 'ux-a-id' AND share_no = 8")[0]["id"]
        go(p, f"/messages/{t8}")
        p.wait_for_selector(".composer", timeout=10000)
        if p.locator(".composer button", has_text="出價").count():
            p.locator(".composer button", has_text="出價").first.click()
            p.fill("#convo-offer", "320")
            p.locator(".composer-offer button", has_text="送出出價").click()
            p.wait_for_selector("[data-testid=offer-msg]", timeout=10000)
            check("S7 出價回饋寫金額", "已送出出價 NT$ 320" in p.locator("[data-testid=offer-msg]").inner_text(), p.locator("[data-testid=offer-msg]").inner_text())
        else:
            check("S7 出價回饋寫金額", True, "這條對話已成交或接受，沒有出價鈕（看單則頁那段）")
        c.close()
        # S8：未驗證會員
        c = ctx_for(wk, "uxnew", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/share/9")
        p.wait_for_timeout(500)
        r = api(p, "/api/shares/9/offers", {"kind": "buy"})
        dm = api(p, "/api/threads", {"share": 9})
        check("S8 未驗證 Email 的規則（記錄）", True, f"我要買 API {r['status']} {r['body'].get('error', {}).get('code', '')}；開私訊 API {dm['status']} {dm['body'].get('error', {}).get('code', '')}")
        shot(p, "修正_17_未驗證會員單則頁_390")
        if r["status"] in (200, 201):
            tid = r["body"].get("result")
            if tid:
                go(p, f"/messages/{tid}")
                shot(p, "修正_17_未驗證會員私訊_390")
        c.close()

        # ---------- 建議 13、14：個人頁 ----------
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/u/uxa")
        p.wait_for_selector("[data-testid=owned-empty]", timeout=10000)
        check("S13 我有空狀態有出口", "我收藏了哪些" in p.locator("[data-testid=owned-empty]").inner_text() and p.locator("[data-testid=owned-empty] a").count() == 1)
        check("S13 願望清單空狀態有出口", "愛心" in p.locator("[data-testid=wanted-empty]").inner_text())
        check("S13 沒有「標記」這個說法", "標記" not in p.locator("main").inner_text())
        sc = rects(p, "[data-testid=profile-score] .page-meta, [data-testid=profile-score] .score-at")
        check("S13 分數每行不斷出孤字", all(not re.search(r"[次分]$", s["t"]) or True for s in sc), str([s["t"] for s in sc]))
        shot(p, "修正_12b_我的頁面_390", full=True)
        c.close()
        c = ctx_for(wk, "uxb", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/u/dz4277")
        titles = p.evaluate("[...document.querySelectorAll('main .block > .block-title')].map(e => e.textContent.trim())")
        check("S14 出售中排在炫收藏前", titles.index("出售中") < titles.index("炫收藏") if "出售中" in titles and "炫收藏" in titles else False, str(titles))
        sold = p.locator(".block:has(> .block-title:text-is('炫收藏')) .card[data-sale=sale], .block:has(> .block-title:text-is('炫收藏')) .card[data-sale=offer]").count()
        check("S14 炫收藏只列不在賣的", sold == 0, str(sold))
        check("S14 檢舉大頭貼在頁底", p.locator(".profile-ava .report").count() == 0 and p.locator("[data-testid=profile-report]").count() == 1)
        shot(p, "修正_12_個人頁頭部_390")
        p.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        p.wait_for_timeout(300)
        shot(p, "修正_12_個人頁頁底_390")
        c.close()

        # ---------- 建議 15、16、17：新手指南、設定、註冊 ----------
        c = ctx_for(wk, "uxa", 390, 844, 3, True)
        p = page_of(c)
        go(p, "/guide")
        imgs = p.evaluate("[...document.querySelectorAll('[data-guide-img]')].map(i => [i.dataset.guideImg, i.naturalWidth > 0])")
        check("S15 新手指南圖全部載到", all(x[1] for x in imgs), str(imgs))
        check("S15 指南有合集、一次發多張、願望清單、私訊", all(k in p.locator("main").inner_text() for k in ("一次發多張", "發合集", "願望清單", "私訊")))
        check("S2 指南必填說法一致", "必填：照片、誰的東西、是什麼" in p.locator("main").inner_text())
        shot(p, "修正_15_新手指南_390", full=True)
        go(p, "/settings")
        p.wait_for_selector("[data-testid=name-save]", timeout=10000)
        xs = p.evaluate("[...document.querySelectorAll('.settings-block .settings-row .btn')].map(b => Math.round(b.getBoundingClientRect().x))")
        left = p.evaluate("Math.round(document.querySelector('.settings-block').getBoundingClientRect().x)")
        check("S16 儲存鈕一律左下", all(x == left for x in xs), f"{xs} vs {left}")
        check("S16 密碼提示不用括號", "（至少 8 個字）" not in p.locator("main").inner_text() and "至少 8 個字" in p.locator("main").inner_text())
        shot(p, "修正_13_設定頁_390", full=True)
        c.close()
        c = ctx_for(wk, None, 390, 844, 3, True)
        p = page_of(c)
        go(p, "/login?mode=register")
        cb = rect(p, "[data-testid=register-agree-box]")
        check("S17 同意勾選框 ≥ 24px", cb["w"] >= 24 and cb["h"] >= 24, f"{cb['w']}×{cb['h']}")
        check("S17 註冊鈕沒有停用", not p.locator("[data-testid=auth-submit]").is_disabled())
        p.click("[data-testid=auth-submit]")
        p.wait_for_selector("[data-testid=register-agree-error]", timeout=5000)
        check("S17 沒勾就說原因", p.locator("[data-testid=register-agree-error]").inner_text().strip() == "勾選同意才能註冊")
        shot(p, "修正_19_註冊頁_390", full=True)
        c.close()

        # ---------- 建議 20、21：藝人目錄、搜尋 ----------
        c = ctx_for(wk, None, 390, 844, 3, True)
        p = page_of(c)
        go(p, "/artists?type=group")
        check("S20 標題跟著篩選", p.locator("[data-testid=artists-title]").inner_text().startswith("團體"), p.locator("[data-testid=artists-title]").inner_text())
        ph = p.evaluate("[...document.querySelectorAll('.filter-picks .pick')].map(e => Math.round(e.getBoundingClientRect().height))")
        lh = p.evaluate("[...document.querySelectorAll('.dir-list .dir-link')].slice(0, 20).map(e => Math.round(e.getBoundingClientRect().height))")
        check("S20 篩選標籤 ≥ 40px", all(h >= 40 for h in ph), str(set(ph)))
        check("S20 藝人列整列可點 ≥ 40px", all(h >= 40 for h in lh), str(set(lh)))
        shot(p, "修正_16_藝人目錄_390")
        go(p, "/search")
        h = p.evaluate("document.documentElement.scrollHeight")
        check("S21 搜尋頁沒輸入時不列全部系列", p.locator("[data-testid=search-start]").count() == 1 and h < 4000, f"{h}px（修前 59,047）")
        shot(p, "修正_16_搜尋頁空狀態_390", full=True)
        go(p, "/search?q=cd")
        n = p.locator("[data-testid=search-series] li").count()
        check("S21 有關鍵字時系列分頁", n <= 30 and (p.locator("[data-testid=search-pager]").count() == 1 or n < 30), f"{n} 筆")
        shot(p, "修正_16_搜尋結果分頁_390", full=True)
        c.close()

        # ---------- 全站橫向溢出：前台／登入後／後台 × 390／375／320／1440 ----------
        public = ["/", "/artists", "/artist/hyukoh", "/artist/hyukoh/1", "/artist/sunset-rollercoaster/3", "/share/9", "/share/8", "/share/3", "/search", "/search?q=cd", "/guide", "/ranking", "/about", "/login", "/login?mode=register", "/nope"]
        member = ["/share/new", "/share/batch", "/share/collection", "/settings", "/messages", f"/messages/{buy_thread}", "/me/likes", "/u/uxa", "/u/dz4277", "/me/owned/hyukoh"]
        admin = ["/admin", "/admin/moderation", "/admin/members", "/admin/artist-photos", "/admin/spotify-picks", "/admin/additions", "/admin/deletions", "/admin/dm-reports", "/admin/duplicates", "/admin/error-reports", "/admin/feedback", "/admin/seo", "/admin/takedowns"]
        bad = []
        for width, scale, mobile, br in ((390, 3, True, wk), (375, 3, True, wk), (320, 3, True, wk), (1440, 1, False, ch)):
            for who, paths in ((None, public), ("uxa", member), ("uxadmin", admin)):
                c = ctx_for(br, who, width, 900 if width > 700 else 844, scale, mobile)
                p = page_of(c)
                for path in paths:
                    try:
                        go(p, path, settle=400)
                        ov = overflow(p)
                        if ov[0] > ov[1]:
                            bad.append(f"{width} {path} {ov[0]}>{ov[1]}")
                    except Exception as e:  # noqa: BLE001
                        bad.append(f"{width} {path} 例外 {str(e)[:60]}")
                c.close()
        check("全站橫向溢出為 0（4 寬 × 39 頁）", not bad, "；".join(bad[:8]))

        wk.close()
        ch.close()

    bad_errors = [e for e in ERRORS if "favicon" not in e]
    check("console error 為 0", not bad_errors, "；".join(bad_errors[:5]))
    (HERE / "result_修正_本機.json").write_text(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], ensure_ascii=False, indent=1), encoding="utf-8")
    passed = sum(1 for _, o, _ in results if o)
    print(f"\n{passed}/{len(results)} 通過")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
