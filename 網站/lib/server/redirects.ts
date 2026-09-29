// 藝人識別碼轉址（上線後第一批，2026-09-28）。
//
// - 管理員改藝人識別碼：所有用到這個識別碼的地方一次改掉（同一個 D1 batch＝同一個交易，要嘛全改、要嘛全不改），
//   並寫一筆 artist_redirects 舊 → 新。舊網址 /artist/{舊}/... 由 proxy.ts 301 到新網址。
// - 連續改名：之前指到「舊」的紀錄一併改指到「新」，轉址永遠只跳一次；改回以前用過的識別碼時，把那筆轉址拿掉。
// - 用到藝人識別碼的地方：藝人本身、系列（主要藝人、共同署名／客串／合輯 JSON）、炫收藏的系列鍵、我有／想要、追蹤、
//   不感興趣、檢舉／申訴／處理結果／頁面鎖定／編輯紀錄的對象鍵、成交紀錄的版本鍵、系列流水號計數器。
//   admin_log 是歷史紀錄，不改。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog } from "@/db/schema";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 舊識別碼 → 目前的識別碼；沒有轉址回 null */
export async function redirectTarget(slug: string) {
  if (!env.DB) return null;
  const r = await env.DB.prepare(`SELECT new_slug AS s FROM artist_redirects WHERE old_slug = ?1`).bind(slug).first<{ s: string }>();
  return r?.s ?? null;
}

/**
 * 舊網址 → 新網址路徑（proxy.ts 用）：藝人識別碼轉址、系列合併轉址（2026-09-28 MusicBrainz 後續）一次查完，
 * 只有一個 D1 請求。seriesNo 有值時才查系列；系列轉址優先（併掉的系列要整段換成新系列）。沒有轉址回 null
 */
export async function redirectPath(slug: string, seriesNo: string | null, rest: string) {
  if (!env.DB) return null;
  const r = await env.DB.prepare(
    `SELECT (SELECT new_slug FROM artist_redirects WHERE old_slug = ?1) AS a, (SELECT new_key FROM series_redirects WHERE old_key = ?2) AS s`,
  )
    .bind(slug, seriesNo ? `${slug}/${seriesNo}` : "")
    .first<{ a: string | null; s: string | null }>();
  if (r?.s) return `/artist/${r.s}${rest}`;
  if (r?.a) return `/artist/${r.a}${seriesNo ? `/${seriesNo}` : ""}${rest}`;
  return null;
}

/** 目標鍵的幾種前綴（reports、appeals、target_decisions、page_locks、revisions 共用） */
const TARGET_PREFIXES = ["artist:", "series:", "item:", "version:"];

export async function renameArtist(admin: User, rawFrom: unknown, rawTo: unknown) {
  if (typeof rawFrom !== "string" || typeof rawTo !== "string") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const from = rawFrom.trim();
  const to = rawTo.trim().toLowerCase();
  if (!SLUG_RE.test(to) || to.length > 60) throw new HttpError(400, "INVALID", "網址用英文名或音譯，小寫英文、數字、連字號，60 字以內");
  if (from === to) throw new HttpError(400, "INVALID", "新舊識別碼一樣");
  const db = env.DB!;
  const cur = await db.prepare(`SELECT slug FROM artists WHERE slug = ?1 AND deleted_at IS NULL`).bind(from).first<{ slug: string }>();
  if (!cur) throw new HttpError(404, "NOT_FOUND", "找不到這個藝人");
  const taken = await db.prepare(`SELECT slug FROM artists WHERE slug = ?1`).bind(to).first();
  if (taken) throw new HttpError(409, "TAKEN", `識別碼 ${to} 已經有人用了`);
  // 新識別碼如果是「別的藝人」以前用過、現在還在轉址的，不能拿（會搶走別人的舊連結）
  const other = await db.prepare(`SELECT new_slug AS s FROM artist_redirects WHERE old_slug = ?1`).bind(to).first<{ s: string }>();
  if (other && other.s !== from) throw new HttpError(409, "TAKEN", `識別碼 ${to} 是別的藝人（${other.s}）的舊網址，還在轉址`);

  const n = from.length;
  const stmts: D1PreparedStatement[] = [];
  const run = (sql: string, ...bind: unknown[]) => stmts.push(db.prepare(sql).bind(...bind));

  run(`UPDATE artists SET slug = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE slug = ?1`, from, to);
  run(`UPDATE series SET artist_slug = ?2 WHERE artist_slug = ?1`, from, to);
  // 新增紀錄（計分用它找藝人，2026-09-29）
  run(`UPDATE catalog_additions SET ref = ?2 WHERE type = 'artist' AND ref = ?1`, from, to);
  // JSON 欄位裡的識別碼一律是 "slug" 帶雙引號，換整個字串不會誤傷別的字
  for (const col of ["credits", "guests", "compilation"]) {
    run(`UPDATE series SET ${col} = REPLACE(${col}, ?1, ?2) WHERE instr(${col}, ?1) > 0`, JSON.stringify(from), JSON.stringify(to));
  }
  // `slug/流水號…` 開頭的鍵
  const prefixed = (table: string, col: string) =>
    run(`UPDATE ${table} SET ${col} = ?2 || substr(${col}, ?3) WHERE substr(${col}, 1, ?3) = ?1`, `${from}/`, `${to}/`, n + 1);
  prefixed("shares", "series_key");
  prefixed("holdings", "target_key");
  prefixed("deals", "version_key");
  run(`UPDATE follows SET artist_slug = ?2 WHERE artist_slug = ?1`, from, to);
  run(`UPDATE artist_dismissals SET artist_slug = ?2 WHERE artist_slug = ?1`, from, to);
  run(`UPDATE spotify_picks SET artist_slug = ?2 WHERE artist_slug = ?1`, from, to);
  // 對象鍵：`artist:slug`、`series:slug/1`、`item:slug/1#cd`、`version:slug/1#cd-v1`
  for (const table of ["reports", "appeals", "target_decisions", "page_locks", "revisions"]) {
    run(`UPDATE ${table} SET target = 'artist:' || ?2 WHERE target = 'artist:' || ?1`, from, to);
    for (const p of TARGET_PREFIXES) {
      run(
        `UPDATE ${table} SET target = ?2 || substr(target, ?3) WHERE substr(target, 1, ?3) = ?1`,
        `${p}${from}/`,
        `${p}${to}/`,
        p.length + n + 1,
      );
    }
  }
  run(`UPDATE counters SET key = ?2 WHERE key = ?1`, `series_no:${from}`, `series_no:${to}`);
  // 轉址：改回以前用過的識別碼 → 那筆不要了；之前指到舊的 → 改指到新的；再加一筆 舊 → 新
  run(`DELETE FROM artist_redirects WHERE old_slug = ?1`, to);
  run(`UPDATE artist_redirects SET new_slug = ?2 WHERE new_slug = ?1`, from, to);
  run(`INSERT INTO artist_redirects (old_slug, new_slug, created_by) VALUES (?1, ?2, ?3)`, from, to, admin.id);
  await db.batch(stmts);

  await getDb()
    .insert(adminLog)
    .values({ adminId: admin.id, action: "改藝人識別碼", target: `artist:${to}`, detail: JSON.stringify({ from, to }) });
  return { from, to };
}
