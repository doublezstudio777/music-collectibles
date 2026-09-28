# 抽樣比對：資料庫裡的曲目 vs MusicBrainz 網頁（release 頁）逐首比對歌名、序號、時長
# 用法：python3 _比對MusicBrainz網頁.py <網站資料夾> <persist-to 資料夾> <release MBID>...
import json, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

SITE, PERSIST, IDS = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
W = ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", PERSIST, "--json", "--command"]
out = []
with sync_playwright() as pw:
    br = pw.chromium.launch()
    pg = br.new_page(user_agent="Lemicang/0.1 ( zukawork0312@gmail.com )")
    for mbid in IDS:
        r = subprocess.run(W + [f"SELECT v.edition, w.title, v.track_list FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.mbid = '{mbid}'"], cwd=SITE, capture_output=True, text=True)
        row = json.loads(r.stdout[r.stdout.index("["):])[0]["results"][0]
        db = [l for l in json.loads(row["track_list"]) if not l.startswith("【")]
        pg.goto(f"https://musicbrainz.org/release/{mbid}")
        pg.wait_for_selector("table.medium", timeout=60000)
        web = pg.evaluate("""() => [...document.querySelectorAll('table.medium tbody tr[id]')].map(tr => {
            const pos = tr.querySelector('td.pos')?.innerText.trim();
            const title = tr.querySelector('td.title bdi')?.innerText.trim();
            const tds = tr.querySelectorAll('td'); const len = tds[tds.length - 1].innerText.trim();
            return `${pos}. ${title}${/^\\d+:\\d{2}$/.test(len) ? ` (${len})` : ''}`})""")
        same = db == web
        diffs = [(i + 1, a, b) for i, (a, b) in enumerate(zip(db, web)) if a != b]
        out.append({"release": mbid, "系列": row["title"], "版本": row["edition"], "資料庫首數": len(db), "網頁首數": len(web), "逐首相同": same, "不同處": diffs[:5]})
        print(json.dumps(out[-1], ensure_ascii=False))
        time.sleep(2)
    br.close()
Path(__file__).with_name("比對MusicBrainz網頁.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
