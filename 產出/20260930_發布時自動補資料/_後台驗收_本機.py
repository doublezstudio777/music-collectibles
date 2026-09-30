import json, re, subprocess, sys, time
from playwright.sync_api import sync_playwright
SP = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/3150e145-987c-412f-afbb-557eaa4fa1f8/scratchpad/af"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8792"
TOK = open(f"{SP}/admintoken").read().strip()
res = []
def check(name, ok, extra=""):
    res.append((name, bool(ok))); print(("PASS" if ok else "FAIL"), name, extra)
def q(sql):
    out = subprocess.run([f"{SP}/q.sh", sql], capture_output=True, text=True).stdout
    import ast
    return [ast.literal_eval(l) for l in out.splitlines() if l.strip()]
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for w, h, tag in [(1440, 900, "desktop"), (390, 844, "mobile")]:
        ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        ctx.add_cookies([{"name": "yz_session", "value": TOK, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        p = ctx.new_page(); errs = []
        p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        p.goto(BASE + "/admin/additions", wait_until="load")
        p.wait_for_selector("[data-testid=af]", timeout=20000)
        n = p.locator("[data-testid=af]").count()
        check(f"{tag} 待確認頁有自動補資料區塊", n >= 12, f"{n} 個")
        badges = p.locator("[data-testid=af-badge]").all_inner_texts()
        check(f"{tag} 四種信心都有顯示", all(any(k in b for b in badges) for k in ["高信心", "低信心", "未查到", "重複"]), str(sorted(set(badges))))
        sw = p.evaluate("document.documentElement.scrollWidth")
        check(f"{tag} 沒有橫向溢出", sw <= w, f"scrollWidth {sw}")
        p.screenshot(path=f"{SP}/img/admin_{tag}.jpg", full_page=True, type="jpeg", quality=80)
        check(f"{tag} console 0 錯", not errs, str(errs[:3]))
        ctx.close()
    # 操作：核准重複系列（改掛）、核准重複版本（改掛）、駁回國內系列的預填、再重查
    ctx = br.new_context(viewport={"width": 1440, "height": 900})
    ctx.add_cookies([{"name": "yz_session", "value": TOK, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
    p = ctx.new_page(); errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    p.on("response", lambda r: errs.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    p.goto(BASE + "/admin/additions", wait_until="load"); p.wait_for_selector("[data-testid=af]")
    row = p.locator("[data-testid=add-item][data-type=series][data-ref='hyukoh/2']")
    check("重複系列按鈕寫改掛過去", "改掛" in row.locator("[data-testid=add-confirm]").inner_text())
    row.locator("[data-testid=add-confirm]").click()
    p.wait_for_selector("[data-testid=add-open] [data-testid=add-item][data-ref='hyukoh/2']", state="detached", timeout=20000)
    s = q("SELECT deleted_at FROM series WHERE artist_slug='hyukoh' AND no=2")
    check("核准重複系列＝改掛，新建的系列軟刪除", s and s[0]["deleted_at"])
    row = p.locator("[data-testid=add-item][data-type=version][data-ref='hyukoh/1#cd-v4']")
    row.locator("[data-testid=add-confirm]").click()
    p.wait_for_selector("[data-testid=add-open] [data-testid=add-item][data-ref='hyukoh/1#cd-v4']", state="detached", timeout=20000)
    v = q("SELECT v.deleted_at FROM versions v JOIN items i ON i.id=v.item_ref JOIN series w ON w.id=i.series_id WHERE w.artist_slug='hyukoh' AND w.no=1 AND i.item_id='cd' AND v.version_id='v4'")
    check("核准重複版本＝改掛到 cd-v3，新建的版本軟刪除", v and v[0]["deleted_at"])
    # 駁回預填：挑國內那組裡有自動建版本的那筆（系列或版本，看執行順序），駁回後那些版本收掉、會員的版本留著
    case = json.load(open(f"{SP}/cases.json"))["國內"]
    sk = case["series"]; sid = q(f"SELECT id FROM series WHERE artist_slug='{sk.split('/')[0]}' AND no={sk.split('/')[1]}")[0]["id"]
    jobs = q(f"SELECT j.addition_id AS aid, j.type, j.ref, j.applied FROM autofill_jobs j WHERE (j.type='series' AND j.ref='{sid}') OR (j.type='version' AND j.ref IN (SELECT CAST(v.id AS TEXT) FROM versions v JOIN items i ON i.id=v.item_ref WHERE i.series_id={sid}))")
    tgt = next(j for j in jobs if json.loads(j["applied"]).get("createdVersions"))
    created = json.loads(tgt["applied"])["createdVersions"]
    user_v = q(f"SELECT v.id FROM versions v JOIN items i ON i.id=v.item_ref WHERE i.series_id={sid} AND v.source IS NULL AND v.deleted_at IS NULL")
    before = q(f"SELECT mbid,kind FROM series WHERE id={sid}")[0]
    row = p.locator(f"[data-testid=add-item][data-id='{tgt['aid']}']")
    row.locator("[data-testid=af-reject]").click()
    p.wait_for_selector(f"[data-testid=add-item][data-id='{tgt['aid']}'] [data-testid=af][data-decision=rejected]", timeout=20000)
    gone = q(f"SELECT count(*) n FROM versions WHERE id IN ({','.join(map(str, created))}) AND deleted_at IS NOT NULL")[0]["n"]
    check(f"駁回預填（{tgt['type']}）：自動建的 {len(created)} 個版本收掉", gone == len(created))
    left = q(f"SELECT count(*) n FROM versions WHERE id IN ({','.join(str(x['id']) for x in user_v)}) AND deleted_at IS NULL")[0]["n"]
    check("駁回預填：會員自己的版本還在", left == len(user_v) and left >= 1)
    if tgt["type"] == "series":
        after = q(f"SELECT mbid,kind FROM series WHERE id={sid}")[0]
        check("駁回預填：系列 MBID、類型還原", after["mbid"] is None and after["kind"] == "album", f"{before} → {after}")
    # 重查（不指定）→ 再次預填
    row.locator("[data-testid=af-recheck]").click()
    row.locator("[data-testid=af-recheck-go]").click()
    ok = False
    for _ in range(60):
        time.sleep(3)
        j = q(f"SELECT status, confidence, applied FROM autofill_jobs WHERE addition_id={tgt['aid']}")[0]
        if j["status"] == "done": ok = j["confidence"] == "high" and json.loads(j["applied"]) != {}; break
    check("重查後重新預填（高信心）", ok, str(j)[:200])
    p.reload(wait_until="load"); p.wait_for_selector("[data-testid=af]")
    p.screenshot(path=f"{SP}/img/admin_after_actions.jpg", full_page=True, type="jpeg", quality=80)
    check("操作過程 console 0 錯", not errs, str(errs[:3]))
    br.close()
print(f"{sum(o for _, o in res)}/{len(res)}")
