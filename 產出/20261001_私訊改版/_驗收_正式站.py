"""私訊改版 正式站驗收（2026-10-01，lemibox.com）。

- 正式 D1 直接建兩個測試帳號＋session（Turnstile 過不了），跑完不刪，清單印在最後由使用者決定
- 站長的收藏只「開對話不傳訊息」（空對話不會出現在站長的列表、不算未讀），真正互傳只在兩個測試帳號之間
- 用法：在 網站/ 載入 _私人/cloudflare.txt 後 python3 _驗收_正式站.py
"""

import hashlib
import json
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "https://lemibox.com"
HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent / "網站"
OUT = HERE / "img"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
A = ("lmbtest-dm1001-a", "lmbtestdm1001a", "私訊驗收甲", "lmbtest-dm1001-a@example.invalid")
B = ("lmbtest-dm1001-b", "lmbtestdm1001b", "私訊驗收乙", "lmbtest-dm1001-b@example.invalid")
TOK = {"a": secrets.token_hex(24), "b": secrets.token_hex(24)}
results = []
ERRORS = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)


def sql(q):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--remote",
         "--config", "wrangler.production.jsonc", "--json", "--command", q],
        cwd=SITE, check=True, capture_output=True, text=True,
    )
    return json.loads(r.stdout)[-1]["results"]


def setup():
    for uid, handle, name, email in (A, B):
        sql(f"INSERT OR IGNORE INTO users (id, email, email_verified_at, password_hash, handle, name, name_key) "
            f"VALUES ('{uid}', '{email}', '2026-10-01T00:00:00.000Z', '!test', '{handle}', '{name}', '{name}')")
    for k, u in (("a", A), ("b", B)):
        h = hashlib.sha256(TOK[k].encode()).hexdigest()
        sql(f"INSERT INTO sessions (id, user_id, expires_at) VALUES ('{h}', '{u[0]}', '2026-10-02T12:00:00.000Z')")


def ctx(br, who, w=1440, h=900, scale=1, mobile=False):
    c = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile, user_agent=UA)
    if who:
        c.add_cookies([{"name": "yz_session", "value": TOK[who], "domain": "lemibox.com", "path": "/", "httpOnly": True, "secure": True}])
    return c


def page(c):
    p = c.new_page()
    p.on("console", lambda m: ERRORS.append(f"{p.url} {m.text}") if m.type == "error" and not re.search(r"status of (403|404|409|429)|font-size:0|challenges.cloudflare", m.text) else None)
    return p


def go(p, path):
    p.goto(BASE + path, wait_until="load")
    p.wait_for_function("document.fonts.ready.then(() => true)")
    time.sleep(2.5)


def shot(p, name):
    p.screenshot(path=str(OUT / f"正式站_{name}.jpg"), type="jpeg", quality=80)


def api(p, path, body=None):
    return p.evaluate(
        """async ([path, body]) => { const r = await fetch(path, body === null ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; }""", [path, body])


def badge(p):
    el = p.locator('[data-testid="nav-dm"] [data-testid="unread-badge"]')
    return int(el.inner_text()) if el.count() else 0


def open_dm(p, path, testid):
    go(p, path)
    p.locator(f'[data-testid="{testid}"]').first.click()
    p.wait_for_url(re.compile(r"/messages/\d+$"), timeout=20000)
    p.locator(".convo[data-kind]").wait_for(timeout=15000)
    return int(p.url.rsplit("/", 1)[1])


def send(p, text):
    p.fill("#convo-text", text)
    p.click(".composer-row button[type=submit]")
    p.locator(".msg p", has_text=text).wait_for(timeout=15000)


def layout(p):
    return p.evaluate("""() => { const kids = [...document.querySelectorAll('.nav-row .logo, .nav-right > *')].filter(e => e.offsetParent !== null);
      const r = kids.map(e => e.getBoundingClientRect()); let ov = 0; for (let i = 1; i < r.length; i++) if (r[i].left < r[i-1].right - .5) ov++;
      return { maxRight: Math.max(...r.map(x => x.right)), overlap: ov, rows: new Set(r.map(x => Math.round((x.top + x.bottom) / 2))).size, docW: document.documentElement.scrollWidth }; }""")


