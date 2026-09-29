#!/usr/bin/env python3
"""收藏照片浮水印重燒（2026-09-29，浮水印改成燒進檔案）。

兩種用途，同一支腳本：
  1. 舊照片補燒（一次性）：orig_key 還是空的舊照片，現在的主圖就是沒燒過的原圖。先把它複製到 R2 不公開的 o/，
     再從這份原圖燒浮水印。
  2. 站名或帳號名改了：從 o/ 的原圖把全部照片重燒一次（lib/data.ts 的 SITE_NAME 改好、部署完再跑）。

每張照片：
  - 從原圖在無頭瀏覽器裡燒出新的主圖、縮圖（有分享預覽圖的也重畫）。燒法是 esbuild 當場打包 lib/watermark-burn.ts，
    跟網站上傳時同一份程式、同一套 Google Fonts 字型；字型沒載到就停，不會燒出系統字
  - 新檔一律換新檔名（p/{id}_{隨機}.webp）：/img/ 回應是一年 immutable 快取，同檔名覆蓋不會生效
  - D1 一句 UPDATE 換掉 r2_key／thumb_key／og_key（條件是舊檔名沒變，別人同時改過就跳過），容量計數加減差額
  - 最後刪掉舊的主圖、縮圖、預覽圖。舊檔名在 D1 查不到，/img/ 先查 D1 就回 404，各資料中心的 Worker 快取副本也不會再被拿出來
只處理 purpose='share' 且沒刪除的照片；大頭貼、藝人照片、申訴證據不動。照片 id 不變，其他表都是用 id 參照。

用法（在 網站/ 底下）：
  python3 scripts/reburn-watermark.py --remote [--dry-run] [--only 照片id] [--only-legacy]
  python3 scripts/reburn-watermark.py --local [--persist-to .wrangler/state] [--dry-run] [--only 照片id]
--remote 會先跑 scripts/backup.mjs --remote 做站外備份，失敗就不動。
正式環境要有 CLOUDFLARE_API_TOKEN／CLOUDFLARE_ACCOUNT_ID（見部署手冊）。
需要：pip3 install playwright && python3 -m playwright install chromium
產出：.wrangler/reburn/（下載的原圖、燒好的檔、report.json）
"""
import argparse
import base64
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
BUCKET = "yinzang-photos"
STORAGE_LIMIT = 8 * 1024**3
FONTS = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap"

ap = argparse.ArgumentParser()
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument("--remote", action="store_true")
g.add_argument("--local", action="store_true")
ap.add_argument("--persist-to", default=".wrangler/state")
ap.add_argument("--dry-run", action="store_true")
ap.add_argument("--only", default="")
ap.add_argument("--only-legacy", action="store_true", help="只補還沒有原圖的舊照片（orig_key 是空的）")
ap.add_argument("--skip-backup", action="store_true", help="正式環境剛備份過才用")
args = ap.parse_args()

cfg = ["--config", "wrangler.production.jsonc"] if args.remote else ["--config", "wrangler.local.jsonc"]
target = ["--remote", *cfg] if args.remote else ["--local", *cfg, "--persist-to", args.persist_to]
work = ROOT / ".wrangler" / "reburn"
work.mkdir(parents=True, exist_ok=True)


def wrangler(*a, capture=True):
    r = subprocess.run(
        ["node", "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", *a],
        cwd=ROOT, capture_output=capture, text=True,
    )
    return r


def query(sql):
    r = wrangler("d1", "execute", "DB", *target, "--json", "--command", sql)
    if r.returncode != 0:
        raise SystemExit(f"查詢失敗：{sql}\n{r.stdout[-800:]}{r.stderr[-800:]}")
    return json.loads(r.stdout[r.stdout.index("["):])[0]["results"]


