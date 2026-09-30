#!/usr/bin/env python3
"""SEO 基礎建設本機驗收（2026-10-01）。

前提：網站/ 用 ALLOW_INDEXING=1 建置（npm run build）、npm start -- --port 8797，本機 D1 是正式站備份還原的。
用法：python3 _驗收_本機.py [--base http://127.0.0.1:8797] [--phase on|off]
  on  ：ALLOW_INDEXING=1 的建置，驗三層架構（標題描述、結構化資料、noindex 規則、sitemap、後台）
  off ：ALLOW_INDEXING=0 的建置，驗全站仍 noindex、robots 不附 sitemap
輸出：result_本機_{phase}.json、抽驗_輸出_{phase}.md、img/*.jpg
會改本機 D1（測試完一律改回原值），不碰正式站。
"""
import argparse, glob, hashlib, io, json, os, re, secrets, sqlite3, sys, time, urllib.parse, urllib.request, urllib.error
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, "..", "..", "網站"))
SCHEMA = os.environ.get("SCHEMA_JSONLD", "")
ap = argparse.ArgumentParser()
ap.add_argument("--base", default="http://127.0.0.1:8797")
ap.add_argument("--phase", default="on", choices=["on", "off"])
args = ap.parse_args()
BASE = args.base.rstrip("/")
PHASE = args.phase
UA = "Mozilla/5.0 (X11; Linux x86_64) lemibox-seo-check"
DB = [x for x in glob.glob(os.path.join(SITE, ".wrangler/state/v3/d1/**/*.sqlite"), recursive=True) if "metadata" not in x][0]
db = sqlite3.connect(DB, isolation_level=None)
results = []
report = []


