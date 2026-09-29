# 新手指南批次：正式站驗收（2026-09-29）。只讀，不送表單、不建任何資料
# 用法：python3 _驗收_正式站.py https://yinzang.dblzm.workers.dev
import json, re, subprocess, sys, time
from pathlib import Path

import requests
from playwright.sync_api import sync_playwright

B = sys.argv[1].rstrip("/")
OUT = Path(__file__).parent
IMG = OUT / "img" / "正式站"
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




def ctx(br, w, h=900, mobile=False, tok=None):
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
    for w, h, mob in ((1440, 900, False), (390, 844, True)):
        c = ctx(br, w, h, mob)
        p = c.new_page()
        cerr = []
        p.on("console", lambda m: m.type == "error" and cerr.append(m.text))
        p.goto(B + "/guide")
        settle(p)
        load_all_images(p)
        got = p.evaluate(GUIDE_TOKENS_JS)
        check(f"P1 {w} /guide 正文與 v3 逐字相同", got[: len(got) - 4] == expect and got[-4:-2] == ["開發中", "更多功能開發中"], len(got))
        if w == 1440:
            lv = p.evaluate("() => [...document.querySelectorAll('[data-testid=guide-levels] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
            check("P2 等級表與 lib/levels.ts 一致", lv == [[TIERS[t]] + [f"{v:,}" for v in LEVELS[t * 5: t * 5 + 5]] for t in range(5)])
            pt = p.evaluate("() => [...document.querySelectorAll('[data-testid=guide-points] tbody tr')].map(r => [...r.children].map(c => c.innerText.trim()))")
            check("P3 得分表與常數一致", pt == POINT_EXPECT)
        imgs = p.evaluate("() => [...document.querySelectorAll('[data-guide-img]')].map(i => ({ k: i.dataset.guideImg, src: i.currentSrc.split('/').pop(), ok: i.complete && i.naturalWidth > 0 }))")
        kind = "mobile" if w == 390 else "desktop"
        pics = {x["k"]: x["src"] for x in imgs}
        check(f"P4 {w} 圖全部載入、等級與得分載入{kind}版", all(x["ok"] for x in imgs) and pics["levels-desktop"].startswith(f"levels-{kind}") and pics["points-desktop"].startswith(f"points-{kind}"), pics)
        o = overflow(p)
        check(f"P5 {w} /guide 無溢出、console error 0", o["sw"] <= o["cw"] and not cerr, (o, cerr))
        shot(p, f"P{w}_新手指南")
        for path in ("/feedback?type=privacy", "/ranking"):
            p.goto(B + path)
            settle(p)
            o = overflow(p)
            check(f"P6 {w} {path} 200、無溢出", o["sw"] <= o["cw"], o)
            shot(p, f"P{w}_{path.strip('/').split('?')[0]}")
        c.close()
    c = ctx(br, 1440)
    p = c.new_page()
    for path, kind in (("/privacy", "privacy"), ("/terms", "takedown")):
        p.goto(B + path)
        settle(p)
        txt = p.inner_text("main")
        p.click("[data-testid=legal-feedback]")
        p.wait_for_url(re.compile(rf"/feedback\?type={kind}$"))
        settle(p)
        check(f"P7 {path} 沒有「待補」、連到 /feedback 預選 {kind}", "待補" not in txt and p.is_checked(f"[data-testid=fb-kind-{kind}]"))
    p.goto(B + "/")
    settle(p)
    tags = p.locator("[data-testid=lv-tag]")
    if tags.count():
        tags.first.click()
        p.wait_for_url(re.compile(r"/guide#levels$"), timeout=15000)
        settle(p)
        top = p.evaluate("() => document.getElementById('levels').getBoundingClientRect().top")
        check("P8 首頁卡片等級標籤 → /guide#levels", 0 <= top < 200, top)
    check("P9 頁尾有新手指南、收藏榮譽榜", p.locator(".foot-links a[href='/guide']").count() == 1 and p.locator(".foot-links a[href='/ranking']").count() == 1)
    br.close()
for path in ("/guide", "/ranking", "/feedback"):
    hs = [requests.get(B + path, timeout=30).headers.get("x-yz-cache", "") for _ in range(2)]
    check(f"P10 {path} 整頁快取（第二次 HIT）", hs[1] == "HIT", hs)
ok = sum(r["ok"] for r in res)
print(f"\n{ok}/{len(res)}")
(OUT / "驗收紀錄_正式站.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
