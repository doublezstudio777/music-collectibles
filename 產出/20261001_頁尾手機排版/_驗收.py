"""頁尾手機排版驗收：WebKit／Chromium × 390/375/360/320/1440，量版權文字與連結的右緣、連結點擊高度。
判準：版權文字每一行（最後一行除外）右緣距容器右緣 ≤27px（13px 字兩個字寬，標點禁則與英文單字換行造成的自然參差），修正前 WebKit 每行 55～72px。
用法：python3 _驗收.py [網址，預設 http://127.0.0.1:8791/] [img 子資料夾名，預設 img]"""
import sys, json, os
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8791/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), sys.argv[2] if len(sys.argv) > 2 else "img")
os.makedirs(OUT, exist_ok=True)
JS = """()=>{
 const cc=document.querySelector('.foot-cc'), p=cc.querySelector('p'), cs=getComputedStyle(cc);
 const contR=cc.getBoundingClientRect().right-parseFloat(cs.paddingRight), contL=cc.getBoundingClientRect().left+parseFloat(cs.paddingLeft);
 const r=document.createRange(); r.selectNodeContents(p);
 const lines={}; [...r.getClientRects()].forEach(x=>{if(x.width<1)return;const k=Math.round(x.top);lines[k]=Math.max(lines[k]||0,x.right)});
 const ks=Object.keys(lines).map(Number).sort((a,b)=>a-b);
 const full=ks.slice(0,-1).map(k=>contR-lines[k]);   // 最後一行本來就不滿，不算
 const links=[...document.querySelectorAll('.foot-links a')].map(a=>{const b=a.getBoundingClientRect();const rr=document.createRange();rr.selectNodeContents(a);
   return {t:a.textContent,h:b.height,top:Math.round(b.top),left:b.left,right:b.right,textLines:new Set([...rr.getClientRects()].map(x=>Math.round(x.top))).size}});
 const rows={}; links.forEach(l=>{(rows[l.top]=rows[l.top]||[]).push(l)});
 const row=document.querySelector('.foot-row'), rs=getComputedStyle(row);
 return {ccLines:ks.length, ccGapPerLine:full.map(v=>+v.toFixed(1)), ccMaxGap:full.length?+Math.max(...full).toFixed(1):null,
   pLeft:p.getBoundingClientRect().left, contL, contR, linksLeft:Math.min(...links.map(l=>l.left)),
   linkRows:Object.keys(rows).length, rowRightGap:Object.values(rows).map(rw=>+(contR-Math.max(...rw.map(l=>l.right))).toFixed(1)),
   minLinkH:Math.min(...links.map(l=>l.h)), splitLinks:links.filter(l=>l.textLines>1).map(l=>l.t),
   footH:document.querySelector('footer.foot').getBoundingClientRect().height,
   hscroll:document.documentElement.scrollWidth>innerWidth}
}"""
res = {}
with sync_playwright() as pw:
    for bn in ["webkit", "chromium"]:
        b = getattr(pw, bn).launch()
        for w in [390, 375, 360, 320, 1440]:
            ctx = b.new_context(viewport={"width": w, "height": 900}, device_scale_factor=3 if w < 700 else 1)
            pg = ctx.new_page(); errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.goto(URL, wait_until="load"); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(500)
            m = pg.evaluate(JS); m["consoleErrors"] = errs
            f = os.path.join(OUT, f"{bn}_{w}.jpg")
            pg.locator("footer.foot").screenshot(path=f, type="jpeg", quality=80)
            res[f"{bn}_{w}"] = m; ctx.close()
            ok = (w >= 700 or (m["ccMaxGap"] is not None and m["ccMaxGap"] <= 27 and m["minLinkH"] >= 40 and not m["splitLinks"])) and not m["hscroll"]
            print(("PASS" if ok else "FAIL"), bn, w, json.dumps({k: m[k] for k in ["ccLines","ccMaxGap","linkRows","rowRightGap","minLinkH","splitLinks","footH","hscroll"]}, ensure_ascii=False))
        b.close()
json.dump(res, open(os.path.join(OUT, "量測.json"), "w"), ensure_ascii=False, indent=1)
