"""私訊改版＋頁首願望清單 本機驗收（2026-10-01）。

用法（網站/ 先用正式站備份還原本機 D1、套遷移、ADMIN_EMAILS=dmadmin@example.invalid npm run build，再 npm start -- --port 8795）：
    python3 _驗收_本機.py [http://127.0.0.1:8795]

- 帳號：本機 D1 直接建 dmtest-a／dmtest-b／dmadmin（Email 已驗證）＋session；賣家用備份裡的站長帳號（本機副本）
- 每次跑先刪掉這幾個帳號相關的對話、訊息、封鎖、檢舉，可以重跑
- 截圖 img/，JPEG 品質 80；Chromium 走完整流程，WebKit（3x）只量版面＋截圖
"""

import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8795"
HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent / "網站"
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)
HOST = "127.0.0.1"

OWNER = "dz4277"  # 備份裡的站長（本機副本）：#3 #4 #5 純分享、#8 開放出價、#9 #10 定價出售
USERS = {
    "a": ("dmtest-a", "dmtest_a", "私訊測試甲", "dmtest-a@example.invalid"),
    "b": ("dmtest-b", "dmtest_b", "私訊測試乙", "dmtest-b@example.invalid"),
    "adm": ("dmtest-admin", "dmtest_admin", "私訊測試管理", "dmadmin@example.invalid"),
}
TOKENS = {k: f"dmtesttoken{k}{'x' * 40}" for k in [*USERS, "owner"]}

results: list[tuple[str, bool, str]] = []


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
    ids = [u[0] for u in USERS.values()]
    owner_id = sql(f"SELECT id FROM users WHERE handle = '{OWNER}'")[0]["id"]
    everyone = ids + [owner_id]
    inn = ",".join(f"'{i}'" for i in ids)
    allin = ",".join(f"'{i}'" for i in everyone)
    # 清掉上一輪：這幾個人參與的對話（含站長跟測試帳號的）、封鎖、檢舉、設定
    sql(f"DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE buyer_id IN ({inn}) OR peer_id IN ({inn}))")
    sql(f"DELETE FROM thread_reads WHERE user_id IN ({allin})")
    sql(f"DELETE FROM offers WHERE buyer_id IN ({inn})")
    sql(f"DELETE FROM dm_reports WHERE reporter_id IN ({allin}) OR reported_id IN ({allin})")
    sql(f"DELETE FROM threads WHERE buyer_id IN ({inn}) OR peer_id IN ({inn})")
    sql(f"DELETE FROM user_blocks WHERE blocker_id IN ({allin}) OR blocked_id IN ({allin})")
    sql("DELETE FROM settings WHERE key = 'dm_daily_new_limit'")
    sql("DELETE FROM rate_limits WHERE key LIKE 'msg:%' OR key LIKE 'offer:%'")
    for k, (uid, handle, name, email) in USERS.items():
        sql(
            f"INSERT OR IGNORE INTO users (id, email, email_verified_at, password_hash, handle, name, name_key) "
            f"VALUES ('{uid}', '{email}', '2026-10-01T00:00:00.000Z', '!test', '{handle}', '{name}', '{name}')"
        )
        sql(f"UPDATE users SET email_verified_at = '2026-10-01T00:00:00.000Z', status = 'active' WHERE id = '{uid}'")
    for k in TOKENS:
        uid = owner_id if k == "owner" else USERS[k][0]
        h = hashlib.sha256(TOKENS[k].encode()).hexdigest()
        sql(f"INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('{h}', '{uid}', '2026-12-31T00:00:00.000Z')")
    return owner_id


def ctx_for(browser, who: str | None, width=1440, height=900, scale=1, mobile=False):
    c = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile)
    cookies = [{"name": "yz_test_country", "value": "TW", "domain": HOST, "path": "/"}]
    if who:
        cookies.append({"name": "yz_session", "value": TOKENS[who], "domain": HOST, "path": "/", "httpOnly": True})
    c.add_cookies(cookies)
    return c


