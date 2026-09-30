import json, subprocess, sys, time, urllib.request
SP = "/tmp/claude-1000/-mnt-e-AboutAI-Claude/3150e145-987c-412f-afbb-557eaa4fa1f8/scratchpad/af"
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8792"
TOK = open(f"{SP}/token").read().strip()
def api(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST",
        headers={"content-type": "application/json", "cookie": f"yz_session={TOK}", "origin": BASE})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def sub(**b):
    st, d = api("/api/catalog/submit", b)
    print("  submit", b.get("type"), st, json.dumps(d, ensure_ascii=False)[:200]); return d
out = {}
# 1 國內：透明雜誌 → 《透明雜誌FOREVER》2012 → CD 台灣版 2012（沒條碼）
a = sub(type="artist", name="透明雜誌")
w = sub(type="series", artist=a["key"], title="透明雜誌FOREVER", seriesKind="album", year="2012")
time.sleep(8)  # 模擬使用者填版本的時間
v = sub(type="version", seriesKey=w["key"], kind="CD", edition="台灣版", year="2012", region="台灣")
out["國內"] = {"artist": a["key"], "series": w["key"], "version": v["key"]}
# 2 國外：ADOY → 《Catnip》2017 → CD 韓版（有條碼）
a = sub(type="artist", name="ADOY")
w = sub(type="series", artist=a["key"], title="Catnip", seriesKind="album", year="2017")
v = sub(type="version", seriesKey=w["key"], kind="CD", edition="韓版", year="", region="韓國", barcode="8809447087986")
out["國外"] = {"artist": a["key"], "series": w["key"], "version": v["key"]}
# 3 只有數位版：DSPS → 《我會不會又睡到下午了》2016 → CD 一般版
a = sub(type="artist", name="DSPS")
w = sub(type="series", artist=a["key"], title="我會不會又睡到下午了", seriesKind="album", year="2016")
v = sub(type="version", seriesKey=w["key"], kind="CD", edition="一般版", year="2016", region="")
out["只有數位版"] = {"artist": a["key"], "series": w["key"], "version": v["key"]}
# 4 查不到：粗大Band
a = sub(type="artist", name="裝咖人")
out["查不到"] = {"artist": a["key"]}
# 5 重名：既有藝人 HYUKOH 底下再建《23》2017；再在既有 hyukoh/1 的 CD 建「韓國再版」2020
w = sub(type="series", artist="hyukoh", title="23", seriesKind="album", year="2017")
v = sub(type="version", seriesKey="hyukoh/1", kind="CD", edition="韓國再版", year="2020", region="韓國")
out["重名"] = {"series": w["key"], "version": v["key"]}
json.dump(out, open(f"{SP}/cases.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False))
