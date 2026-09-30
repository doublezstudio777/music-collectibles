"""作者欄大頭貼＋首頁標語一律顯示 驗收（2026-09-30，併進我的頁面改版包）。

    python3 _驗收_作者頭像與標語.py [http://127.0.0.1:8795]
    正式站：MYPAGE_TOKEN=… python3 _驗收_作者頭像與標語.py https://lemibox.com

- 作者頭像：首頁第一頁每位作者，卡片頭像要跟他個人頁的頭像一致（有大頭貼＝圖、沒有＝首字）；單則頁作者欄各截一張有／沒有大頭貼的
- 本機另外驗「換大頭貼後卡片跟著換」：API 換一張新的，重新整理首頁，卡片網址要變成新的那張（整頁快取跟著換新）
- 標語：WebKit 390／320，訪客與登入各一次，第一個畫面就在、之後位置不動；登入者故意留舊的 localStorage lmb_auth=user 也照樣顯示
"""

import io
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8795"
PROD = "127.0.0.1" not in BASE
HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent / "網站"
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)
PRE = "正式站_" if PROD else ""
HANDLE = "xiaomeng"
results: list[tuple[str, bool, str]] = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)


def shot(page, name, full=False, clip=None):
    kw = {"clip": clip} if clip else {"full_page": full}
    page.screenshot(path=str(OUT / f"{PRE}{name}.jpg"), type="jpeg", quality=80, **kw)


def login() -> str:
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=json.dumps({"email": f"{HANDLE}@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"}).encode(),
        headers={"content-type": "application/json", "origin": BASE},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return re.search(r"yz_session=([^;]+)", r.headers.get("set-cookie", "")).group(1)


