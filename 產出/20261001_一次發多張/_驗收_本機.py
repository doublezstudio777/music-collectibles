"""一次發多張（我收藏了哪些、批次發文、全家福合集）本機驗收（2026-10-01）。

用法（網站/ 先把正式站備份還原到 DBDIR、套遷移、載入 R2 照片、npm run build，再用同一個 DBDIR 開 wrangler dev 在 8798）：
    DBDIR=<persist-to 資料夾> python3 _驗收_本機.py [http://127.0.0.1:8798]

- 帳號：本機 D1 直接建 bptest（發文者）、bptest2（別的會員）＋session，條款版本 1.0
- 每次跑先刪掉兩個測試帳號的收藏、照片、我有、合集標記、計數，可以重跑
- ①②在 Chromium 1440 走完整流程；③在 WebKit 390（3x、觸控）走，照片上的位置用手指點
- 最後一輪 WebKit 390／320（3x）與 1440 截圖，量橫向溢出；截圖 img/，JPEG 品質 80
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8798"
HERE = Path(__file__).resolve().parent
SITE = HERE.parent.parent / "網站"
OUT = HERE / "img"
OUT.mkdir(exist_ok=True)
DBDIR = os.environ.get("DBDIR", str(SITE / ".wrangler/state"))
IMG = Path(os.environ.get("IMGDIR", "/tmp/bp-img"))
HOST = "127.0.0.1"
DAY = datetime.now(timezone.utc).strftime("%Y-%m-%d")
TOMORROW = (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

USERS = {
    "a": ("u-bptest1001", "bptest", "批次測試甲", "bptest@example.invalid"),
    "b": ("u-bptest1002", "bptest2", "批次測試乙", "bptest2@example.invalid"),
}
TOKENS = {k: f"bptesttoken{k}{'x' * 40}" for k in USERS}
UID = USERS["a"][0]
GROUP_POS = [(0.16875, 0.2530), (0.4, 0.2530), (0.63125, 0.2530), (0.8625, 0.2530)]

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail else ""), flush=True)
    return bool(ok)


def sql(q: str):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
         "--config", "wrangler.local.jsonc", "--persist-to", DBDIR, "--json", "--command", q],
        cwd=SITE, check=True, capture_output=True, text=True,
    )
    return json.loads(r.stdout)[-1]["results"]


def setup():
    ids = ",".join(f"'{u[0]}'" for u in USERS.values())
    old = [r["no"] for r in sql(f"SELECT no FROM shares WHERE author_id IN ({ids})")]
    if old:
        nos = ",".join(map(str, old))
        sql(f"DELETE FROM collection_tags WHERE share_no IN ({nos})")
        sql(f"DELETE FROM likes WHERE share_no IN ({nos})")
        srcs = ",".join("'share:%d'" % n for n in old)
        sql(f"DELETE FROM score_events WHERE source IN ({srcs})")
        sql(f"DELETE FROM shares WHERE no IN ({nos})")
    sql(f"DELETE FROM photos WHERE owner_id IN ({ids})")
    sql(f"DELETE FROM photo_codes WHERE owner_id IN ({ids})")
    sql(f"DELETE FROM holdings WHERE user_id IN ({ids})")
    sql(f"DELETE FROM rate_limits WHERE key LIKE '%bptest100%'")
    for k, (uid, handle, name, email) in USERS.items():
        sql(
            f"INSERT OR IGNORE INTO users (id, email, email_verified_at, password_hash, handle, name, name_key, terms_version, terms_accepted_at) "
            f"VALUES ('{uid}', '{email}', '2026-10-01T00:00:00.000Z', '!test', '{handle}', '{name}', '{name}', '1.0', '2026-10-01T00:00:00.000Z')"
        )
        h = hashlib.sha256(TOKENS[k].encode()).hexdigest()
        sql(f"INSERT OR REPLACE INTO sessions (id, user_id, expires_at) VALUES ('{h}', '{uid}', '2026-12-31T00:00:00.000Z')")


def ctx_for(browser, who, width=1440, height=900, scale=1, mobile=False):
    c = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile)
    cookies = [{"name": "yz_test_country", "value": "TW", "domain": HOST, "path": "/"}]
    if who:
        cookies.append({"name": "yz_session", "value": TOKENS[who], "domain": HOST, "path": "/", "httpOnly": True})
    c.add_cookies(cookies)
    return c


ERRORS: list[str] = []


def page_of(c):
    p = c.new_page()
    p.on(
        "console",
        lambda m: ERRORS.append(f"{p.url} {m.text}")
        if m.type == "error" and "/img/" not in m.text and not re.search(r"status of (401|404|403|409|429)", m.text)
        else None,
    )
    p.on("pageerror", lambda e: ERRORS.append(f"{p.url} pageerror {e}"))
    return p


def go(p, path: str):
    p.goto(BASE + path, wait_until="load")
    p.wait_for_function("document.fonts.ready.then(() => true)")
    try:
        p.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass


def shot(p, name: str, full=False):
    p.screenshot(path=str(OUT / f"{name}.jpg"), type="jpeg", quality=80, full_page=full)


def fetch(p, path: str, method="GET", body=None):
    return p.evaluate(
        """async ([path, method, body]) => {
          const init = { method };
          if (body !== null) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(body); }
          const r = await fetch(path, init);
          let j = {}; try { j = await r.json(); } catch {}
          return { status: r.status, body: j };
        }""",
        [path, method, body],
    )


def overflow(p) -> int:
    return p.evaluate("document.scrollingElement.scrollWidth - window.innerWidth")


def wait_uploads(scope, n: int, timeout=60):
    end = time.time() + timeout
    while time.time() < end:
        if scope.locator('[data-testid="pp-tile"][data-status="done"]').count() >= n:
            return True
        time.sleep(0.5)
    return False


# ---------------------------------------------------------------- ① 我收藏了哪些

def flow1(browser):
    c = ctx_for(browser, "a")
    p = page_of(c)
    go(p, "/artist/jj-lin")
    check("1a 藝人頁有「我收藏了哪些」", p.locator('[data-testid="owned-entry"]').count() == 1)
    p.click('[data-testid="owned-entry"]')
    p.wait_for_url(re.compile(r"/me/owned/jj-lin$"))
    p.locator('[data-testid="pl-chip"][aria-pressed]').first.wait_for()
    series = p.locator('[data-testid="pl-series"]')
    check("1b 列出這位藝人所有系列", series.count() >= 20, f"{series.count()} 個系列")
    picked = []
    # 有版本的前 4 個系列各勾第一個版本（重跑時上一輪新增的空專輯會排在最上面，跳過）
    vser = p.locator('[data-testid="pl-series"]:has([data-testid="pl-chip"]:not(.pick-unsure))')
    for i in range(4):
        chip = vser.nth(i).locator('[data-testid="pl-chip"]:not(.pick-unsure)').first
        with p.expect_response(lambda r: "/api/me/holdings" in r.url):
            chip.click()
        picked.append(chip.get_attribute("data-key"))
    # 新增一張找不到的專輯（會走自動補資料），新增完自動勾成「不確定版本」
    title = f"驗收新增專輯{int(time.time()) % 100000}"
    p.click('[data-testid="pl-add-series"]')
    p.fill('[data-testid="pl-add-series-name"]', title)
    p.locator('[data-testid="pl-add-series-box"] input[aria-label="年份"]').fill("2019")
    with p.expect_response(lambda r: "/api/me/holdings" in r.url, timeout=15000):
        p.click('[data-testid="pl-add-series-save"]')
    new = p.locator('[data-testid="pl-series"]', has_text=title)
    check("1c 這裡沒有，我要新增：新專輯出現在清單、自動勾成不確定版本", new.count() == 1 and new.locator('.pick-unsure[aria-pressed="true"]').count() == 1)
    picked.append(new.get_attribute("data-key"))
    time.sleep(0.5)
    check("1d 已勾數字沒有分母", p.locator('[data-testid="own-count"]').inner_text().strip() == "勾了 5 張", p.locator('[data-testid="own-count"]').inner_text())
    rows = sql(f"SELECT target_key AS k FROM holdings WHERE user_id = '{UID}' AND kind = 'owned'")
    keys = sorted(r["k"] for r in rows)
    check("1e 勾選＝我有（holdings 同一張表）", keys == sorted(picked), str(keys))
    check("1f 不確定版本記在系列層（系列鍵）", any("#" not in k for k in keys))
    sid = sql(f"SELECT id FROM series WHERE title = '{title}'")
    jobs = sql(f"SELECT j.status FROM autofill_jobs j JOIN catalog_additions a ON a.id = j.addition_id WHERE a.type = 'series' AND a.ref = '{sid[0]['id']}'") if sid else []
    check("1g 新增的專輯排進自動補資料", len(jobs) >= 1, str(jobs))
    shot(p, "1_勾選清單_chromium1440", full=False)

    # 取消再勾（點一下存一下）
    chip = vser.nth(0).locator('[data-testid="pl-chip"]:not(.pick-unsure)').first
    with p.expect_response(lambda r: "/api/me/holdings" in r.url):
        chip.click()
    n = sql(f"SELECT count(*) AS n FROM holdings WHERE user_id = '{UID}'")[0]["n"]
    with p.expect_response(lambda r: "/api/me/holdings" in r.url):
        chip.click()
    check("1h 取消勾選會刪掉、再勾回來", n == 4 and sql(f"SELECT count(*) AS n FROM holdings WHERE user_id = '{UID}'")[0]["n"] == 5)

    go(p, "/u/bptest")
    p.locator('[data-testid="owned-group-title"]').first.wait_for()
    t = p.locator('[data-testid="owned-group-title"]').first.inner_text()
    check("1i 個人頁依藝人分組「我收藏的 林俊傑：5 張」", re.fullmatch(r"我收藏的 林俊傑：5 張", t.strip()) is not None, t)
    body = p.locator("#owned").inner_text()
    check("1j 個人頁沒有分母、沒有缺哪幾張、沒有進度條", not re.search(r"\d+\s*[／/]\s*\d+|缺|還差", body) and p.locator('#owned progress, #owned [role="progressbar"]').count() == 0)
    check("1k 不確定版本那列寫「不確定版本」", "不確定版本" in body)
    c.close()
    return picked


# ---------------------------------------------------------------- ② 批次發文

def flow2(browser, picked):
    sql(f"INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES ('share:{UID}:{DAY}', 26, '{TOMORROW}')")
    c = ctx_for(browser, "a")
    p = page_of(c)
    go(p, "/me/owned/jj-lin")
    p.locator('[data-testid="pl-chip"][aria-pressed]').first.wait_for()
    p.click('[data-testid="own-post"]')
    p.wait_for_url(re.compile(r"/share/batch\?keys="))
    p.locator('[data-testid="bp-entry"]').first.wait_for()
    entries = p.locator('[data-testid="bp-entry"]')
    check("2a 勾的 5 張帶進批次發文", entries.count() == 5, str(entries.count()))
    p.locator('[data-testid="bp-quota"]').wait_for()
    check("2b 顯示今天還能發幾則", "還能發 4 則" in p.locator('[data-testid="bp-quota"]').inner_text())
    p.click('[data-testid="bp-trade"] [data-trade="offer"]')
    check("2c 統一設定：全部變開放出價", entries.locator('[data-testid="bp-entry-trade"] [data-trade="offer"][aria-pressed="true"]').count() == 5)
    e2 = entries.nth(1)
    e2.locator('[data-trade="sale"]').click()
    e2.locator(".money input").fill("1200")
    check("2d 第 2 張個別改成定價", e2.locator('[data-trade="sale"][aria-pressed="true"]').count() == 1)
    for i in range(3):
        e = entries.nth(i)
        e.locator('[data-testid="pp-input"]').set_input_files(str(IMG / f"single{i + 1}.jpg"))
        e.locator('[data-testid="bp-story"]').fill(f"批次驗收第 {i + 1} 張")
    check("2e 前 3 張照片上傳完成（浮水印＋查證碼）", wait_uploads(p, 3))
    time.sleep(1.2)
    # 中途離開：換頁再回來（不帶 keys），草稿還在
    go(p, "/")
    go(p, "/share/batch")
    p.locator('[data-testid="bp-entry"]').first.wait_for()
    entries = p.locator('[data-testid="bp-entry"]')
    check("2f 中途離開回來：草稿還在（5 張）", entries.count() == 5 and p.locator('[data-testid="bp-restored"]').count() == 1)
    check("2g 草稿保留照片、說明、個別設定", entries.locator('[data-testid="pp-tile"][data-status="done"]').count() == 3
          and entries.nth(0).locator('[data-testid="bp-story"]').input_value() == "批次驗收第 1 張"
          and entries.nth(1).locator('[data-trade="sale"][aria-pressed="true"]').count() == 1
          and entries.nth(1).locator(".money input").input_value() == "1200")
    for i in (3, 4):
        e = entries.nth(i)
        e.locator('[data-testid="pp-input"]').set_input_files(str(IMG / f"single{i + 1}.jpg"))
        e.locator('[data-testid="bp-story"]').fill(f"批次驗收第 {i + 1} 張")
    check("2h 5 張照片都上傳完成", wait_uploads(p, 5))
    time.sleep(0.8)
    over = p.locator('[data-testid="bp-over"]')
    check("2i 發布前就標出超過上限的那一張（第 5 張）", over.count() == 1 and entries.nth(4).locator('[data-testid="bp-over"]').count() == 1, over.first.inner_text() if over.count() else "")
    check("2j 發布列寫可以發 4 則、1 則發不了", "可以發 4 則" in p.locator('[data-testid="bp-sum"]').inner_text() and "1 則超過今天的上限" in p.locator('[data-testid="bp-sum-missing"]').inner_text())
    check("2k 發布前看得到 CC 授權提示", "CC BY-NC-ND 4.0" in p.locator('[data-testid="bp-license"]').inner_text())
    shot(p, "2_批次發文_發布前_chromium1440", full=True)
    p.click('[data-testid="bp-submit"]')
    p.locator('[data-testid="bp-results"]').wait_for(timeout=90000)
    ok = p.locator('[data-testid="bp-ok"] li')
    bad = p.locator('[data-testid="bp-bad"] li')
    check("2l 發好 4 則", ok.count() == 4, str(ok.count()))
    check("2m 清楚列出哪一張這次發不了", bad.count() == 1 and "上限" in bad.first.inner_text(), bad.first.inner_text() if bad.count() else "")
    shot(p, "2_批次發文_結果_chromium1440", full=True)
    rows = sql(f"SELECT s.no, s.sale_state, s.price, s.story, s.series_key, s.item_id, s.version_id, (SELECT count(*) FROM photos ph WHERE ph.share_no = s.no AND ph.verify_code IS NOT NULL AND ph.orig_key IS NOT NULL) AS ph FROM shares s WHERE s.author_id = '{UID}' ORDER BY s.no")
    check("2n 產生 4 則獨立的收藏", len(rows) == 4, str(len(rows)))
    check("2o 每則照片都有查證碼與不公開原圖（浮水印照現行流程燒）", all(r["ph"] == 1 for r in rows))
    states = [(r["sale_state"], r["price"]) for r in rows]
    check("2p 交易狀態：統一開放出價、第 2 張定價 1200", states == [("offer", None), ("sale", 1200), ("offer", None), ("offer", None)], str(states))
    # 版本鍵的掛到版本；新增專輯那張是「不確定版本」（系列層），掛系列、品項自動建、不掛版本
    linked = [(r["series_key"], r["item_id"], r["version_id"]) for r in rows]
    want = {}
    for k in picked:
        sk, _, anchor = k.partition("#")
        want[sk] = tuple(anchor.split("-")) if anchor else ("cd", None)
    check("2q 掛到選好的系列／版本", all(want.get(sk) == (it, v) for sk, it, v in linked), str(linked))
    draft = p.evaluate("JSON.parse(localStorage.getItem('yz_batch:bptest') || 'null')")
    check("2r 發不了的那張留在草稿", draft is not None and len(draft["rows"]) == 1)
    go(p, f"/share/{rows[0]['no']}")
    check("2s 發好的收藏頁有查證碼", p.locator('[data-testid="photo-code"]').count() == 1)
    c.close()
    return [r["no"] for r in rows]


# ---------------------------------------------------------------- ③ 全家福合集（WebKit 390、觸控）

def flow3(webkit, chromium):
    sql(f"DELETE FROM rate_limits WHERE key = 'share:{UID}:{DAY}'")
    c = ctx_for(webkit, "a", 390, 844, 3, True)
    p = page_of(c)
    go(p, "/share/new")
    check("3a 炫收藏頁有「發合集」入口", p.locator('[data-testid="to-collection"]').count() == 1)
    go(p, "/share/collection")
    p.locator('[data-testid="pp-input"]').set_input_files(str(IMG / "group.jpg"))
    check("3b 大合照上傳完成", wait_uploads(p, 1, 90))
    tagged = []

    def pick_artist(q, slug):
        p.fill('[data-testid="cf-artist-search"]', q)
        p.locator(f'[data-testid="cf-artist-hit"][data-slug="{slug}"]').click()
        p.locator('[data-testid="cf-pick-list"] [data-testid="pl-series"]').first.wait_for()

    pick_artist("Hyukoh", "hyukoh")
    chips = p.locator('[data-testid="cf-pick-list"] [data-testid="pl-chip"]')
    for i in (0, 2, 3):
        chips.nth(i).tap()
        tagged.append(chips.nth(i).get_attribute("data-key"))
    unsure = p.locator('[data-testid="cf-pick-list"] .pick-unsure').first
    unsure.tap()
    tagged.append(unsure.get_attribute("data-key"))
    pick_artist("林俊傑", "jj-lin")
    sers = p.locator('[data-testid="cf-pick-list"] [data-testid="pl-series"]:has([data-testid="pl-chip"]:not(.pick-unsure))')
    for i in (4, 5, 6):
        ch = sers.nth(i).locator('[data-testid="pl-chip"]:not(.pick-unsure)').first
        ch.tap()
        tagged.append(ch.get_attribute("data-key"))
    un = sers.nth(7).locator(".pick-unsure").first
    un.tap()
    tagged.append(un.get_attribute("data-key"))
    tags = p.locator('[data-testid="cf-tag"]')
    check("3c 標記 8 張、跨 2 位藝人", tags.count() == 8 and len({k.split("/")[0] for k in tagged}) == 2, f"{tags.count()} 張")
    # 照片上點位置（手指點）：前 4 張
    for i in range(4):
        tags.nth(i).locator('[data-testid="cf-tag-place"]').tap()
        p.locator('[data-testid="cf-placing"]').wait_for()
        img = p.locator('[data-testid="cf-stage"] [data-testid="cphoto"]').first
        img.scroll_into_view_if_needed()
        box = img.bounding_box()
        x, y = GROUP_POS[i]
        p.touchscreen.tap(box["x"] + box["width"] * x, box["y"] + box["height"] * y)
        time.sleep(0.2)
    pins = p.locator('[data-testid="cf-stage"] [data-testid="cpin"]')
    check("3d 手機上點照片標位置：4 個號碼標在照片上", pins.count() == 4, str(pins.count()))
    pin1 = pins.first.bounding_box()
    img = p.locator('[data-testid="cf-stage"] [data-testid="cphoto"]').first.bounding_box()
    cx = (pin1["x"] + pin1["width"] / 2 - img["x"]) / img["width"]
    check("3e 號碼落在點的位置（誤差 <2%）", abs(cx - GROUP_POS[0][0]) < 0.02, f"{cx:.3f}")
    p.fill('[data-testid="cf-story"]', "全家福驗收：林俊傑跟 Hyukoh 擺在一起拍")
    check("3f 標題自動組", "合集 8 張" in p.locator('[data-testid="cf-sum-title"]').inner_text(), p.locator('[data-testid="cf-sum-title"]').inner_text())
    check("3g 發布前看得到 CC 授權提示", "CC BY-NC-ND 4.0" in p.locator('[data-testid="cf-license"]').inner_text())
    p.locator('[data-testid="cf-stage"]').scroll_into_view_if_needed()
    shot(p, "3_合集表單_標記_webkit390")
    shot(p, "3_合集表單_全頁_webkit390", full=True)
    p.locator('[data-testid="cf-submit"]').tap()
    p.wait_for_url(re.compile(r"/share/\d+$"), timeout=60000)
    n = int(p.url.rsplit("/", 1)[1])
    p.locator('[data-testid="ctag"]').first.wait_for()
    check("3h 合集頁列出 8 張專輯", p.locator('[data-testid="ctag"]').count() == 8)
    check("3i 照片上 4 個號碼", p.locator('[data-testid="cpin"]').count() == 4)
    hrefs = p.locator('[data-testid="ctag"] a').evaluate_all("as => as.map(a => a.getAttribute('href'))")
    check("3j 每張都連到專輯頁", len(hrefs) == 8 and all(h.startswith("/artist/") for h in hrefs), str(hrefs[:3]))
    check("3k 合集純展示：沒有出價／定價區", p.locator(".deal, .offer-form, .seller-bar, #offers-title").count() == 0)
    check("3l 有查證碼", p.locator('[data-testid="photo-code"]').count() == 1)
    check("3m 標題自動組「Hyukoh、林俊傑・合集 8 張」", p.locator("h1.page-title").inner_text().strip() == "Hyukoh、林俊傑・合集 8 張", p.locator("h1.page-title").inner_text())
    head = p.evaluate("document.head.innerHTML")
    title = p.title()
    desc = re.search(r'<meta name="description" content="([^"]*)"', head)
    check("3n 合集頁 title 自動產生（在 head）", "收藏合集 8 張" in title, title)
    check("3o 合集頁 description 自動產生", bool(desc) and "收藏合照，裡面有" in desc.group(1), desc.group(1) if desc else "")
    canon = re.search(r'<link rel="canonical" href="([^"]+)"', head)
    check("3p canonical 是正式網域", bool(canon) and canon.group(1) == f"https://lemibox.com/share/{n}", canon.group(1) if canon else "")
    # 點號碼 → 清單那一列反白
    p.locator('[data-testid="cpin"]').nth(1).tap()
    check("3q 點照片上的號碼，清單那列反白", p.locator('[data-testid="ctag"].is-on').count() == 1)
    shot(p, "3_合集頁_webkit390")
    shot(p, "3_合集頁_全頁_webkit390", full=True)
    r = fetch(p, f"/api/shares/{n}", "PATCH", {"state": "offer"})
    check("3r 合集不能改成開放出價（API 409）", r["status"] == 409 and r["body"].get("error", {}).get("code") == "COLLECTION", str(r))
    r = fetch(p, f"/api/shares/{n}/offers", "POST", {"kind": "offer", "price": 100})
    check("3s 別人也不能對合集出價", r["status"] in (403, 409), str(r["status"]))
    # 合集 → 一鍵登記成我有
    before = sql(f"SELECT count(*) AS n FROM holdings WHERE user_id = '{UID}'")[0]["n"]
    p.locator('[data-testid="collection-own-all"]').tap()
    p.locator('[data-testid="collection-msg"]').wait_for()
    keys = {r["k"] for r in sql(f"SELECT target_key AS k FROM holdings WHERE user_id = '{UID}' AND kind = 'owned'")}
    check("3t 合集一鍵登記成我有（8 張都進 holdings）", set(tagged) <= keys, p.locator('[data-testid="collection-msg"]').inner_text())
    check("3u 登記後按鈕變「都已登記成我有」", "都已登記" in p.locator('[data-testid="collection-own-all"]').inner_text())
    # 合集 → 挑幾張單獨發文
    p.locator('[data-testid="collection-pick"]').tap()
    checks = p.locator('[data-testid="ctag-check"]')
    checks.nth(0).tap()
    checks.nth(5).tap()
    shot(p, "3_合集頁_挑幾張單獨發文_webkit390")
    p.locator('[data-testid="collection-post-picked"]').tap()
    p.wait_for_url(re.compile(r"/share/batch\?keys=.*&from=\d+"))
    p.locator('[data-testid="bp-entry"]').first.wait_for()
    got = p.locator('[data-testid="bp-entry"]').evaluate_all("es => es.map(e => e.dataset.key)")
    check("3v 挑的 2 張帶進批次發文（專輯已選好）", tagged[0] in got and tagged[5] in got, str(got))
    shot(p, "3_合集轉單獨發文_webkit390")
    c.close()

    # 其他頁面上的合集：首頁卡片、系列頁、個人頁（chromium）
    c = ctx_for(chromium, None)
    q = page_of(c)
    go(q, "/?sort=new")
    card = q.locator('article.card[data-post="collection"]').first
    check("3w 首頁卡片顯示合集（狀態槽「合集 8 張」）", card.count() == 1 and card.locator('[data-testid="slot-collection"]').inner_text().replace("\n", " ").strip() == "合集 8 張")
    go(q, "/artist/hyukoh/1")
    check("3x 被標記的專輯頁「出現在 1 個合集中」", "出現在 1 個合集中" in q.locator('[data-testid="series-collections-count"]').inner_text())
    check("3y 專輯頁連回合集", q.locator(f'[data-testid="series-collections"] a[href="/share/{n}"]').count() >= 1)
    check("3z 版本也標「出現在 N 個合集中」", q.locator('[data-testid="ver-collections"]').count() >= 3)
    go(q, f"/share/{n}")
    img_src = q.locator('[data-testid="cphoto"] img').first.get_attribute("src")
    check("3A 訪客看縮圖（大圖要登入）", "_t." in img_src, img_src)
    check("3B 訪客沒有發文者操作", q.locator('[data-testid="collection-owner"]').count() == 0)
    check("3C 有檢舉入口", q.locator('[data-testid="question-open"]').count() == 1)
    c.close()
    c = ctx_for(chromium, "b")
    q = page_of(c)
    go(q, f"/share/{n}")
    q.locator('[data-testid="dm-share"]').wait_for()
    check("3D 別的會員：可以私訊、沒有發文者操作", q.locator('[data-testid="collection-owner"]').count() == 0)
    go(q, "/u/bptest")
    check("3E 個人頁炫收藏牆有合集卡片", q.locator('article.card[data-post="collection"]').count() == 1)
    c.close()
    # 編輯合集：改說明、拿掉一個標記
    c = ctx_for(chromium, "a")
    q = page_of(c)
    go(q, f"/share/{n}/edit")
    q.locator('[data-testid="cf-tag"]').first.wait_for()
    check("3F 編輯頁讀回 8 個標記、4 個位置", q.locator('[data-testid="cf-tag"]').count() == 8 and q.locator('[data-testid="cf-stage"] [data-testid="cpin"]').count() == 4)
    q.fill('[data-testid="cf-story"]', "全家福驗收（改過）")
    q.click('[data-testid="cf-submit"]')
    q.wait_for_url(re.compile(rf"/share/{n}$"))
    q.locator('[data-testid="ctag"]').first.wait_for()
    check("3G 編輯後說明更新、標記不變", "改過" in q.locator(".detail-info .prose").inner_text() and q.locator('[data-testid="ctag"]').count() == 8)
    c.close()
    return n


# ---------------------------------------------------------------- 截圖與版面（WebKit 390／320 3x、1440）

def shots(webkit, coll_n, share_nos):
    sql(f"INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES ('share:{UID}:{DAY}', 30, '{TOMORROW}')")
    pages = [
        ("藝人頁入口", "/artist/jj-lin"),
        ("我收藏了哪些", "/me/owned/jj-lin"),
        ("個人頁我有", "/u/bptest#owned"),
        ("批次發文", "/share/batch?keys=" + "%2C".join(["hyukoh%2F1%23cd-v3", "jj-lin%2F21%23cd-v1", "jj-lin%2F20"])),
        ("合集發文", "/share/collection?artist=hyukoh"),
        ("合集頁", f"/share/{coll_n}"),
        ("首頁卡片", "/?sort=new"),
        ("專輯頁合集內連", "/artist/hyukoh/1#collections"),
    ]
    for w, scale in ((390, 3), (320, 3), (1440, 1)):
        c = ctx_for(webkit, "a", w, 900 if w == 1440 else 780, scale, w < 1000)
        p = page_of(c)
        for name, path in pages:
            go(p, path)
            time.sleep(1.0)
            if "#" in path:
                p.evaluate(f"document.getElementById('{path.split('#')[1]}')?.scrollIntoView(); window.scrollBy(0, -80)")
                time.sleep(0.3)
            ov = overflow(p)
            if w == 320 and name == "專輯頁合集內連":
                # hyukoh/1 在 320 寬本來就溢出 41px（黑膠單一版本規格清單，正式站改版前同頁實測 41px，00_現況已記），這次不動
                check(f"4 {w} {name} 沒有新增溢出（改版前正式站同頁 41px）", ov <= 41, f"{ov}px")
            else:
                check(f"4 {w} {name} 沒有橫向溢出", ov <= 0, f"{ov}px")
            shot(p, f"4_{name}_webkit{w}")
        c.close()


def main():
    setup()
    with sync_playwright() as pw:
        chromium = pw.chromium.launch()
        webkit = pw.webkit.launch()
        picked = flow1(chromium)
        nos = flow2(chromium, picked)
        coll = flow3(webkit, chromium)
        shots(webkit, coll, nos)
        chromium.close()
        webkit.close()
    check("5 console error 0", not ERRORS, "\n".join(ERRORS[:8]))
    passed = sum(1 for r in results if r[1])
    print(f"\n{passed}/{len(results)} PASS")
    (HERE / "result_本機.json").write_text(json.dumps({"base": BASE, "passed": passed, "total": len(results), "results": results, "errors": ERRORS, "collection": coll, "shares": nos}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
