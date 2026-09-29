"""金曲金音匯入＋首頁歌曲卡驗收。
用法：python3 _驗收.py 本機|正式 [截圖子資料夾]
- 本機：http://127.0.0.1:8791（彩排資料庫＝正式站備份還原＋匯入）
- 正式：https://yinzang.dblzm.workers.dev，不登入、不建任何資料
參數由環境變數帶：NEW_ARTIST（新顯示、有系列的藝人）、WIKI_ONLY（沒系列、靠獎項＋維基顯示）、HIDDEN（改回自動後不顯示）、SERIES（新匯入系列網址）
"""
import json, os, re, sys, urllib.error, urllib.request
from playwright.sync_api import sync_playwright

MODE = sys.argv[1] if len(sys.argv) > 1 else "本機"
LOCAL = MODE == "本機"
BASE = "http://127.0.0.1:8791" if LOCAL else "https://yinzang.dblzm.workers.dev"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "img", sys.argv[2] if len(sys.argv) > 2 else MODE)
os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
NEW_ARTIST = os.environ["NEW_ARTIST"]
WIKI_ONLY = os.environ["WIKI_ONLY"]
HIDDEN = os.environ["HIDDEN"]
SERIES = os.environ["SERIES"]
results = []
SPOTIFY = re.compile(r"spotify|scdn\.co|spotifycdn")


def ok(name, cond, info=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (f"  {info}" if info else ""), flush=True)


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, dict(r.headers), r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode(errors="replace")


# ---------- 1. 藝人顯示規則 ----------
s, _, html = get("/artists")
listed = set(re.findall(r'href="/artist/([^"/?#]+)"', html))
ok("1a /artists 200", s == 200, f"列出 {len(listed)} 位")
for slug, want, label in [(NEW_ARTIST, 200, "新匯入有系列"), (WIKI_ONLY, 200, "獎項＋維基"), (HIDDEN, 404, "改回自動、沒內容")]:
    s, _, _ = get(f"/artist/{slug}")
    ok(f"1b {label} /artist/{slug} → {want}", s == want, f"實際 {s}")
ok("1c 改回自動的藝人不在 /artists", HIDDEN not in listed)
ok("1d 獎項＋維基的藝人在 /artists", WIKI_ONLY in listed)
s, _, html = get(SERIES)
ok(f"1e 新匯入系列 {SERIES} 200", s == 200)
ok("1f 系列頁有 MusicBrainz 來源", "MusicBrainz" in html)

# ---------- 2. 首頁快取不受影響 ----------
get("/")
s, h, html = get("/")
cache = {k.lower(): v for k, v in h.items()}.get("x-yz-cache", "")
ok("2a 首頁第二次整頁快取 HIT", cache == "HIT", cache)
m = re.search(r'\\"songs\\":(\[.*?\])\}', html)
songs_json = re.findall(r'\{\\"track\\":\\"([A-Za-z0-9]{22})\\",\\"slug\\":\\"([^\\]+)\\",\\"name\\":\\"([^\\]+)\\",\\"meta\\":\\"[^\\]*\\",\\"count\\":(\d+)\}', html)
ok("2b 首頁歌單帶 count", len(songs_json) > 0, f"{len(songs_json)} 首")
counts = {slug: int(c) for _, slug, _, c in songs_json}

# ---------- 3. 每天一首、按鈕 ----------
DAY = 86400_000
INIT = "(() => { const off = %d; const n = Date.now.bind(Date); Date.now = () => n() + off; })();"


def open_home(b, off=0, w=1440):
    ctx = b.new_context(viewport={"width": w, "height": 900}, user_agent=UA)
    ctx.add_init_script(INIT % off)
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: m.type == "error" and not SPOTIFY.search(m.text + (m.location or {}).get("url", "")) and errs.append(m.text[:160]))
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    pg.goto(BASE + "/", wait_until="load", timeout=60000)
    pg.wait_for_selector('[data-testid="home-pick"][data-ready="true"]', timeout=15000)
    pg.wait_for_timeout(500)
    track = pg.get_attribute(".hp-sp", "data-track")
    name = pg.inner_text('[data-testid="pick-name"]')
    btn = pg.inner_text('[data-testid="pick-go"]')
    href = pg.get_attribute('[data-testid="pick-go"]', "href")
    return ctx, pg, errs, track, name, btn, href