def main():
    setup()
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ca, cb = ctx(br, "a"), ctx(br, "b")
        pa, pb = page(ca), page(cb)
        go(pa, "/")
        check("P1 頁首私訊＋願望清單", pa.locator('[data-testid="nav-dm"]').inner_text().strip() == "私訊" and pa.locator('[data-testid="nav-wish"]').inner_text().strip() == "願望清單")
        check("P1b 沒有「聊聊」", "聊聊" not in pa.content())
        shot(pa, "1440_頁首")
        go(pa, "/me/likes")
        check("P2 願望清單頁標題", pa.locator("h1.page-title").inner_text() == "願望清單")
        go(pa, "/share/9")
        check("P3 定價出售「問賣家」", pa.locator('[data-testid="dm-share"]').inner_text() == "問賣家")
        t3 = open_dm(pa, "/share/3", "dm-share")
        check("P4 純分享收藏「私訊」開出釘住收藏的對話（不傳訊息）", pa.locator(".convo[data-kind=share] .pin-title").count() == 1, f"thread {t3}")
        shot(pa, "1440_對話_收藏_空")
        td = open_dm(pa, f"/u/{B[1]}", "dm-user")
        check("P5 個人頁「傳訊息」開直接私訊", pa.locator(".convo[data-kind=direct]").count() == 1)
        send(pa, "正式站驗收：甲傳給乙")
        go(pb, "/")
        check("P6 乙頁首未讀 1（橘色方塊）", badge(pb) == 1, str(badge(pb)))
        go(pb, "/messages")
        pb.locator(".thread-row").first.wait_for(timeout=20000)
        check("P7 乙列表：直接私訊、大頭貼、加粗", pb.locator(f'.thread-row.is-unread[data-thread="{td}"] .thread-ava').count() == 1)
        shot(pb, "1440_私訊列表_未讀")
        pb.click(f'.thread-row[data-thread="{td}"]')
        pb.locator(".msg p", has_text="甲傳給乙").wait_for(timeout=15000)
        send(pb, "正式站驗收：乙回甲")
        go(pb, "/")
        check("P8 乙讀完未讀歸零", badge(pb) == 0)
        go(pa, "/")
        check("P9 甲收到回覆未讀 1", badge(pa) == 1, str(badge(pa)))
        go(pb, f"/messages/{td}")
        pb.click('[data-testid="dm-block"]')
        pb.click('[data-testid="dm-block-confirm"]')
        pb.locator('[data-testid="dm-blocked-me"]').wait_for(timeout=15000)
        rr = api(pa, f"/api/threads/{td}/messages", {"text": "封鎖後"})
        check("P10 封鎖後甲不能傳（403 BLOCKED）", rr["status"] == 403 and rr["body"].get("error", {}).get("code") == "BLOCKED", str(rr))
        go(pa, f"/messages/{td}")
        pa.locator(".convo[data-kind]").wait_for(timeout=20000)
        check("P11 甲畫面顯示無法傳訊息", pa.locator('[data-testid="dm-blocked-them"]').count() == 1)
        shot(pa, "1440_被封鎖")
        go(pb, "/settings")
        box = pb.locator('[data-testid="blocks-box"]')
        check("P12 乙設定頁封鎖名單有甲", box.locator(f'li[data-handle="{A[1]}"]').count() == 1)
        box.locator('[data-testid="unblock"]').click()
        box.get_by_text("沒有封鎖任何人").wait_for(timeout=15000)
        rr = api(pa, f"/api/threads/{td}/messages", {"text": "正式站驗收：解除後"})
        check("P13 解除後甲可以傳", rr["status"] == 200, str(rr))
        go(pa, f"/messages/{td}")
        pa.click('[data-testid="dm-report"]')
        pa.check('input[name="dm-reason"][value="other"]')
        pa.fill("#dm-report-note", "正式站驗收用的檢舉，請忽略")
        pa.click('[data-testid="dm-report-send"]')
        pa.locator('[data-testid="dm-reported"]').wait_for(timeout=15000)
        rows = sql(f"SELECT reason, note, status FROM dm_reports WHERE reporter_id = '{A[0]}'")
        check("P14 檢舉進後台資料表", len(rows) == 1 and rows[0]["reason"] == "other", json.dumps(rows, ensure_ascii=False))
        rows = sql(f"SELECT id, share_no, started_at FROM threads WHERE buyer_id = '{A[0]}' ORDER BY id")
        check("P15 對話資料：收藏空對話 started_at 空、直接私訊有值", any(r["share_no"] == 3 and r["started_at"] is None for r in rows) and any(r["share_no"] == 0 and r["started_at"] for r in rows), json.dumps(rows))
        for w in (390, 360, 320):
            for who in ("b", None):
                c = ctx(br, who, w, 800, 3, True)
                p = page(c)
                go(p, "/")
                m = layout(p)
                check(f"P16 Chromium {w} {'登入' if who else '訪客'} 頁首一行放得下", m["maxRight"] <= w + .5 and m["overlap"] == 0 and m["rows"] == 1 and m["docW"] <= w, json.dumps(m))
                shot(p, f"{w}_頁首_{'登入' if who else '訪客'}")
                if who:
                    go(p, f"/messages/{td}")
                    shot(p, f"{w}_對話_直接私訊")
                c.close()
        br.close()
        wk = pw.webkit.launch()
        for w in (390, 320):
            c = ctx(wk, "b", w, 800, 3, True)
            p = page(c)
            go(p, "/")
            m = layout(p)
            check(f"P17 WebKit {w} 登入 頁首一行放得下", m["maxRight"] <= w + .5 and m["overlap"] == 0 and m["rows"] == 1 and m["docW"] <= w, json.dumps(m))
            shot(p, f"WebKit_{w}_頁首_登入")
            go(p, "/messages")
            shot(p, f"WebKit_{w}_私訊列表")
            c.close()
        wk.close()
    check("P18 console 沒有錯誤（刻意觸發的 403 與 Turnstile 除外）", not ERRORS, "\n".join(ERRORS[:6]))
    n = sum(ok for _, ok, _ in results)
    print(f"\n{n}/{len(results)} 通過")
    (HERE / "result_正式站.json").write_text(json.dumps([{"name": a, "ok": b, "detail": c} for a, b, c in results], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
