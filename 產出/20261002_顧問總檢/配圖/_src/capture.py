# 新手指南操作示意重截（2026-10-02 設計總檢建議 15）：全部用現行介面，從本機（fix/ux worktree、正式站備份還原）截。
# 用法：python3 capture.py [本機網址，預設 http://127.0.0.1:8873]
# 帳號：本機 D1 的 uxa（已驗證），直接帶 session cookie（跟 _修正驗收_本機.py 同一套）
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

LOCAL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8873"
HOST = "127.0.0.1"
TOKEN = f"uxtokenuxa{'x' * 40}"
W = 390
meta = {}
Path("shots").mkdir(exist_ok=True)


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
    try:
        pg.wait_for_load_state("networkidle", timeout=6000)
    except Exception:
        pass
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(700)


with sync_playwright() as p:
    b = p.webkit.launch()
    # 訪客
    pc = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=4, is_mobile=True, has_touch=True)
    pc.add_cookies([{"name": "yz_test_country", "value": "TW", "domain": HOST, "path": "/"}])
    pg = pc.new_page()
    pg.goto(LOCAL + "/"); settle(pg)
    pg.evaluate("localStorage.setItem('lmb_terms_notice_1.1', '1')")  # 公告條不入鏡
    pg.goto(LOCAL + "/"); settle(pg)
    shot(pg, "發布_1", 0, 57, [(1, "炫收藏", "a.nav-share")], "本機")
    pg.goto(LOCAL + "/artist/gordon"); settle(pg)
    e = rect(pg, "[data-testid=edit-link]")
    shot(pg, "編輯_1", 60, e["y"] + e["h"] + 24, [(1, "編輯", "[data-testid=edit-link]")], "本機")
    pg.goto(LOCAL + "/share/3"); settle(pg)
    q = rect(pg, "[data-testid=question-open]")
    shot(pg, "回報_1", q["y"] - 150, q["y"] + q["h"] + 40, [(1, "對這則收藏有疑問嗎？", "[data-testid=question-open]")], "本機")
    pc.close()

    # 已登入（uxa）
    lc = b.new_context(viewport={"width": W, "height": 844}, device_scale_factor=4, is_mobile=True, has_touch=True)
    lc.add_cookies([
        {"name": "yz_test_country", "value": "TW", "domain": HOST, "path": "/"},
        {"name": "yz_session", "value": TOKEN, "domain": HOST, "path": "/", "httpOnly": True},
    ])
    pg = lc.new_page()
    pg.goto(LOCAL + "/share/new"); settle(pg)
    pg.evaluate("localStorage.setItem('lmb_terms_notice_1.1', '1')")
    a = rect(pg, "[data-testid=artist-search]")
    shot(pg, "發布_2", 125, a["y"] + a["h"] + 8,
         [(2, "加照片", ".drop-text >> xpath=.."), (3, "選藝人", "[data-testid=artist-search]")], "本機")
    k = rect(pg, "[data-testid=pick-kind]")
    # 黏底列是 fixed，整頁截圖會畫在裁切區頂端擋住標題；這一張先藏起來
    pg.evaluate("document.querySelector('[data-testid=sf-summary]').style.display = 'none'")
    shot(pg, "發布_3", k["y"] - 50, k["y"] + k["h"] + 24, [(4, "選品項", "[data-testid=pick-kind]")], "本機")
    pg.evaluate("document.querySelector('[data-testid=sf-summary]').style.display = ''")
    s = rect(pg, "[data-testid=sf-summary]")
    shot(pg, "發布_4", s["y"] - pg.evaluate("scrollY"), 844, [(5, "發布", "[data-testid=share-submit]")], "本機", full=False)

    pg.goto(LOCAL + "/artist/gordon?edit=1#intro"); settle(pg)
    sv = rect(pg, "#intro button:has-text('儲存')")
    lab = rect(pg, "#intro label")
    pg.evaluate("window.scrollTo(0, 0)"); pg.wait_for_timeout(300)
    shot(pg, "編輯_2", lab["y"] - 16, sv["y"] + sv["h"] + 20,
         [(2, "修改", "#intro textarea"), (3, "儲存", "#intro button:has-text('儲存')")], "本機")

    pg.goto(LOCAL + "/share/3"); settle(pg)
    pg.click("[data-testid=question-open]"); pg.wait_for_timeout(700)
    pg.check("input[type=radio] >> nth=1"); pg.wait_for_timeout(200)
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