with sync_playwright() as p:
    b = p.chromium.launch()
    c1, pg1, e1, t1, n1, btn1, href1 = open_home(b)
    c2, pg2, e2, t2, *_ = open_home(b)
    ok("3a 同一天兩個獨立瀏覽器第一眼同一首", t1 == t2, f"{t1} / {t2}")
    pg2.reload(wait_until="load")
    pg2.wait_for_selector('[data-testid="home-pick"][data-ready="true"]')
    ok("3b 重新整理還是同一首", pg2.get_attribute(".hp-sp", "data-track") == t1)
    pg2.click('[data-testid="pick-shuffle"]')
    pg2.wait_for_timeout(500)
    ok("3c 換一首會換", pg2.get_attribute(".hp-sp", "data-track") != t1)
    ok("3d 首頁 console error 0（不含 Spotify）", not e1 and not e2, str(e1 + e2)[:200])
    pg1.screenshot(path=os.path.join(OUT, "首頁_1440.jpg"), type="jpeg", quality=80)
    c2.close()
    # 隔天、往後 14 天：天天不一定不同，但 14 天裡要有多首；同時找收藏數 0 與 >0 的那天看按鈕
    seen, zero, more = {t1}, None, None
    for d in range(0, 15):
        cx, pgx, ex, tx, nx, bx, hx = open_home(b, d * DAY)
        seen.add(tx)
        slug = hx.rstrip("/").split("/")[-1]
        cnt = counts.get(slug)
        if cnt == 0 and zero is None:
            zero = (d, nx, bx, hx)
            pgx.locator('[data-testid="home-pick"]').screenshot(path=os.path.join(OUT, "歌曲卡_收藏0.jpg"), type="jpeg", quality=80)
        if cnt and cnt > 0 and more is None:
            more = (d, nx, bx, hx)
            pgx.locator('[data-testid="home-pick"]').screenshot(path=os.path.join(OUT, "歌曲卡_有收藏.jpg"), type="jpeg", quality=80)
        cx.close()
    ok("3e 15 天內每天的第一首不全相同（隔天會換）", len(seen) > 1, f"{len(seen)} 首")
    if zero:
        ok("3f 收藏 0：按鈕「看{藝人}的藝人頁」", zero[2] == f"看{zero[1]}的藝人頁" and zero[3].startswith("/artist/"), f"第 {zero[0]} 天 {zero[2]} → {zero[3]}")
    else:
        ok("3f 收藏 0 的藝人 15 天內沒抽到（歌單裡收藏 0 的藝人數）", False, str(sorted(k for k, v in counts.items() if v == 0)))
    if more:
        ok("3g 收藏 >0：按鈕維持「看其他人…的相關收藏」", more[2] == f"看其他人{more[1]}的相關收藏", f"第 {more[0]} 天 {more[2]}")
    else:
        print("（歌單裡沒有收藏數 >0 的藝人被抽到，3g 略過）", sorted(k for k, v in counts.items() if v > 0))

    # ---------- 4. 截圖與 console ----------
    for path, name in [("/artists", "藝人目錄"), (f"/artist/{NEW_ARTIST}", "新藝人頁"), (f"/artist/{WIKI_ONLY}", "獎項維基藝人頁"), (SERIES, "新系列頁")]:
        for w in (1440, 390):
            ctx = b.new_context(viewport={"width": w, "height": 900}, user_agent=UA)
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: m.type == "error" and errs.append(m.text[:160]))
            pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            pg.goto(BASE + path, wait_until="load", timeout=60000)
            pg.wait_for_timeout(800)
            over = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1")
            ok(f"4 {name} {w} console 0、無橫向溢出", not errs and not over, str(errs)[:200])
            pg.screenshot(path=os.path.join(OUT, f"{name}_{w}.jpg"), type="jpeg", quality=80, full_page=w == 390)
            ctx.close()
    b.close()

fails = [n for n, c in results if not c]
print(f"\n{len(results) - len(fails)}/{len(results)} 通過" + (f"；FAIL：{fails}" if fails else ""))
sys.exit(1 if fails else 0)
