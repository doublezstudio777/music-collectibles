# 藝人頁頭部手機排版＋在 Spotify 上的熱門歌曲（2026-10-01）。WebKit 3x 390／320、1440；訪客、登入；
# 有照片／沒照片 × 有 Spotify／沒 Spotify 四位藝人。
# 用法：python3 _驗收_藝人頁.py <網址根> <img 子資料夾> [session token]
import asyncio, json, os, sys
from urllib.parse import urlparse
from playwright.async_api import async_playwright
BASE, SUB = sys.argv[1].rstrip("/"), sys.argv[2]
TOKEN = sys.argv[3] if len(sys.argv) > 3 else ""
HERE = os.path.dirname(os.path.abspath(__file__)); IMG = os.path.join(HERE, "img", SUB); os.makedirs(IMG, exist_ok=True)
ARTISTS = [("li-ying-hong", True, False), ("chen-qi-zhen", True, True), ("gordon", False, True), ("a-tt4v", False, False)]
results = []
def check(n, ok, d=""):
    results.append((n, bool(ok), d)); print(("PASS " if ok else "FAIL ") + n + (f"：{d}" if d else ""))
MEASURE = """() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height}; };
  const main = [...document.querySelectorAll('.artist-main-acts > *')].map(e => { const b = e.getBoundingClientRect(); return {w: b.width, h: b.height, t: b.top}; });
  const sub = [...document.querySelectorAll('.artist-sub-acts > *')].map(e => { const b = e.getBoundingClientRect(); return {t: b.top, h: b.height}; });
  const sp = document.querySelector('iframe.artist-sp');
  return {vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, wrap: r('main.wrap'), title: r('.artist-head-text .page-title'),
    fig: r('.artist-photo'), img: r('.artist-photo img'), cap: r('.artist-photo-credit'), main, sub, sp: sp ? {h: sp.getBoundingClientRect().height, w: sp.getBoundingClientRect().width, src: sp.src} : null};
}"""
async def main():
    async with async_playwright() as p:
        b = await p.webkit.launch()
        for login in ([False, True] if TOKEN else [False]):
            for w, h in [(390, 844), (320, 640), (1440, 900)]:
                ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=3 if w < 1000 else 1)
                if login:
                    await ctx.add_cookies([{"name": "yz_session", "value": TOKEN, "domain": urlparse(BASE).hostname, "path": "/", "httpOnly": True, "secure": BASE.startswith("https")}])
                for slug, hasPhoto, hasSp in ARTISTS:
                    tag = f"{'登入' if login else '訪客'} {w} {slug}"
                    pg = await ctx.new_page(); errs = []; bad = []
                    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                    pg.on("response", lambda r: bad.append(r.url) if r.status >= 400 and urlparse(r.url).hostname == urlparse(BASE).hostname else None)
                    await pg.goto(f"{BASE}/artist/{slug}", wait_until="load")
                    await pg.wait_for_timeout(3500)
                    await pg.evaluate("document.fonts.ready")
                    m = await pg.evaluate(MEASURE)
                    check(f"{tag} 無橫向溢出", m["sw"] - m["vw"] <= 0, str(m["sw"] - m["vw"]))
                    mains = m["main"]
                    check(f"{tag} 主要按鈕兩顆等寬等高同一列", len(mains) == 2 and abs(mains[0]["w"] - mains[1]["w"]) < 1 and abs(mains[0]["h"] - mains[1]["h"]) < 1 and abs(mains[0]["t"] - mains[1]["t"]) < 1, str(mains))
                    check(f"{tag} 複製連結、編輯、歷史一列", len(m["sub"]) == 3 and max(x["t"] for x in m["sub"]) - min(x["t"] for x in m["sub"]) < 1, str(m["sub"]))
                    if w < 1000:
                        title = m["title"]
                        check(f"{tag} 主要按鈕撐滿內容寬", title and abs((mains[1]["w"] * 2 + 8) - (m['vw'] - 2 * title['l'])) < 2, f"{mains[1]['w'] if mains else 0}")
                    if hasPhoto and m["fig"]:
                        if w < 1000:
                            check(f"{tag} 照片滿內容寬", abs(m["fig"]["l"] - m["title"]["l"]) < 1 and abs((m["vw"] - m["fig"]["r"]) - m["title"]["l"]) < 1, f"{m['fig']}")
                        check(f"{tag} 說明跟照片同寬", m["cap"] and abs(m["cap"]["w"] - m["fig"]["w"]) < 1)
                    elif hasPhoto:
                        check(f"{tag} 有照片", False, "沒有 .artist-photo")
                    if hasSp:
                        check(f"{tag} Spotify 熱門歌曲 352px", m["sp"] and abs(m["sp"]["h"] - 352) < 1 and "/embed/artist/" in m["sp"]["src"], str(m["sp"]))
                    else:
                        check(f"{tag} 沒有 Spotify ID 不顯示", m["sp"] is None)
                    real = [e for e in errs if "Failed to load resource" not in e] + [u for u in bad if "/img/" not in u]
                    check(f"{tag} console error 0", not real, str(real[:2]))
                    if not login or slug in ("li-ying-hong", "gordon"):
                        await pg.screenshot(path=os.path.join(IMG, f"{w}_{'登入' if login else '訪客'}_{slug}.jpg"), type="jpeg", quality=80, full_page=w < 1000)
                    await pg.close()
                await ctx.close()
        await b.close()
    print(f"\n{sum(r[1] for r in results)}/{len(results)}")
    json.dump([{"項目": n, "通過": o, "說明": d} for n, o, d in results], open(os.path.join(HERE, f"驗收結果_{SUB}.json"), "w"), ensure_ascii=False, indent=1)
asyncio.run(main())
