# Spotify 熱門歌曲區塊移進藝人頭部（2026-10-03）：WebKit 390／320（3x）、1440 截整頁，量區塊位置。
# 用法：python3 _驗收_區塊位置.py <網址根> <img 子資料夾> <slug:有沒有ID,...> [--heights 152,352]
#   有 ID 的藝人要能看到 .artist-spotify 且排在「系列」之前、頭部之內；沒 ID 的不能有這個區塊、也不能留空位
import asyncio, json, os, sys
from playwright.async_api import async_playwright
BASE, SUB = sys.argv[1].rstrip("/"), sys.argv[2]
ARTISTS = [(x.split(":")[0], x.split(":")[1] == "1") for x in sys.argv[3].split(",")]
SHOTS_ONLY = "--shots-only" in sys.argv  # 改前對照：只截圖不驗
HEIGHTS = [int(h) for h in sys.argv[sys.argv.index("--heights") + 1].split(",")] if "--heights" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__)); IMG = os.path.join(HERE, "img", SUB); os.makedirs(IMG, exist_ok=True)
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
results = []
def check(n, ok, d=""):
    results.append((n, bool(ok), d)); print(("PASS " if ok else "FAIL ") + n + (f"：{d}" if d else ""))
MEASURE = """() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {l: Math.round(b.left*10)/10, r: Math.round(b.right*10)/10, t: Math.round(b.top+scrollY), b: Math.round(b.bottom+scrollY), w: Math.round(b.width*10)/10, h: Math.round(b.height*10)/10}; };
  const series = [...document.querySelectorAll('h2.block-title')].find(h => h.textContent.trim() === '系列');
  const sb = series ? series.getBoundingClientRect() : null;
  const sp = document.querySelector('[data-testid=artist-spotify]');
  const ifr = document.querySelector('iframe.artist-sp');
  const head = document.querySelector('.artist-head');
  const inHead = sp ? head.contains(sp) : null;
  const firstBlock = document.querySelector('main > .block');
  return {vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
    head: r('.artist-head'), photo: r('.artist-photo') || r('.artist-photo-ph'), text: r('.artist-head-text'), submit: r('.artist-submit-row'),
    sp: r('[data-testid=artist-spotify]'), title: r('.artist-sp-title'), ifr: r('iframe.artist-sp'), inHead,
    spTitle: document.querySelector('.artist-sp-title') ? document.querySelector('.artist-sp-title').textContent.trim() : null,
    seriesTop: sb ? Math.round(sb.top + scrollY) : null, firstBlockTop: firstBlock ? Math.round(firstBlock.getBoundingClientRect().top + scrollY) : null,
    docH: document.documentElement.scrollHeight};
}"""
async def main():
    out = {}
    async with async_playwright() as p:
        b = await p.webkit.launch()
        for w, h in [(390, 844), (320, 640), (1440, 900)]:
            mobile = w < 1000
            ctx = await b.new_context(viewport={"width": w, "height": h}, device_scale_factor=3 if mobile else 1, is_mobile=mobile, has_touch=mobile, user_agent=UA if mobile else None)
            for slug, hasSp in ARTISTS:
                tag = f"{w} {slug}"
                pg = await ctx.new_page(); errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                await pg.goto(f"{BASE}/artist/{slug}", wait_until="load"); await pg.wait_for_timeout(4000)
                await pg.evaluate("document.fonts.ready")
                m = await pg.evaluate(MEASURE); out[tag] = m
                check(f"{tag} 無橫向溢出", m["sw"] - m["vw"] <= 0, str(m["sw"] - m["vw"]))
                if SHOTS_ONLY:
                    pass
                elif hasSp:
                    check(f"{tag} 有 Spotify 區塊且在頭部之內", m["sp"] and m["inHead"], json.dumps(m["sp"]))
                    check(f"{tag} 標題「Spotify 熱門歌曲」＋「由 Spotify 提供」", m["spTitle"] and m["spTitle"].startswith("Spotify 熱門歌曲") and "由 Spotify 提供" in m["spTitle"], str(m["spTitle"]))
                    check(f"{tag} 區塊排在「系列」之前", m["sp"] and (m["seriesTop"] is None or m["sp"]["b"] <= m["seriesTop"]), f"區塊底 {m['sp'] and m['sp']['b']}、系列標題頂 {m['seriesTop']}")
                    if mobile:
                        check(f"{tag} 手機區塊整寬、在照片＋資訊之下", m["sp"] and m["photo"] and m["sp"]["t"] >= m["photo"]["b"] and abs(m["sp"]["l"] - m["head"]["l"]) < 1 and abs(m["sp"]["r"] - m["head"]["r"]) < 1, f"sp {m['sp']}、photo {m['photo']}")
                        check(f"{tag} 手機播放器 352px", m["ifr"] and abs(m["ifr"]["h"] - 352) < 1, str(m["ifr"]))
                    else:
                        check(f"{tag} 桌機第三欄：跟照片同一列、頂對齊、在文字右邊", m["sp"] and m["photo"] and abs(m["sp"]["t"] - m["photo"]["t"]) < 1 and m["sp"]["b"] <= m["head"]["b"] + 1 and m["sp"]["l"] > m["text"]["r"], f"sp {m['sp']}、photo {m['photo']}、text {m['text']}")
                        check(f"{tag} 桌機播放器 152px", m["ifr"] and abs(m["ifr"]["h"] - 152) < 1, str(m["ifr"]))
                        check(f"{tag} 桌機系列標題仍在第一屏（900）內", m["seriesTop"] is None or m["seriesTop"] < 900, str(m["seriesTop"]))
                else:
                    check(f"{tag} 沒 ID：沒有 Spotify 區塊", m["sp"] is None and m["ifr"] is None)
                    check(f"{tag} 沒 ID：頭部不留空位（頭部底＝照片底或文字底）", m["head"] and m["head"]["b"] - max(m["photo"]["b"] if m["photo"] else 0, m["text"]["b"], (m["submit"] or {"b": 0})["b"]) <= 1, f"head {m['head']}、photo {m['photo']}、text {m['text']}、submit {m['submit']}")
                if not SHOTS_ONLY: check(f"{tag} 無 console error", not [e for e in errs if "spotify" not in e.lower() and "favicon" not in e.lower()], "；".join(errs[:3]))
                # 只截頁面上半（頭部到「系列」前幾列），3x 整頁會超過 32767px
                await pg.screenshot(path=os.path.join(IMG, f"{w}_{slug}.jpg"), type="jpeg", quality=80, full_page=True, clip={"x": 0, "y": 0, "width": w, "height": min(m["docH"], 2200 if mobile else 1400)})
                if mobile and hasSp and HEIGHTS:
                    for hh in HEIGHTS:
                        await pg.add_style_tag(content=f".artist-head .artist-sp{{height:{hh}px !important}}"); await pg.wait_for_timeout(2500)
                        await pg.screenshot(path=os.path.join(IMG, f"{w}_{slug}_播放器{hh}.jpg"), type="jpeg", quality=80, clip={"x": 0, "y": 0, "width": w, "height": h})
                await pg.close()
            await ctx.close()
        await b.close()
    json.dump({"base": BASE, "results": results, "measure": out}, open(os.path.join(HERE, f"驗收結果_{SUB}.json"), "w"), ensure_ascii=False, indent=1)
    print(f"\n{sum(1 for r in results if r[1])}/{len(results)} 通過")
asyncio.run(main())