def q(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def r2_get(key, dest):
    r = wrangler("r2", "object", "get", f"{BUCKET}/{key}", *target, "--file", str(dest))
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size == 0:
        raise RuntimeError(f"R2 讀不到 {key}：{(r.stderr or r.stdout)[-300:]}")
    return dest.read_bytes()


def r2_put(key, path, ctype):
    r = wrangler("r2", "object", "put", f"{BUCKET}/{key}", *target, "--file", str(path), "--content-type", ctype)
    if r.returncode != 0:
        raise RuntimeError(f"R2 寫不進 {key}：{(r.stderr or r.stdout)[-300:]}")


def r2_delete(key):
    r = wrangler("r2", "object", "delete", f"{BUCKET}/{key}", *target)
    return r.returncode == 0


def sniff(b):
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP":
        return "image/webp", "webp"
    if b[:3] == b"\xff\xd8\xff":
        return "image/jpeg", "jpg"
    raise RuntimeError("不是 WebP／JPEG")


def bundle():
    entry = 'export * from "./lib/watermark-burn"; export { watermarkText, SITE_NAME } from "./lib/data";'
    r = subprocess.run(
        [str(ROOT / "node_modules" / ".bin" / "esbuild"), "--bundle", "--format=iife", "--global-name=YZBurn", "--tsconfig=tsconfig.json", "--loader=ts"],
        cwd=ROOT, input=entry, capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(f"esbuild 打包失敗：{r.stderr}")
    return r.stdout


BURN_JS = """
async ({ b64, type, handle, og }) => {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const mark = YZBurn.watermarkText(handle);
  const r = await YZBurn.burnFromOriginal(new Blob([bin], { type }), mark);
  const enc = async (b) => {
    const u = new Uint8Array(await b.arrayBuffer());
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const out = { mark, fonts: r.fonts, main: await enc(r.main), mainType: r.main.type, thumb: await enc(r.thumb), thumbType: r.thumb.type, w: r.img.width, h: r.img.height };
  if (og) out.og = await enc(await YZBurn.ogFromOriginal(r.img, mark));
  return out;
}
"""


def main():
    if args.remote and not args.dry_run and not args.skip_backup:
        print("== 站外備份 ==")
        if subprocess.run(["node", "scripts/backup.mjs", "--remote"], cwd=ROOT).returncode != 0:
            raise SystemExit("備份失敗，不動任何照片")

    where = "p.purpose = 'share' AND p.deleted_at IS NULL" + (f" AND p.id = {q(args.only)}" if args.only else "") + (" AND p.orig_key IS NULL" if args.only_legacy else "")
    rows = query(
        f"SELECT p.id, p.r2_key, p.thumb_key, p.og_key, p.orig_key, p.bytes, u.handle FROM photos p "
        f"LEFT JOIN users u ON u.id = p.owner_id WHERE {where} ORDER BY p.created_at"
    )
    used = query("SELECT COALESCE((SELECT value FROM counters WHERE key = 'r2_bytes'), 0) AS v")[0]["v"]
    print(f"要處理 {len(rows)} 張；R2 計數目前 {used:,} bytes")
    report = {"目標": "remote" if args.remote else "local", "dry_run": args.dry_run, "照片": [], "失敗": []}

    js = bundle()
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.set_content(f'<!doctype html><html><head><link rel="stylesheet" href="{FONTS}"></head><body></body></html>', wait_until="networkidle")
        page.add_script_tag(content=js)
        delta_total = 0
        for row in rows:
            pid = row["id"]
            try:
                handle = row["handle"]
                if not handle:
                    raise RuntimeError("找不到發文者帳號名")
                legacy = not row["orig_key"]
                src_key = row["r2_key"] if legacy else row["orig_key"]
                orig = r2_get(src_key, work / f"{pid}_src")
                otype, oext = sniff(orig)
                orig_key = row["orig_key"] or f"o/{pid}.{oext}"
                res = page.evaluate(BURN_JS, {"b64": base64.b64encode(orig).decode(), "type": otype, "handle": handle, "og": bool(row["og_key"])})
                if not res["fonts"]:
                    raise SystemExit("網站字型沒載到（Google Fonts 連不上？），停止，不燒系統字")
                tok = secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")
                ext = lambda t: "webp" if t == "image/webp" else "jpg"
                files = {
                    "main": (f"p/{pid}_{tok}.{ext(res['mainType'])}", base64.b64decode(res["main"]), res["mainType"]),
                    "thumb": (f"p/{pid}_{tok}_t.{ext(res['thumbType'])}", base64.b64decode(res["thumb"]), res["thumbType"]),
                }
                if res.get("og"):
                    files["og"] = (f"p/{pid}_{tok}_og.jpg", base64.b64decode(res["og"]), "image/jpeg")
                new_bytes = sum(len(b) for _, b, _ in files.values()) + len(orig)
                delta = new_bytes - row["bytes"]
                for name, (key, b, _) in files.items():
                    (work / key.replace("/", "_")).write_bytes(b)
                item = {
                    "id": pid, "帳號": handle, "浮水印": res["mark"], "補燒舊照片": legacy, "尺寸": f"{res['w']}x{res['h']}",
                    "舊": [row["r2_key"], row["thumb_key"], row["og_key"]], "新": [f[0] for f in files.values()], "原圖": orig_key,
                    "bytes": {"舊": row["bytes"], "新": new_bytes, "差": delta},
                }
                if args.dry_run:
                    report["照片"].append(item)
                    print(f"[試跑] {pid} {res['mark']} → {item['新'][0]}（{delta:+,} bytes）")
                    continue
                if used + delta_total + delta > STORAGE_LIMIT:
                    raise SystemExit("超過 8GB 上限，停止")
                if legacy:
                    p = work / f"{pid}_src"
                    r2_put(orig_key, p, otype)
                for key, b, ctype in files.values():
                    p = work / key.replace("/", "_")
                    r2_put(key, p, ctype)
                og_new = files["og"][0] if "og" in files else None
                sql = (
                    f"UPDATE photos SET r2_key = {q(files['main'][0])}, thumb_key = {q(files['thumb'][0])}, og_key = {q(og_new)}, "
                    f"orig_key = {q(orig_key)}, content_type = {q(files['main'][2])}, bytes = {new_bytes} "
                    f"WHERE id = {q(pid)} AND r2_key = {q(row['r2_key'])} AND deleted_at IS NULL; "
                    f"UPDATE counters SET value = MAX(0, value + {delta}) WHERE key = 'r2_bytes' AND changes() > 0;"
                )
                # changes() 在第二句讀的是上一句 UPDATE 的筆數：照片沒換成功就不動容量計數
                wrangler("d1", "execute", "DB", *target, "--command", sql, *(["--yes"] if args.remote else []))
                now = query(f"SELECT r2_key FROM photos WHERE id = {q(pid)}")
                if not now or now[0]["r2_key"] != files["main"][0]:
                    for key, _, _ in files.values():
                        r2_delete(key)
                    raise RuntimeError("D1 沒換成功（可能同時被改過），新檔已刪、舊檔保留")
                # 舊檔還有別的照片列指著（本機測試資料會共用檔名）就留著，不然刪掉
                for old in [row["r2_key"], row["thumb_key"], row["og_key"]]:
                    if not old or old == orig_key:
                        continue
                    still = query(f"SELECT COUNT(*) AS n FROM photos WHERE r2_key = {q(old)} OR thumb_key = {q(old)} OR og_key = {q(old)} OR orig_key = {q(old)}")[0]["n"]
                    if still == 0:
                        r2_delete(old)
                    else:
                        item.setdefault("保留舊檔", []).append(old)
                delta_total += delta
                report["照片"].append(item)
                print(f"{pid} {res['mark']} → {files['main'][0]}（{delta:+,} bytes）")
            except SystemExit:
                raise
            except Exception as e:  # noqa: BLE001
                report["失敗"].append({"id": pid, "error": str(e)})
                print(f"失敗 {pid}：{e}", file=sys.stderr)
        browser.close()

    after = query("SELECT COALESCE((SELECT value FROM counters WHERE key = 'r2_bytes'), 0) AS v")[0]["v"]
    report["R2計數"] = {"前": used, "後": after, "上限": STORAGE_LIMIT}
    (work / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"完成 {len(report['照片'])} 張，失敗 {len(report['失敗'])} 張；R2 計數 {used:,} → {after:,}（上限 {STORAGE_LIMIT:,}）")
    print(f"報告：{work / 'report.json'}")
    sys.exit(1 if report["失敗"] else 0)


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