ERRORS: list[str] = []


def page_of(c):
    p = c.new_page()
    p.on("console", lambda m: ERRORS.append(f"{p.url} {m.text}") if m.type == "error" and "/img/" not in m.text and not re.search(r"status of (404|403|409|429)", m.text) else None)
    return p


def go(p, path: str):
    p.goto(BASE + path, wait_until="load")
    p.wait_for_function("document.fonts.ready.then(() => true)")
    try:
        p.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass


def shot(p, name: str, full=False):
    p.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def api(p, path: str, body=None):
    return p.evaluate(
        """async ([path, body]) => {
          const r = await fetch(path, body === null ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
          let j = {}; try { j = await r.json(); } catch {}
          return { status: r.status, body: j };
        }""",
        [path, body],
    )


def badge(p) -> int:
    el = p.locator('[data-testid="nav-dm"] [data-testid="unread-badge"]')
    return int(el.inner_text()) if el.count() else 0


def open_dm(p, path: str, testid: str) -> int:
    go(p, path)
    btn = p.locator(f'[data-testid="{testid}"]').first
    btn.click()
    p.wait_for_url(re.compile(r"/messages/\d+$"), timeout=15000)
    return int(p.url.rsplit("/", 1)[1])


def send(p, text: str):
    p.fill("#convo-text", text)
    p.click(".composer-row button[type=submit]")
    p.locator(".msg p", has_text=text).wait_for(timeout=10000)


def header_layout(p, width: int) -> dict:
    return p.evaluate(
        """(w) => {
          const row = document.querySelector('.nav-row');
          const kids = [...row.querySelectorAll('.logo, .nav-right > *')].filter(e => e.offsetParent !== null);
          const rects = kids.map(e => ({ c: e.className || e.tagName, l: e.getBoundingClientRect().left, r: e.getBoundingClientRect().right, t: e.getBoundingClientRect().top, b: e.getBoundingClientRect().bottom }));
          let overlap = 0;
          for (let i = 1; i < rects.length; i++) if (rects[i].l < rects[i - 1].r - 0.5) overlap++;
          const logo = document.querySelector('.logo');
          return { maxRight: Math.max(...rects.map(r => r.r)), minLeft: Math.min(...rects.map(r => r.l)), overlap, rows: new Set(rects.map(r => Math.round((r.t + r.b) / 2))).size,
                   logoH: logo.getBoundingClientRect().height, docW: document.documentElement.scrollWidth, items: rects.map(r => `${String(r.c).split(' ')[0]}:${Math.round(r.l)}-${Math.round(r.r)}`) };
        }""",
        width,
    )