def upload_avatar(token: str, color) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), color).save(buf, "WEBP", quality=80)
    body = buf.getvalue()
    b = "----mypage"
    data = (f"--{b}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"avatar.webp\"\r\nContent-Type: image/webp\r\n\r\n").encode() + body + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(f"{BASE}/api/me/avatar", data=data, headers={"content-type": f"multipart/form-data; boundary={b}", "origin": BASE, "cookie": f"yz_session={token}"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())["url"]


CARDS = """() => [...document.querySelectorAll('.card-foot .who')].map(a => {
  const img = a.querySelector('img.ava'); const span = a.querySelector('span.ava');
  return { handle: a.getAttribute('href').replace('/u/', ''), img: img ? img.getAttribute('src') : null, text: span ? span.textContent : null,
           n: a.closest('article')?.querySelector('.card-title a')?.getAttribute('href') }; })"""


def main():
    token = os.environ["MYPAGE_TOKEN"] if PROD else login()
    host = urlparse(BASE).hostname
    cookie = [{"name": "yz_session", "value": token, "domain": host, "path": "/", "httpOnly": True, "secure": PROD}]
    if not PROD:
        subprocess.run(["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
                        "--config", "wrangler.local.jsonc", "--persist-to", ".wrangler/state", "--command",
                        f"DELETE FROM rate_limits WHERE key LIKE 'avatar:demo-{HANDLE}:%'"], cwd=SITE, check=True, capture_output=True)

    with sync_playwright() as p:
        errors = []
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        pg = ctx.new_page()
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        pg.goto(f"{BASE}/?sort=new", wait_until="load")
        pg.wait_for_selector(".card-foot .who")
        cards = pg.evaluate(CARDS)
        truth = {}
        for h in sorted({c["handle"] for c in cards}):
            pg2 = ctx.new_page()
            pg2.goto(f"{BASE}/u/{h}", wait_until="load")
            truth[h] = pg2.get_attribute(".profile-ava img.ava", "src") if pg2.locator(".profile-ava img.ava").count() else None
            pg2.close()
        bad = [c for c in cards if c["img"] != truth[c["handle"]] or (c["img"] is None and not c["text"])]
        with_img = [c for c in cards if c["img"]]
        check("首頁卡片頭像跟作者個人頁一致（有大頭貼顯示圖、沒有顯示首字）", not bad, f"{len(cards)} 張卡、{len(with_img)} 張有大頭貼；不一致 {bad[:3]}")
        check("首頁至少有一張卡片是大頭貼", len(with_img) > 0, str(with_img[:1]))
        if with_img:
            el = pg.locator(f".card-foot .who[href='/u/{with_img[0]['handle']}']").first
            el.scroll_into_view_if_needed()
            art = el.locator("xpath=ancestor::article").bounding_box()
            shot(pg, "1440_首頁卡片_有大頭貼", clip={"x": art["x"] - 8, "y": art["y"] + art["height"] - 140, "width": art["width"] * 2 + 40, "height": 150})
        no_img = [c for c in cards if not c["img"]]
        for label, c in [("有大頭貼", with_img[0] if with_img else None), ("沒大頭貼", no_img[0] if no_img else None)]:
            if not c:
                check(f"單則頁作者欄 {label}：找得到樣本", False)
                continue
            pg.goto(f"{BASE}{c['n']}", wait_until="load")
            pg.wait_for_selector(".detail-by .who")
            src = pg.get_attribute(".detail-by .who img.ava", "src") if pg.locator(".detail-by .who img.ava").count() else None
            check(f"單則頁作者欄 {label}", src == c["img"] and (src or pg.locator(".detail-by .who span.ava").count() == 1), f"{c['n']} {src}")
            bb = pg.locator(".detail-by").bounding_box()
            shot(pg, f"1440_單則頁作者欄_{label}", clip={"x": bb["x"] - 8, "y": bb["y"] - 60, "width": min(900, bb["width"] + 16), "height": bb["height"] + 76})

        # 本機：換大頭貼後卡片跟著換（整頁快取版本換新）
        if not PROD:
            before = [c["img"] for c in cards if c["handle"] == HANDLE]
            new = upload_avatar(token, (255, 106, 0))
            pg.goto(f"{BASE}/?sort=new", wait_until="load")
            after = [c["img"] for c in pg.evaluate(CARDS) if c["handle"] == HANDLE]
            check("換大頭貼後首頁卡片換成新的那張", after and all(a == new for a in after) and new not in before, f"{before[:1]} → {after[:1]}（新 {new}）")
            cache = pg.evaluate("fetch(location.href).then(r => r.headers.get('x-yz-cache'))")
            check("首頁走整頁快取（x-yz-cache 表頭；上一項證明快取版本已換新）", cache in ("HIT", "MISS"), str(cache))
        ctx.close()
        b.close()

        # 標語：WebKit 390／320，訪客＋登入
        wk = p.webkit.launch()
        for w in [390, 320]:
            for who in ["訪客", "登入"]:
                c = wk.new_context(viewport={"width": w, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=3)
                if who == "登入":
                    c.add_cookies(cookie)
                    c.add_init_script("try{localStorage.setItem('lmb_auth','user')}catch(e){}")
                pg = c.new_page()
                pg.on("console", lambda m: errors.append(f"webkit {w}: {m.text}") if m.type == "error" else None)
                pg.goto(f"{BASE}/", wait_until="domcontentloaded")
                first = pg.evaluate("""() => { const t = document.querySelector('[data-testid=home-tagline]');
                    const r = t?.getBoundingClientRect(); const band = t?.nextElementSibling?.getBoundingClientRect();
                    return t ? { top: r.top, h: r.height, op: getComputedStyle(t).opacity, disp: getComputedStyle(t).display, band: band?.top } : null; }""")
                pg.wait_for_load_state("load")
                if who == "登入":
                    pg.wait_for_selector("[data-testid=me-avatar]", timeout=15000)
                pg.wait_for_timeout(1500)
                later = pg.evaluate("""() => { const t = document.querySelector('[data-testid=home-tagline]');
                    const r = t.getBoundingClientRect(); const band = t.nextElementSibling?.getBoundingClientRect();
                    return { top: r.top, h: r.height, op: getComputedStyle(t).opacity, disp: getComputedStyle(t).display, band: band?.top,
                             text: t.innerText, auth: document.documentElement.dataset.auth ?? null }; }""")
                check(f"WebKit {w} {who}：第一個畫面就有標語", first and first["h"] > 0 and first["op"] == "1" and first["disp"] != "none", str(first))
                check(f"WebKit {w} {who}：標語含「關於我們」、之後位置不動", "關於我們" in later["text"] and later["op"] == "1" and first and abs(later["top"] - first["top"]) < 0.5 and abs((later["band"] or 0) - (first["band"] or 0)) < 0.5, f"{first} → {later}")
                check(f"WebKit {w} {who}：<html> 沒有 data-auth", later["auth"] is None)
                shot(pg, f"webkit_{w}_首頁標語_{who}")
                c.close()
        wk.close()
        check("沒有 console error", not errors, "\n".join(errors[:6]))

    ok = sum(1 for r in results if r[1])
    print(f"\n{ok}/{len(results)} 通過")
    (HERE / f"result_作者頭像與標語_{'正式站' if PROD else '本機'}.json").write_text(json.dumps([{"name": n, "ok": o, "detail": d} for n, o, d in results], ensure_ascii=False, indent=1), encoding="utf-8")
    sys.exit(0 if ok == len(results) else 1)


if __name__ == "__main__":
    main()
