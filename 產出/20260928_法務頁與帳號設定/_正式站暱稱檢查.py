# 正式站暱稱檢查（唯讀）：找出比對鍵相同（忽略大小寫、空白、全形半形）的重複暱稱，以及含保留字的暱稱。
# 不改任何資料。用法：在 網站/ 底下設好 CLOUDFLARE_API_TOKEN 後
#   python3 ../產出/20260928_法務頁與帳號設定/_正式站暱稱檢查.py
# 規則跟 網站/lib/server/names.ts 同一份（改規則兩邊一起改）。
import json, re, subprocess, sys, unicodedata
from collections import defaultdict

SITE_NAME = "音藏"
CURATOR = "館長"
DELETED = "已刪除的會員"


def key(s):
    return re.sub(r"[\s​-‍⁠﻿]", "", unicodedata.normalize("NFKC", s).lower())


CONTAINS = [key(x) for x in [DELETED, CURATOR, SITE_NAME, "音藏", "管理員", "站長"]]
EXACT = [key(x) for x in ["官方", "客服", "系統", "管理者", "admin", "administrator", "system", "yinzang", "moderator"]]

r = subprocess.run(
    ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--remote",
     "--config", "wrangler.production.jsonc", "--json", "--command",
     "SELECT id, handle, name, status, name_key AS nk FROM users WHERE status != 'deleted'"],
    capture_output=True, text=True,
)
if r.returncode:
    sys.exit(r.stdout[-800:] + r.stderr[-800:])
rows = json.loads(r.stdout[r.stdout.index("["):])[-1]["results"]
groups = defaultdict(list)
for u in rows:
    groups[key(u["name"])].append(u)
dups = {k: v for k, v in groups.items() if len(v) > 1}
reserved = [u for u in rows if key(u["name"]) in EXACT or any(w in key(u["name"]) for w in CONTAINS)]
mismatch = [u for u in rows if u["nk"] is not None and u["nk"] != key(u["name"])]
print(json.dumps({
    "members": len(rows),
    "backfilled": sum(1 for u in rows if u["nk"] is not None),
    "duplicates": [[{"handle": u["handle"], "name": u["name"], "status": u["status"]} for u in v] for v in dups.values()],
    "reserved": [{"handle": u["handle"], "name": u["name"], "status": u["status"]} for u in reserved],
    "keyMismatch": len(mismatch),
}, ensure_ascii=False, indent=1))