def main():
    owner_id = setup()
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ca, cb, co, cadm = (ctx_for(br, w) for w in ("a", "b", "owner", "adm"))
        pa, pb, po, padm = (page_of(c) for c in (ca, cb, co, cadm))

        # ---------- 1 頁首 ----------
        go(pa, "/")
        dm = pa.locator('[data-testid="nav-dm"]')
        wish = pa.locator('[data-testid="nav-wish"]')
        check("1a 頁首私訊：文字「私訊」、連 /messages", dm.inner_text().strip() == "私訊" and dm.get_attribute("href") == "/messages", dm.inner_text())
        check("1b 頁首願望清單：文字「願望清單」、連 /me/likes", wish.inner_text().strip() == "願望清單" and wish.get_attribute("href") == "/me/likes")
        check("1c 沒有「聊聊」字樣", "聊聊" not in pa.content())
        pa.click('[data-testid="me-avatar"]')
        check("1d 選單「願望清單」", pa.locator(".menu-panel a", has_text="願望清單").count() == 1 and pa.locator(".menu-panel", has_text="喜愛").count() == 0)
        go(pa, "/me/likes")
        check("1e 願望清單頁標題", pa.locator("h1.page-title").inner_text() == "願望清單" and "願望清單" in pa.title(), pa.title())
        shot(pa, "1440_頁首_登入")

        # ---------- 2 三個入口 ----------
        go(pa, "/share/3")
        check("2a 純分享收藏有「私訊」", pa.locator('[data-testid="dm-share"]').inner_text() == "私訊")
        go(pa, "/share/9")
        check("2b 定價出售維持「問賣家」", pa.locator('[data-testid="dm-share"]').inner_text() == "問賣家")
        go(pa, "/share/8")
        check("2c 開放出價也有「問賣家」", pa.locator('[data-testid="dm-share"]').first.inner_text() == "問賣家")
        shot(pa, "1440_單則頁_開放出價_問賣家")
        go(pa, f"/u/{OWNER}")
        check("2d 別人的個人頁有「傳訊息」", pa.locator('[data-testid="dm-user"]').inner_text() == "傳訊息")
        shot(pa, "1440_個人頁_傳訊息")
        go(po, "/share/3")
        check("2e 自己的收藏沒有私訊鈕", po.locator('[data-testid="dm-share"]').count() == 0)
        go(po, f"/u/{OWNER}")
        check("2f 自己的個人頁沒有傳訊息", po.locator('[data-testid="dm-user"]').count() == 0)

        t3 = open_dm(pa, "/share/3", "dm-share")
        pa.locator(".convo[data-kind]").wait_for(timeout=10000)
        send(pa, "你好，想問 #3 這張的狀況")
        check("2g 從純分享收藏開的對話釘住那則", pa.locator(".convo .pin-title").inner_text().strip() != "" and pa.locator(".convo[data-kind=share]").count() == 1)
        shot(pa, "1440_對話_收藏")
        t9 = open_dm(pa, "/share/9", "dm-share")
        send(pa, "請問 #9 還在嗎")
        check("2h 同一對人不同收藏＝不同對話", t9 != t3, f"{t3} vs {t9}")
        t9b = open_dm(pa, "/share/9", "dm-share")
        check("2i 同一則再按一次回到同一條", t9b == t9)
        td = open_dm(pa, f"/u/{OWNER}", "dm-user")
        pa.locator(".convo[data-kind]").wait_for(timeout=10000)
        check("2j 個人頁開的是直接私訊（不綁收藏）", pa.locator(".convo[data-kind=direct]").count() == 1 and td not in (t3, t9))
        send(pa, "直接私訊你一下")
        shot(pa, "1440_對話_直接私訊")
        r = sql(f"SELECT share_no, buyer_id, peer_id, pair_key, started_at FROM threads WHERE id = {td}")[0]
        check("2k 直接私訊資料：share_no=0、peer＝站長、started_at 有值", r["share_no"] == 0 and r["peer_id"] == owner_id and r["started_at"], json.dumps(r))

        # ---------- 3 列表與未讀 ----------
        go(po, "/")
        n0 = badge(po)
        check("3a 賣家頁首未讀 3（對話數）", n0 == 3, str(n0))
        bg = po.evaluate("getComputedStyle(document.querySelector('[data-testid=nav-dm] [data-testid=unread-badge]')).backgroundColor")
        check("3b 未讀是橘色方塊", bg == "rgb(255, 106, 0)", bg)
        shot(po, "1440_頁首_未讀3")
        go(po, "/messages")
        rows = po.locator(".thread-row")
        order = [int(rows.nth(i).get_attribute("data-thread")) for i in range(rows.count())]
        check("3c 列表三條，依最新訊息排序（直接私訊最新在最上）", order[:3] == [td, t9, t3], str(order))
        check("3d 直接私訊顯示大頭貼、收藏相關顯示縮圖＋標題",
              po.locator(f'.thread-row[data-thread="{td}"] .thread-ava').count() == 1
              and po.locator(f'.thread-row[data-thread="{t3}"] .thread-thumb').count() == 1
              and po.locator(f'.thread-row[data-thread="{t3}"] .thread-what').inner_text().strip() != "")
        fw = po.evaluate(f"getComputedStyle(document.querySelector('.thread-row[data-thread=\"{t3}\"] .thread-who')).fontWeight")
        check("3e 未讀加粗", po.locator(".thread-row.is-unread").count() == 3 and fw == "700", fw)
        shot(po, "1440_私訊列表_未讀")
        po.click(f'.thread-row[data-thread="{td}"]')
        po.wait_for_url(re.compile(rf"/messages/{td}$"))
        po.locator(".msg p", has_text="直接私訊你一下").wait_for()
        time.sleep(1)
        go(po, "/messages")
        check("3f 讀了一條，未讀變 2", badge(po) == 2 and po.locator(".thread-row.is-unread").count() == 2, str(badge(po)))
        go(po, f"/messages/{td}")
        send(po, "收到，你好")
        go(pa, "/")
        check("3g 回覆後對方未讀 1", badge(pa) == 1, str(badge(pa)))
        go(pa, f"/messages/{td}")
        time.sleep(1)
        go(pa, "/")
        check("3h 讀完未讀歸零（方塊消失）", badge(pa) == 0)

        # ---------- 4 驗證 Email ----------
        sql("UPDATE users SET email_verified_at = NULL WHERE id = 'dmtest-b'")
        go(pb, f"/u/{USERS['a'][1]}")
        pb.click('[data-testid="dm-user"]')
        pb.locator(".dm-error").wait_for(timeout=10000)
        check("4a 沒驗證 Email：開對話被擋，提示驗證", "驗證 Email 後才能私訊" in pb.locator(".dm-error").inner_text(), pb.locator(".dm-error").inner_text())
        shot(pb, "1440_未驗證Email")
        rr = api(pb, "/api/shares/3/threads", {})
        check("4b 沒驗證 Email：API 也擋", rr["status"] == 403 and rr["body"]["error"]["code"] == "EMAIL_UNVERIFIED", str(rr))
        sql("UPDATE users SET email_verified_at = '2026-10-01T00:00:00.000Z' WHERE id = 'dmtest-b'")

        # ---------- 5 每日上限（後台調 2） ----------
        go(padm, "/admin/dm-reports")
        check("5a 後台上限預設 10", padm.locator('[data-testid="dm-limit-input"]').input_value() == "10")
        padm.fill('[data-testid="dm-limit-input"]', "2")
        padm.click('[data-testid="dm-limit-save"]')
        padm.locator(".field-ok").wait_for()
        check("5b 後台改成 2", sql("SELECT value FROM settings WHERE key='dm_daily_new_limit'")[0]["value"] == "2")
        tb1 = open_dm(pb, f"/u/{USERS['a'][1]}", "dm-user")
        send(pb, "乙的第一個對話")
        open_dm(pb, "/share/3", "dm-share")
        send(pb, "乙的第二個對話")
        open_dm(pb, "/share/4", "dm-share")
        pb.fill("#convo-text", "乙的第三個對話")
        pb.click(".composer-row button[type=submit]")
        err = pb.locator('[data-testid="offer-msg-error"]')
        err.wait_for(timeout=10000)
        check("5c 第三個新對話被擋", "今天已經開了 2 個新對話" in err.inner_text(), err.inner_text())
        shot(pb, "1440_每日上限")
        go(pb, f"/messages/{tb1}")
        send(pb, "已經在聊的照樣能傳")
        check("5d 已經在聊的不受限", True)
        go(pa, f"/messages/{tb1}")
        send(pa, "甲回乙")
        check("5e 對方回覆不算對方開新對話", sql("SELECT count(*) n FROM threads WHERE buyer_id='dmtest-a' AND started_at IS NOT NULL")[0]["n"] == 3)
        go(padm, "/admin/dm-reports")
        padm.fill('[data-testid="dm-limit-input"]', "10")
        padm.click('[data-testid="dm-limit-save"]')
        padm.locator(".field-ok").wait_for()

        # ---------- 6 封鎖 ----------
        go(po, f"/messages/{t3}")
        po.click('[data-testid="dm-block"]')
        shot(po, "1440_封鎖確認")
        po.click('[data-testid="dm-block-confirm"]')
        po.locator('[data-testid="dm-blocked-me"]').wait_for()
        check("6a 封鎖後自己這邊顯示「你已封鎖」＋解除鈕", po.locator('[data-testid="dm-unblock"]').count() == 1)
        go(pa, f"/messages/{t3}")
        check("6b 被封鎖的一方看到無法傳訊息、沒有輸入框", pa.locator('[data-testid="dm-blocked-them"]').count() == 1 and pa.locator("#convo-text").count() == 0)
        shot(pa, "1440_被封鎖")
        rr = api(pa, f"/api/threads/{t3}/messages", {"text": "繞過畫面"})
        check("6c 被封鎖：API 送訊息 403", rr["status"] == 403 and rr["body"]["error"]["code"] == "BLOCKED", str(rr))
        rr = api(pa, f"/api/threads/{td}/messages", {"text": "換一條"})
        check("6d 被封鎖：其他既有對話也不能傳", rr["status"] == 403, str(rr))
        go(pa, "/share/5")
        pa.click('[data-testid="dm-share"]')
        pa.locator(".dm-error").wait_for(timeout=10000)
        check("6e 被封鎖：不能開新對話", "目前無法傳訊息給這位會員" in pa.locator(".dm-error").inner_text())
        rr = api(pa, "/api/shares/8/offers", {"kind": "offer", "price": 500})
        check("6f 被封鎖：也不能出價（出價會進私訊）", rr["status"] == 403, str(rr))
        rr = api(po, f"/api/threads/{t3}/messages", {"text": "封鎖人也不能傳"})
        check("6g 封鎖的人自己也不能傳（要先解除）", rr["status"] == 403 and rr["body"]["error"]["code"] == "BLOCKED_BY_ME", str(rr))
        go(po, "/settings")
        box = po.locator('[data-testid="blocks-box"]')
        check("6h 設定頁封鎖名單列出甲", box.locator(f'li[data-handle="{USERS["a"][1]}"]').count() == 1)
        box.scroll_into_view_if_needed()
        shot(po, "1440_設定_封鎖名單")
        box.locator('[data-testid="unblock"]').click()
        po.locator('[data-testid="blocks-msg"]').wait_for()
        check("6i 解除後名單空", "沒有封鎖任何人" in box.inner_text())
        rr = api(pa, f"/api/threads/{t3}/messages", {"text": "解除後可以傳了"})
        check("6j 解除後甲可以再傳", rr["status"] == 200, str(rr))

        # ---------- 7 檢舉 ----------
        go(po, f"/messages/{td}")
        po.click('[data-testid="dm-report"]')
        po.check('input[name="dm-reason"][value="harass"]')
        po.fill("#dm-report-note", "一直傳廣告連結")
        shot(po, "1440_檢舉表單")
        po.click('[data-testid="dm-report-send"]')
        po.locator('[data-testid="dm-reported"]').wait_for()
        check("7a 檢舉後變「已檢舉」", True)
        rr = api(po, f"/api/threads/{td}/report", {"reason": "harass"})
        check("7b 同一條只能檢舉一次", rr["status"] == 409, str(rr))
        rr = api(pb, f"/api/threads/{td}/report", {"reason": "harass"})
        check("7c 不是對話的人不能檢舉", rr["status"] == 404, str(rr))
        go(padm, "/admin/dm-reports")
        row = padm.locator('[data-testid="dm-report-table"] tbody tr').first
        txt = row.inner_text()
        check("7d 後台看得到檢舉人、被檢舉、理由、補充", "私訊測試甲" in txt and "騷擾" in txt and "一直傳廣告連結" in txt and "直接私訊" in txt, txt.replace("\n", " | "))
        html = padm.content()
        check("7e 後台不顯示訊息內容", not any(s in html for s in ["直接私訊你一下", "收到，你好", "你好，想問", "乙的第一個對話"]))
        shot(padm, "1440_後台_私訊檢舉")
        row.locator('[data-testid="dm-report-done"]').click()
        padm.locator('tr[data-status="done"]').first.wait_for()
        check("7f 後台可標為已處理", True)
        rr = api(pa, "/api/admin/dm-reports", None)
        check("7g 非管理員讀不到後台 API", rr["status"] == 403, str(rr["status"]))

        # ---------- 8 手機截圖＋頁首量測（Chromium） ----------
        for w in (390, 360, 320):
            for who in ("owner", None):
                c = ctx_for(br, who, w, 800, 3, True)
                p = page_of(c)
                go(p, "/")
                m = header_layout(p, w)
                tag = "登入" if who else "訪客"
                check(f"8 Chromium {w} {tag} 頁首放得下（一行、不重疊、不超出）", m["maxRight"] <= w + 0.5 and m["overlap"] == 0 and m["rows"] == 1 and m["docW"] <= w, json.dumps(m, ensure_ascii=False))
                if who:
                    labels = p.evaluate("[...document.querySelectorAll('.nav-right a, .nav-right button, .nav-right summary')].filter(e=>e.offsetParent).map(e => e.getAttribute('aria-label') || e.textContent.trim())")
                    check(f"8 {w} 手機圖示都有 aria-label", all(labels), str(labels))
                    texts_hidden = p.evaluate("[...document.querySelectorAll('.nav-link-text')].every(e => getComputedStyle(e).display === 'none')")
                    check(f"8 {w} 手機只放圖示", texts_hidden)
                shot(p, f"{w}_頁首_{tag}")
                if who:
                    go(p, "/messages")
                    shot(p, f"{w}_私訊列表")
                    go(p, f"/messages/{t3}")
                    shot(p, f"{w}_對話_收藏")
                    go(p, f"/messages/{td}")
                    shot(p, f"{w}_對話_直接私訊")
                c.close()
        br.close()

        # ---------- 9 WebKit ----------
        wk = pw.webkit.launch()
        for w in (1440, 390, 360, 320):
            for who in ("owner", None):
                mobile = w < 700
                c = ctx_for(wk, who, w, 900 if w == 1440 else 800, 3 if mobile else 1, mobile)
                p = page_of(c)
                go(p, "/")
                m = header_layout(p, w)
                tag = "登入" if who else "訪客"
                check(f"9 WebKit {w} {tag} 頁首放得下", m["maxRight"] <= w + 0.5 and m["overlap"] == 0 and m["rows"] == 1 and m["docW"] <= w, json.dumps(m, ensure_ascii=False))
                shot(p, f"WebKit_{w}_頁首_{tag}")
                if who:
                    go(p, "/messages")
                    ov = p.evaluate("document.documentElement.scrollWidth")
                    check(f"9 WebKit {w} 私訊列表不溢出", ov <= w, str(ov))
                    shot(p, f"WebKit_{w}_私訊列表")
                    go(p, f"/messages/{td}")
                    ov = p.evaluate("document.documentElement.scrollWidth")
                    check(f"9 WebKit {w} 對話不溢出", ov <= w, str(ov))
                    shot(p, f"WebKit_{w}_對話_直接私訊")
                c.close()
        wk.close()

    check("console 沒有錯誤（照片 404 除外）", not ERRORS, "\n".join(ERRORS[:8]))
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 通過")
    (HERE / "result_本機.json").write_text(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], ensure_ascii=False, indent=1))
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