def check(cid, name, ok, detail=""):
    results.append({"id": cid, "name": name, "ok": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL"), cid, name, "" if ok else detail)


def get(path, cookie=None, cb=True):
    """cb＝加亂數查詢字串繞過整頁快取（catalog_additions、reports 這類改動不一定換內容版本）"""
    url = BASE + urllib.parse.quote(path, safe="/?=&%:")
    if cb:
        url += ("&" if "?" in path else "?") + "cb=" + secrets.token_hex(4)
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Cookie": f"yz_session={cookie}"} if cookie else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode("utf-8", "replace")


class Head(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_head = True
        self.meta = {}
        self.head_tags = set()
        self.ld = []
        self._ld = None
        self._title = None
        self.imgs = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "body":
            self.in_head = False
        if tag == "title" and "title" not in self.meta:
            self._title = ""
        if tag == "meta":
            k = a.get("name") or a.get("property")
            if k and k not in self.meta:
                self.meta[k] = a.get("content", "")
                if self.in_head:
                    self.head_tags.add(k)
        if tag == "link" and a.get("rel") == "canonical" and "canonical" not in self.meta:
            self.meta["canonical"] = a.get("href", "")
            if self.in_head:
                self.head_tags.add("canonical")
        if tag == "script" and a.get("type") == "application/ld+json":
            self._ld = ""
        if tag == "img":
            self.imgs.append(a)

    def handle_endtag(self, tag):
        if tag == "head":
            self.in_head = False
        if tag == "title" and self._title is not None:
            self.meta["title"] = self._title
            if self.in_head:
                self.head_tags.add("title")
            self._title = None
        if tag == "script" and self._ld is not None:
            self.ld.append(json.loads(self._ld))
            self._ld = None

    def handle_data(self, d):
        if self._title is not None:
            self._title += d
        if self._ld is not None:
            self._ld += d


def parse(html):
    h = Head()
    h.feed(html)
    return h


def page(path, cookie=None):
    st, hd, html = get(path, cookie)
    h = parse(html)
    robots_meta = h.meta.get("robots", "")
    noindex = "noindex" in robots_meta or "noindex" in hd.get("x-robots-tag", "")
    return {"status": st, "headers": hd, "html": html, "h": h, "noindex": noindex}


# ---------- schema.org 詞彙（離線驗證） ----------
vocab = json.load(open(SCHEMA)) if SCHEMA else None
classes, props, sub, enum_members = {}, {}, {}, {}
if vocab:
    for n in vocab["@graph"]:
        nid = n["@id"].replace("schema:", "")
        types = n["@type"] if isinstance(n["@type"], list) else [n["@type"]]
        if "rdfs:Class" in types:
            classes[nid] = n
            sc = n.get("rdfs:subClassOf", [])
            sc = sc if isinstance(sc, list) else [sc]
            sub[nid] = [x["@id"].replace("schema:", "") for x in sc]
        if "rdf:Property" in types:
            dom = n.get("schema:domainIncludes", [])
            dom = dom if isinstance(dom, list) else [dom]
            props[nid] = [x["@id"].replace("schema:", "") for x in dom]
        for t in types:
            t = t.replace("schema:", "")
            if t not in ("rdfs:Class", "rdf:Property"):
                enum_members.setdefault(t, set()).add(nid)


def ancestors(t):
    out, stack = set(), [t]
    while stack:
        x = stack.pop()
        if x in out:
            continue
        out.add(x)
        stack += sub.get(x, [])
    return out


def validate_node(node, path, errs):
    if isinstance(node, list):
        for i, x in enumerate(node):
            validate_node(x, f"{path}[{i}]", errs)
        return
    if not isinstance(node, dict):
        return
    t = node.get("@type")
    if t is None:
        if set(node) - {"@id"}:
            errs.append(f"{path}: 沒有 @type")
        return
    if t not in classes:
        errs.append(f"{path}: 不存在的類別 {t}")
        return
    anc = ancestors(t)
    for k, v in node.items():
        if k.startswith("@"):
            continue
        if k not in props:
            errs.append(f"{path}.{k}: 不存在的屬性")
            continue
        if not anc & set(props[k]):
            errs.append(f"{path}.{k}: {t} 不能用這個屬性（domain {props[k]}）")
        if k in ("musicReleaseFormat", "albumReleaseType"):
            enum = "MusicReleaseFormatType" if k == "musicReleaseFormat" else "MusicAlbumReleaseType"
            m = str(v).replace("https://schema.org/", "")
            if m not in enum_members.get(enum, set()):
                errs.append(f"{path}.{k}: {v} 不是 {enum} 的值")
        validate_node(v, f"{path}.{k}", errs)


def google_breadcrumb(node, errs):
    items = node.get("itemListElement", [])
    if len(items) < 1:
        errs.append("BreadcrumbList 沒有項目")
    for i, it in enumerate(items):
        if it.get("@type") != "ListItem":
            errs.append(f"第 {i+1} 項不是 ListItem")
        if it.get("position") != i + 1:
            errs.append(f"第 {i+1} 項 position 不對")
        if not it.get("name"):
            errs.append(f"第 {i+1} 項沒有 name")
        if i < len(items) - 1 and not str(it.get("item", "")).startswith("https://lemibox.com/"):
            errs.append(f"第 {i+1} 項 item 不是正式網域絕對網址")


def validate_ld(ld_list):
    errs, types = [], []
    for block in ld_list:
        if block.get("@context") != "https://schema.org":
            errs.append("@context 不是 https://schema.org")
        for n in block.get("@graph", []):
            types.append(n.get("@type"))
            validate_node(n, n.get("@type", "?"), errs)
            if n.get("@type") == "BreadcrumbList":
                google_breadcrumb(n, errs)
    return types, errs


def sql(q, *a):
    return db.execute(q, a).fetchall()


def summary_row(path, p):
    m = p["h"].meta
    return (
        f"| `{path}` | {p['status']} | {m.get('title','')} | {m.get('description','')} | {m.get('canonical','')} | "
        f"{m.get('og:image','').replace('https://lemibox.com','')} | {'noindex' if p['noindex'] else '收錄'} |"
    )


def sitemap_urls():
    st, _, idx = get("/sitemap.xml", cb=False)
    files = re.findall(r"<loc>https://lemibox\.com(/sitemaps/[^<]+)</loc>", idx)
    urls = {}
    for f in files:
        _, _, x = get(f, cb=False)
        urls[f] = re.findall(r"<loc>https://lemibox\.com([^<]+)</loc>", x)
    return st, idx, urls


def admin_session():
    """本機建一個管理員（ADMIN_EMAILS 預設 admin@demo.yinzang.test）＋session，回 token"""
    uid = "seo-check-admin"
    if not sql("SELECT 1 FROM users WHERE id = ?", uid):
        db.execute(
            "INSERT INTO users (id, email, email_verified_at, password_hash, handle, name, name_key) VALUES (?,?,?,?,?,?,?)",
            (uid, "admin@demo.yinzang.test", "2026-10-01T00:00:00.000Z", "!test", "seocheckadmin", "SEO驗收管理員", "seo驗收管理員"),
        )
    tok = secrets.token_urlsafe(24)
    sid = hashlib.sha256(tok.encode()).hexdigest()
    db.execute("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)", (sid, uid, "2099-01-01T00:00:00.000Z"))
    return tok


def api(method, path, tok, body=None, files=None):
    url = BASE + urllib.parse.quote(path, safe="/?=&%:")
    headers = {"User-Agent": UA, "Cookie": f"yz_session={tok}", "Origin": BASE}
    data = None
    if files:
        bnd = "----seo" + secrets.token_hex(8)
        buf = io.BytesIO()
        for k, v in (body or {}).items():
            buf.write(f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
        for k, (fn, content, ct) in files.items():
            buf.write(f"--{bnd}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{fn}\"\r\nContent-Type: {ct}\r\n\r\n".encode())
            buf.write(content)
            buf.write(b"\r\n")
        buf.write(f"--{bnd}--\r\n".encode())
        data = buf.getvalue()
        headers["Content-Type"] = f"multipart/form-data; boundary={bnd}"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# ======================================================================
if PHASE == "off":
    st, hd, robots = get("/robots.txt", cb=False)
    check("off-1", "robots.txt 沒附 Sitemap", "Sitemap:" not in robots, robots[-200:])
    check("off-2", "robots.txt 仍允許爬取、只擋 /admin 與 /api/", "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/" in robots)
    for path in ["/", "/about", "/guide", "/artists", "/artist/hyukoh", "/artist/hyukoh/1", "/share/10", "/privacy", "/terms"]:
        p = page(path)
        m = p["h"].meta
        check(f"off-{path}", f"{path} meta robots＝noindex 且 X-Robots-Tag noindex", m.get("robots") == "noindex" and "noindex" in p["headers"].get("x-robots-tag", ""), f"{m.get('robots')} / {p['headers'].get('x-robots-tag')}")
        check(f"off-head-{path}", f"{path} robots meta 在 <head>", "robots" in p["h"].head_tags)
    st, _, sm = get("/sitemap.xml", cb=False)
    check("off-sitemap", "sitemap.xml 照樣產生（頁面本身都 noindex）", st == 200 and "<sitemapindex" in sm)
    json.dump({"phase": PHASE, "results": results}, open(os.path.join(HERE, f"result_本機_{PHASE}.json"), "w"), ensure_ascii=False, indent=2)
    print(f"\n{sum(r['ok'] for r in results)}/{len(results)} 通過")
    sys.exit(0 if all(r["ok"] for r in results) else 1)

# ---------- 1. 標題、描述、canonical、og（各類至少 3 頁） ----------
SAMPLES = {
    "首頁與固定頁": ["/", "/about", "/guide", "/?page=2"],
    "藝人頁": ["/artist/hyukoh", "/artist/sunset-rollercoaster", "/artist/a-tt4v", "/artist/lu1", "/artist/gordon"],
    "系列頁（含版本）": ["/artist/a-tt4v/1", "/artist/hyukoh/1", "/artist/lu1/1", "/artist/sunset-rollercoaster/2", "/artist/gordon/5"],
    "收藏頁": ["/share/10", "/share/8", "/share/9", "/share/3", "/share/4", "/share/5"],
}
report.append("# SEO 抽驗輸出（本機，正式站 2026-10-01 00:07 備份）\n")
report.append("ALLOW_INDEXING=1 的本機建置。og:image 省略網域 https://lemibox.com。\n")
pages = {}
for group, paths in SAMPLES.items():
    report.append(f"\n## {group}\n\n| 網址 | 狀態 | title | description | canonical | og:image | 收錄 |\n|---|---|---|---|---|---|---|")
    for path in paths:
        p = page(path)
        pages[path] = p
        m = p["h"].meta
        report.append(summary_row(path, p))
        want_canon = "https://lemibox.com" + (path if path != "/?page=2" else "/?page=2")
        check(f"meta{path}", f"{path} 200、title／description／canonical／og 都有且在 <head>",
              p["status"] == 200 and all(k in p["h"].head_tags for k in ("title", "description", "canonical", "og:title", "og:image", "og:url"))
              and m.get("canonical") == want_canon and m.get("og:url") == want_canon and m.get("og:image", "").startswith("https://lemibox.com/"),
              json.dumps({k: m.get(k) for k in ("title", "description", "canonical", "og:image")}, ensure_ascii=False) + f" head={sorted(p['h'].head_tags)}")

# 標題格式（使用者給的兩個範例）
check("fmt-1", "系列頁標題＝「理想混蛋《關掉／打開》2022 台灣首版 CD｜曲目、版本與收藏｜樂迷藏」",
      pages["/artist/a-tt4v/1"]["h"].meta.get("title") == "理想混蛋《關掉／打開》2022 台灣首版 CD｜曲目、版本與收藏｜樂迷藏", pages["/artist/a-tt4v/1"]["h"].meta.get("title"))
check("fmt-2", "收藏頁標題＝「Hyukoh《23》2020 韓國再版 CD｜民生鄰居的收藏｜樂迷藏」",
      pages["/share/10"]["h"].meta.get("title") == "Hyukoh《23》2020 韓國再版 CD｜民生鄰居的收藏｜樂迷藏", pages["/share/10"]["h"].meta.get("title"))
d10 = pages["/share/10"]["h"].meta.get("description", "")
check("fmt-3", "收藏頁描述含藝人、專輯、版本、發行年與內文開頭", all(x in d10 for x in ("Hyukoh", "《23》", "2020 韓國再版 CD", "全新未拆")), d10)
check("fmt-4", "首頁補上 og 標籤（og-default.png）", pages["/"]["h"].meta.get("og:image") == "https://lemibox.com/og-default.png")
check("fmt-6", "沒連系列的收藏標題用發文者的類型細項（MC HotDog 帽子）", pages["/share/5"]["h"].meta.get("title") == "MC HotDog 帽子｜民生鄰居的收藏｜樂迷藏", pages["/share/5"]["h"].meta.get("title"))
check("fmt-5", "首頁分頁 ?page=2 canonical 指自己", pages["/?page=2"]["h"].meta.get("canonical") == "https://lemibox.com/?page=2")

# 照片 alt
alts = [i.get("alt", "") for i in pages["/share/10"]["h"].imgs if (i.get("src") or "").startswith("/img/p/") or "img%2Fp" in (i.get("src") or "")]
check("alt-1", "收藏照片 alt 自動產生（藝人《系列》版本＋誰的收藏照片）", any(a.startswith("Hyukoh《23》2020 韓國再版 CD，民生鄰居的收藏照片") for a in alts), alts[:3])
a_alts = [i.get("alt", "") for i in pages["/artist/hyukoh"]["h"].imgs if "收藏照片" in (i.get("alt") or "")]
check("alt-2", "藝人頁收藏卡片 alt 也是自動組的（首頁收藏牆是前端渲染，瀏覽器截圖另驗）", any(a.startswith("Hyukoh《23》") for a in a_alts), a_alts[:3])
p5 = page("/share/5")
alts5 = [i.get("alt", "") for i in p5["h"].imgs if "收藏照片" in (i.get("alt") or "")]
check("alt-3", "沒連系列的收藏 alt 照原字（MC HotDog 帽子）", any(a.startswith("MC HotDog 帽子，") for a in alts5), alts5[:2])

# ---------- 2. 結構化資料 ----------
report.append("\n## 結構化資料（schema.org 詞彙離線驗證＋Google 麵包屑規格）\n\n| 網址 | 類型 | 錯誤 |\n|---|---|---|")
ld_dump = {}
for path in ["/", "/about", "/guide"] + SAMPLES["藝人頁"] + SAMPLES["系列頁（含版本）"] + SAMPLES["收藏頁"]:
    p = pages.get(path) or page(path)
    types, errs = validate_ld(p["h"].ld)
    ld_dump[path] = p["h"].ld
    report.append(f"| `{path}` | {', '.join(map(str, types))} | {'；'.join(errs) or '無'} |")
    check(f"ld{path}", f"{path} 結構化資料通過 schema.org 詞彙檢查", p["h"].ld and not errs, errs[:5])
json.dump(ld_dump, open(os.path.join(HERE, "結構化資料_輸出.json"), "w"), ensure_ascii=False, indent=2)

def graph(path, t):
    return [n for b in pages[path]["h"].ld for n in b["@graph"] if n.get("@type") == t]

al = graph("/artist/hyukoh/1", "MusicAlbum")
rel = al[0].get("albumRelease", []) if al else []
check("ld-album", "系列頁 MusicAlbum（Hyukoh《23》）有曲目、4 個 MusicRelease 版本", al and al[0].get("numTracks", 0) > 0 and len(rel) == 4, json.dumps(rel, ensure_ascii=False)[:400])
check("ld-release-fmt", "版本格式對到 CDFormat／VinylFormat", {r["musicReleaseFormat"] for r in rel} == {"https://schema.org/CDFormat", "https://schema.org/VinylFormat"}, [r["musicReleaseFormat"] for r in rel])
check("ld-release-no-catalog", "結構化資料不含目錄號、條碼（登入限定的辨識細節）", "catalogNumber" not in json.dumps(ld_dump) and "gtin" not in json.dumps(ld_dump))
ag = graph("/artist/hyukoh", "MusicGroup") + graph("/artist/hyukoh", "Person")
check("ld-artist", "藝人頁有 MusicGroup／Person", bool(ag), [n.get("@type") for b in pages["/artist/hyukoh"]["h"].ld for n in b["@graph"]])
bc = graph("/share/10", "BreadcrumbList")
check("ld-bc", "收藏頁麵包屑 首頁 › 藝人 › Hyukoh › 23 › 這則", bc and [x["name"] for x in bc[0]["itemListElement"]][:4] == ["首頁", "藝人", "Hyukoh", "23"], bc and [x["name"] for x in bc[0]["itemListElement"]])
check("ld-no-offer", "沒有加 Product／Offer（只提方案）", '"Offer"' not in json.dumps(ld_dump) and '"Product"' not in json.dumps(ld_dump))

# ---------- 3. noindex 規則逐條 ----------
report.append("\n## noindex 規則逐條\n\n| 規則 | 網址 | 改動前 | 改動後 | 改回後 |\n|---|---|---|---|---|")

def rule(cid, name, path, before_expect, change, after_expect, revert, after_status=None):
    b = page(path)
    change()
    a = page(path)
    revert()
    r = page(path)
    st_ok = (a["status"] == after_status) if after_status else True
    ok = (b["noindex"] == before_expect) and ((a["noindex"] == after_expect) if not after_status else st_ok) and (r["noindex"] == before_expect) and r["status"] == 200
    lab = lambda p: f"{p['status']} {'noindex' if p['noindex'] else '收錄'}"
    report.append(f"| {name} | `{path}` | {lab(b)} | {lab(a)} | {lab(r)} |")
    check(cid, name, ok, f"{lab(b)} → {lab(a)} → {lab(r)}")

# 3a 內容太空的系列：落日飛車《My jinji 日版》沒收藏、沒曲目、介紹 0 字
thin = "sunset-rollercoaster"
sid = sql("SELECT id FROM series WHERE artist_slug = ? AND no = 1", thin)[0][0]
body0 = sql("SELECT body FROM series WHERE id = ?", sid)[0][0]
rule("ni-thin", "內容太空的系列 noindex；補 30 字以上介紹自動恢復收錄", "/artist/sunset-rollercoaster/1", True,
     lambda: db.execute("UPDATE series SET body = ? WHERE id = ?", (json.dumps(["落日飛車在 2016 年發行的日本版專輯，收錄 My jinji 等歌曲，附日文側標與翻譯歌詞單。"], ensure_ascii=False), sid)),
     False, lambda: db.execute("UPDATE series SET body = ? WHERE id = ?", (body0, sid)))

# 3b 檢舉達門檻（交易暫停）的收藏
def lock():
    db.execute("INSERT INTO settings (key, value) VALUES ('report_threshold', '1') ON CONFLICT(key) DO UPDATE SET value = '1'")
    db.execute("INSERT INTO reports (target, reporter_id, reason) VALUES ('share:10', 'tdNAYvSZpKh2fdet', 'fake')")
def unlock():
    db.execute("DELETE FROM reports WHERE target = 'share:10' AND reporter_id = 'tdNAYvSZpKh2fdet'")
    db.execute("DELETE FROM settings WHERE key = 'report_threshold'")
rule("ni-lock", "檢舉達門檻、交易暫停的收藏 noindex；解除後恢復", "/share/10", False, lock, True, unlock)

# 3c 已刪除的內容
rule("ni-del", "已刪除的收藏回 404（不收錄、不在 sitemap）", "/share/9", False,
     lambda: db.execute("UPDATE shares SET deleted_at = '2026-10-01T00:00:00.000Z' WHERE no = 9"), None,
     lambda: db.execute("UPDATE shares SET deleted_at = NULL WHERE no = 9"), after_status=404)

# 3d 待確認的新增（藝人、系列）
def add(t, ref):
    return lambda: db.execute("INSERT INTO catalog_additions (type, ref, created_by) VALUES (?, ?, 'tdNAYvSZpKh2fdet')", (t, ref))
def drop(t, ref):
    return lambda: db.execute("DELETE FROM catalog_additions WHERE type = ? AND ref = ? AND created_by = 'tdNAYvSZpKh2fdet'", (t, ref))
rule("ni-pend-artist", "待確認的藝人 noindex；確認後恢復", "/artist/gordon", False, add("artist", "gordon"), True, drop("artist", "gordon"))
gid = sql("SELECT id FROM series WHERE artist_slug = 'gordon' AND no = 5")[0][0]
rule("ni-pend-series", "待確認的系列 noindex；確認後恢復", "/artist/gordon/5", False, add("series", str(gid)), True, drop("series", str(gid)))
vid = sql("SELECT v.id FROM versions v JOIN items i ON i.id = v.item_ref WHERE i.series_id = (SELECT id FROM series WHERE artist_slug='hyukoh' AND no=1) AND v.version_id='v2'")[0][0]
add("version", str(vid))()
n_rel = len([n for b in page("/artist/hyukoh/1")["h"].ld for n in b["@graph"] if n.get("@type") == "MusicAlbum"][0]["albumRelease"])
drop("version", str(vid))()
check("ni-pend-version", "待確認的版本不列進 MusicRelease（4→3）", n_rel == 3, n_rel)
st = page("/artist/hyukoh/1")
db.execute("UPDATE series SET status = 'pending' WHERE artist_slug = 'lu1' AND no = 1")
p_pending = page("/artist/lu1/1")
db.execute("UPDATE series SET status = 'approved' WHERE artist_slug = 'lu1' AND no = 1")
check("ni-status-pending", "審核中（status=pending）的系列 404", p_pending["status"] == 404, p_pending["status"])
report.append(f"| 審核中（status=pending）的系列 | `/artist/lu1/1` | 200 收錄 | {p_pending['status']} | 200 收錄 |")

# 3e 私人頁、功能頁：X-Robots-Tag
report.append("\n| 私人／功能頁 | 狀態 | X-Robots-Tag |\n|---|---|---|")
for path in ["/settings", "/messages", "/search?q=落日", "/me", "/me/likes", "/login", "/admin", "/u/dz4277", "/tag/test", "/ranking", "/feedback", "/verify",
             "/share/new", "/share/10/edit", "/artist/hyukoh/history", "/artist/hyukoh/1/history", "/artist/hyukoh?edit=1"]:
    st, hd, _ = get(path)
    x = hd.get("x-robots-tag", "")
    report.append(f"| `{path}` | {st} | {x or '（無）'} |")
    check(f"ni-priv{path}", f"{path} 帶 X-Robots-Tag noindex", "noindex" in x, f"{st} {x}")
for path in ["/", "/artists", "/artist/hyukoh", "/artist/hyukoh/1", "/share/10", "/about", "/guide"]:
    st, hd, _ = get(path)
    check(f"idx{path}", f"{path} 沒有 X-Robots-Tag（可收錄）", "x-robots-tag" not in hd, hd.get("x-robots-tag"))

# ---------- 4. sitemap ----------
st, idx, urls = sitemap_urls()
st_r, _, robots = get("/robots.txt", cb=False)
check("sm-robots", "ALLOW_INDEXING=1：robots.txt 附 Sitemap", "Sitemap: https://lemibox.com/sitemap.xml" in robots)
total = sum(len(v) for v in urls.values())
report.append("\n## sitemap\n\n| 檔案 | 筆數 |\n|---|---|")
for f, v in urls.items():
    report.append(f"| `{f}` | {len(v)} |")
report.append(f"| 合計 | {total} |")
check("sm-1", "sitemap.xml 是索引，分檔 pages／artists／series／shares", st == 200 and len(urls) >= 4, list(urls))
all_urls = [u for v in urls.values() for u in v]
check("sm-2", "sitemap 沒有私人頁、沒有 noindex 對象（內容太空的系列）", "/artist/sunset-rollercoaster/1" not in all_urls and not any(u.startswith(("/u/", "/tag/", "/settings", "/admin")) for u in all_urls))
bad = []
for u in all_urls:
    p = page(u)
    if p["status"] != 200 or p["noindex"]:
        bad.append((u, p["status"], p["noindex"]))
check("sm-3", f"sitemap 裡 {len(all_urls)} 個網址逐一打開：全部 200 且可收錄", not bad, bad[:10])
# 新增內容自動進 sitemap：補介紹讓太空系列變可收錄
db.execute("UPDATE series SET body = ? WHERE id = ?", (json.dumps(["落日飛車在 2016 年發行的日本版專輯，收錄 My jinji 等歌曲，附日文側標與翻譯歌詞單。"], ensure_ascii=False), sid))
_, _, urls2 = sitemap_urls()
db.execute("UPDATE series SET body = ? WHERE id = ?", (body0, sid))
check("sm-4", "內容改變後 sitemap 自動更新（太空系列補介紹後出現）", "/artist/sunset-rollercoaster/1" in [u for v in urls2.values() for u in v])

# 收錄預估：可見頁 vs sitemap
vis_artists = int(re.search(r'data-type="all"><span>全部藝人</span><span class="num">(\d+)', pages["/"]["html"]).group(1)) if re.search(r'data-type="all"><span>全部藝人</span><span class="num">(\d+)', pages["/"]["html"]) else None
counts = {
    "series_total": sql("SELECT COUNT(*) FROM series WHERE status='approved' AND deleted_at IS NULL AND hidden_at IS NULL")[0][0],
    "shares_total": sql("SELECT COUNT(*) FROM shares WHERE deleted_at IS NULL AND hidden_at IS NULL")[0][0],
    "artists_total_approved": sql("SELECT COUNT(*) FROM artists WHERE status='approved' AND deleted_at IS NULL AND hidden_at IS NULL")[0][0],
    "artists_directory_visible": vis_artists,
    "sitemap": {f: len(v) for f, v in urls.items()},
}

# ---------- 5. 後台（第三層） ----------
tok = admin_session()
st, form = api("GET", "/api/admin/seo?target=artist:hyukoh", tok)
check("adm-1", "後台讀得到藝人的自動標題、描述、收錄判斷", st == 200 and form["auto"]["title"] == "Hyukoh｜專輯、版本與收藏" and form["auto_index"]["index"], json.dumps(form, ensure_ascii=False)[:300])
st, _ = api("GET", "/api/admin/seo?target=artist:hyukoh", None) if False else (None, None)
req = urllib.request.Request(BASE + "/api/admin/seo?target=page:home", headers={"User-Agent": UA})
try:
    urllib.request.urlopen(req, timeout=30)
    anon = 200
except urllib.error.HTTPError as e:
    anon = e.code
check("adm-2", "沒登入打後台 API 被擋", anon in (401, 403), anon)
st, _ = api("POST", "/api/admin/seo", tok, {"action": "save", "target": "artist:hyukoh", "title": "Hyukoh 赫俄克｜韓國樂團專輯與版本", "description": "自訂描述：Hyukoh 的專輯、版本與樂迷收藏。", "noindex": False})
p = page("/artist/hyukoh")
check("adm-3", "自訂標題、描述生效（接後綴）", p["h"].meta.get("title") == "Hyukoh 赫俄克｜韓國樂團專輯與版本｜樂迷藏" and p["h"].meta.get("description") == "自訂描述：Hyukoh 的專輯、版本與樂迷收藏。", p["h"].meta.get("title"))
try:
    from PIL import Image
    im = Image.new("RGB", (1200, 630), (34, 51, 77))
    b = io.BytesIO()
    im.save(b, "JPEG", quality=80)
    st, up = api("POST", "/api/admin/seo", tok, {"target": "artist:hyukoh"}, files={"image": ("og.jpg", b.getvalue(), "image/jpeg")})
    p = page("/artist/hyukoh")
    ogu = p["h"].meta.get("og:image", "")
    st_img, hd_img, _ = get(ogu.replace("https://lemibox.com", ""), cb=False)
    check("adm-4", "上傳 og 圖（1200×630）後 og:image 換成 /img/g/…，圖片 200", st == 201 and "/img/g/" in ogu and st_img == 200, f"{st} {up} {ogu} {st_img}")
    im2 = Image.new("RGB", (800, 800), (1, 2, 3))
    b2 = io.BytesIO()
    im2.save(b2, "JPEG")
    st2, e2 = api("POST", "/api/admin/seo", tok, {"target": "artist:hyukoh"}, files={"image": ("x.jpg", b2.getvalue(), "image/jpeg")})
    check("adm-5", "尺寸不對的 og 圖被拒", st2 == 400, f"{st2} {e2}")
except Exception as e:  # noqa
    check("adm-4", "上傳 og 圖", False, repr(e))
st, _ = api("POST", "/api/admin/seo", tok, {"action": "save", "target": "artist:hyukoh", "title": "", "description": "", "noindex": True})
p = page("/artist/hyukoh")
_, _, u3 = sitemap_urls()
check("adm-6", "不收錄開關：藝人頁 noindex、sitemap 拿掉", p["noindex"] and "/artist/hyukoh" not in [u for v in u3.values() for u in v], p["h"].meta.get("robots"))
check("adm-7", "欄位清空＝回到自動標題", p["h"].meta.get("title") == "Hyukoh｜專輯、版本與收藏｜樂迷藏", p["h"].meta.get("title"))
api("POST", "/api/admin/seo", tok, {"action": "clear-og", "target": "artist:hyukoh"})
st, _ = api("POST", "/api/admin/seo", tok, {"action": "save", "target": "artist:hyukoh", "title": "", "description": "", "noindex": False})
p = page("/artist/hyukoh")
check("adm-8", "關掉開關、清掉 og 圖後恢復自動（收錄、og 回藝人照片或收藏照片）", not p["noindex"] and "/img/g/" not in p["h"].meta.get("og:image", ""), p["h"].meta.get("og:image"))
check("adm-9", "settings 沒留下 seo:artist:hyukoh（全部清空就刪列）", not sql("SELECT 1 FROM settings WHERE key = 'seo:artist:hyukoh'"))
st, _ = api("POST", "/api/admin/seo", tok, {"action": "site", "suffix": "樂迷藏 Lemibox", "description": "全站預設描述測試"})
p = page("/artist/a-tt4v/1")
h = page("/")
check("adm-10", "全站標題後綴、預設描述生效", p["h"].meta.get("title", "").endswith("｜樂迷藏 Lemibox") and h["h"].meta.get("description") == "全站預設描述測試", f"{p['h'].meta.get('title')} / {h['h'].meta.get('description')}")
api("POST", "/api/admin/seo", tok, {"action": "site", "suffix": "", "description": ""})
p = page("/artist/a-tt4v/1")
check("adm-11", "全站設定清空回預設", p["h"].meta.get("title", "").endswith("｜樂迷藏"), p["h"].meta.get("title"))
for t in ("series:a-tt4v/1", "page:home", "page:about"):
    st, f = api("GET", f"/api/admin/seo?target={t}", tok)
    check(f"adm-form-{t}", f"後台讀得到 {t} 的自動值", st == 200 and f["auto"]["title"] and f["auto"]["description"], json.dumps(f.get("auto"), ensure_ascii=False))
st, s = api("GET", "/api/admin/seo?q=落日", tok)
check("adm-search", "後台搜尋找得到藝人與系列", st == 200 and any(x["target"] == "artist:sunset-rollercoaster" for x in s["list"]) and any(x["kind"] == "系列" for x in s["list"]), [x["target"] for x in s["list"]][:5])
n_log = sql("SELECT COUNT(*) FROM admin_log WHERE admin_id = 'seo-check-admin' AND action LIKE '%SEO%'")[0][0]
check("adm-log", "後台 SEO 寫入都有操作紀錄", n_log >= 5, n_log)

# 後台畫面截圖（Playwright）
try:
    from playwright.sync_api import sync_playwright
    os.makedirs(os.path.join(HERE, "img"), exist_ok=True)
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 1000})
        ctx.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        missing = []
        pg.on("response", lambda r: missing.append(r.url) if r.status == 404 else None)
        pg.goto(BASE + "/admin/seo?target=artist:hyukoh", wait_until="load")
        pg.wait_for_selector('[data-testid="seo-serp-title"]', timeout=20000)
        pg.screenshot(path=os.path.join(HERE, "img/後台SEO_藝人_自動.jpg"), type="jpeg", quality=80, full_page=True)
        pg.fill('[data-testid="seo-title"]', "Hyukoh 赫俄克：韓國獨立樂團的全部專輯、每一個版本、樂迷收藏與曲目比對")
        pg.wait_for_timeout(300)
        over = pg.get_attribute('[data-testid="seo-count-標題"]', "data-over")
        serp = pg.inner_text('[data-testid="seo-serp-title"]')
        pg.screenshot(path=os.path.join(HERE, "img/後台SEO_標題超過提醒.jpg"), type="jpeg", quality=80, full_page=True)
        check("adm-ui-1", "Google 預覽即時更新，標題超過 30 字出現提醒", over == "1" and serp.endswith("｜樂迷藏"), f"{over} {serp}")
        pg.goto(BASE + "/admin/seo?target=page:home", wait_until="load")
        pg.wait_for_selector('[data-testid="seo-serp-title"]', timeout=20000)
        check("adm-ui-2", "首頁的預覽標題不接後綴", pg.inner_text('[data-testid="seo-serp-title"]') == "樂迷藏｜樂迷的收藏分享")
        pg.screenshot(path=os.path.join(HERE, "img/後台SEO_首頁與全站設定.jpg"), type="jpeg", quality=80, full_page=True)
        m = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        m.add_cookies([{"name": "yz_session", "value": tok, "domain": "127.0.0.1", "path": "/", "httpOnly": True}])
        mp = m.new_page()
        mp.goto(BASE + "/admin/seo?target=series:a-tt4v/1", wait_until="load")
        mp.wait_for_selector('[data-testid="seo-serp-title"]', timeout=20000)
        ov = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        mp.screenshot(path=os.path.join(HERE, "img/後台SEO_系列_390.jpg"), type="jpeg", quality=80, full_page=True)
        check("adm-ui-3", "後台 SEO 在 390px 沒有橫向溢出", not ov)
        sp = ctx.new_page()
        sp.goto(BASE + "/share/10", wait_until="load")
        sp.wait_for_timeout(1500)
        sp.screenshot(path=os.path.join(HERE, "img/收藏頁_share10.jpg"), type="jpeg", quality=80)
        # 本機 R2 只放了收藏主圖與縮圖，分享預覽圖（_og.jpg）沒放，後台預覽那張 404 是本機缺檔，不算
        local_missing = [u for u in missing if re.search(r"/img/p/[^/]+_og\.jpg", u)]
        errs = [e for e in errs if "Turnstile" not in e and "font-size:0" not in e]
        check("adm-ui-4", "後台 SEO 頁 console error 0（本機缺的 _og.jpg 除外）", len(errs) <= len(local_missing) and all(re.search(r"_og\.jpg", u) for u in missing), {"errs": errs[:3], "404": missing[:3]})
        br.close()
except Exception as e:  # noqa
    check("adm-ui", "後台畫面截圖", False, repr(e))
db.execute("DELETE FROM sessions WHERE user_id = 'seo-check-admin'")

json.dump({"phase": PHASE, "counts": counts, "results": results}, open(os.path.join(HERE, f"result_本機_{PHASE}.json"), "w"), ensure_ascii=False, indent=2)
open(os.path.join(HERE, f"抽驗_輸出_{PHASE}.md"), "w").write("\n".join(report) + "\n")
print(json.dumps(counts, ensure_ascii=False))
print(f"\n{sum(r['ok'] for r in results)}/{len(results)} 通過")
sys.exit(0 if all(r["ok"] for r in results) else 1)
