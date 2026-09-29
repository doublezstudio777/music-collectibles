# 操作示意截圖：公開頁取正式站（訪客），需登入的畫面取本機（測試帳號 r01@demo.yinzang.test）
# 用法：python3 capture.py [本機網址，預設 http://127.0.0.1:8791]
# 2026-09-29 實際是用 git archive HEAD 在暫存區另建一份、複製 D1 狀態，起在 8793 截的（8791 當時資產 404）
import json, sys
from playwright.sync_api import sync_playwright
PROD = "https://yinzang.dblzm.workers.dev"
LOCAL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
W = 390
meta = {}

def rect(pg, sel):
    return pg.eval_on_selector(sel, "e=>{const r=e.getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,w:r.width,h:r.height}}")

def shot(pg, name, top, bottom, targets, src, full=True):
    """targets: [(編號, 動作名稱, selector)]；座標換成裁切區內的 CSS px"""
    clip = {"x": 0, "y": top, "width": W, "height": bottom - top}
    pg.screenshot(path=f"shots/{name}.png", clip=clip, full_page=full)
    t = []
    for n, label, sel in targets:
        r = rect(pg, sel)
        if not full:
            r["y"] -= pg.evaluate("scrollY")
        t.append({"n": n, "label": label, "x": r["x"], "y": r["y"] - top, "w": r["w"], "h": r["h"]})
    meta[name] = {"w": W, "h": bottom - top, "src": src, "url": pg.url, "targets": t}

def settle(pg):
    pg.wait_for_load_state("networkidle")
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.launch()
    # 正式站，訪客
    pc = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=4, user_agent=UA)
    pg = pc.new_page()
    pg.goto(PROD + "/"); settle(pg)
    shot(pg, "發布_1", 0, 57, [(1, "炫收藏", ":is(a,button):text-is('炫收藏')")], "正式站")
    pg.goto(PROD + "/artist/gordon"); settle(pg)
    e = rect(pg, "[data-testid=edit-link]")
    shot(pg, "編輯_1", 60, e["y"] + e["h"] + 24, [(1, "編輯", "[data-testid=edit-link]")], "正式站")
    pg.goto(PROD + "/share/3"); settle(pg)
    q = rect(pg, "[data-testid=question-open]")
    shot(pg, "回報_1", q["y"] - 150, q["y"] + q["h"] + 40, [(1, "對這則收藏有疑問嗎？", "[data-testid=question-open]")], "正式站")
    pc.close()

    # 本機，測試帳號
    lc = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=4)
    r = lc.request.post(LOCAL + "/api/auth/login", data={"email": "r01@demo.yinzang.test", "password": "yinzang-demo", "turnstileToken": "XXXX.DUMMY.TOKEN.XXXX"})
    assert r.ok, r.text()
    pg = lc.new_page()
    pg.goto(LOCAL + "/share/new"); settle(pg)
    a = rect(pg, "[data-testid=artist-search]")
    shot(pg, "發布_2", 125, a["y"] + a["h"] + 8,
         [(2, "加照片", ".drop-text >> xpath=.."), (3, "選藝人", "[data-testid=artist-search]")], "本機")
    k = rect(pg, "[data-testid=pick-kind]")
    shot(pg, "發布_3", k["y"] - 50, k["y"] + k["h"] + 24, [(4, "選品項", "[data-testid=pick-kind]")], "本機")
    s = rect(pg, "[data-testid=sf-summary]")
    shot(pg, "發布_4", s["y"] - pg.evaluate("scrollY"), 844, [(5, "發布", "[data-testid=share-submit]")], "本機", full=False)

    pg.goto(LOCAL + "/artist/gordon?edit=1#intro"); settle(pg)
    ta = rect(pg, "#intro textarea")
    sv = rect(pg, "#intro button:has-text('儲存')")
    lab = rect(pg, "#intro label")
    pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(300)
    shot(pg, "編輯_2", lab["y"] - 16, sv["y"] + sv["h"] + 20,
         [(2, "修改", "#intro textarea"), (3, "儲存", "#intro button:has-text('儲存')")], "本機")

    pg.goto(LOCAL + "/share/3"); settle(pg)
    pg.click("[data-testid=question-open]"); pg.wait_for_timeout(700)
    pg.check("input[type=radio] >> nth=1"); pg.wait_for_timeout(200)
    # 對話框內容捲到底，讓送出鈕下方的留白露出來
    pg.evaluate("""() => { for (const e of document.querySelectorAll('[data-testid=question-dialog], [data-testid=question-dialog] *'))
        if (e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible') e.scrollTop = e.scrollHeight; }""")
    pg.wait_for_timeout(200)
    d = rect(pg, "[data-testid=question-dialog]")
    top = d["y"] - pg.evaluate("scrollY")
    shot(pg, "回報_2", top, 844,
         [(2, "選原因", "[data-testid=question-dialog] fieldset"), (3, "送出", "[data-testid=question-dialog] button:has-text('送出')")], "本機", full=False)
    lc.close(); b.close()
json.dump(meta, open("shots/shots.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: [(t['n'], round(t['y']), round(t['h'])) for t in v['targets']] + [v['h']] for k, v in meta.items()}, ensure_ascii=False))
