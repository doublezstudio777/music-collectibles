// 疑似重複藝人：偵測、預覽合併會搬動多少筆、合併、標「不是重複」（2026-09-28 表單藝人預設）。
//
// 偵測規則（純用記憶體裡的目錄比對，不碰資料庫，跟表單搜尋同一份資料）：
// - 中文名完全相同
// - 一方名稱是另一方的前綴或後綴（例：「凹與山」跟「凹與山Our Shame」、「青虫」跟「青虫aoi」）
// - 英文別名有重疊，或一方的英文別名等於對方的中文名
// 只比對還在（未刪除）的藝人；已經標「不是重複」的那組（artist_duplicate_marks）不再列出。
//
// 合併：保留一位（keep），另一位（lose）的系列、收藏、出價鍵、我有／想要、追蹤、不感興趣、
// 檢舉／申訴／裁決／頁面鎖定／編輯紀錄全部搬到 keep 底下；lose 的別名＋名稱併進 keep 的別名，
// 得獎紀錄併進 keep；lose 的識別碼寫一筆轉址（跟改識別碼共用同一張 artist_redirects，連續合併／
// 改名都只轉一次）；lose 這列藝人軟刪除（deleted_at），不會再出現在目錄或表單裡。
// 系列的流水號是「藝人底下」流水號，keep 已經用過的號不能重複給 lose 的系列，所以 lose 的系列
// 搬過去時要重新編號（跟新增系列同一套「MAX(no) 與 counters.series_no 取大的＋1」規則），
// 所有引用到那個系列鍵（收藏、我有／想要、成交、檢舉／申訴／裁決／鎖定／編輯紀錄）跟著改新鍵。
// 全部在同一個 D1 batch（同一個交易）做完，中途失敗整批不生效。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog, artistDuplicateMarks } from "@/db/schema";
import { getCatalog } from "@/lib/server/content";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";
import { norm, type Artist } from "@/lib/data";

export type DuplicateSide = {
  slug: string;
  name: string;
  aliases: string[];
  kind: Artist["kind"];
  gender: string | null;
  region: string | null;
  hasWiki: boolean;
  seriesCount: number;
  shareCount: number;
};
export type DuplicatePair = { pairKey: string; reason: string; a: DuplicateSide; b: DuplicateSide };

const pairKey = (x: string, y: string) => [x, y].sort().join("|");

/** 兩個名字是不是「一方是另一方的前綴或後綴」，中英夾雜也算（例：ERIKA劉艾立／劉艾立） */
function containment(an: string, bn: string) {
  const shorter = Math.min(an.length, bn.length);
  if (shorter < 2) return false;
  return an.startsWith(bn) || an.endsWith(bn) || bn.startsWith(an) || bn.endsWith(an);
}

function reasonOf(a: Pick<Artist, "name" | "aliases">, b: Pick<Artist, "name" | "aliases">): string | null {
  const an = norm(a.name);
  const bn = norm(b.name);
  const aAliases = a.aliases.map(norm).filter(Boolean);
  const bAliases = b.aliases.map(norm).filter(Boolean);
  if (an === bn) return "中文名完全相同";
  if (containment(an, bn)) return "名稱前綴／後綴包含關係";
  if (aAliases.length && aAliases.some((x) => bAliases.includes(x))) return "英文別名相同";
  if (aAliases.includes(bn) || bAliases.includes(an)) return "一方英文別名＝對方中文名";
  return null;
}

/** 偵測疑似重複的組數＋清單。O(n²) 比對，藝人一多（幾百位）還在毫秒等級，不用另外快取 */
export async function detectDuplicatePairs(): Promise<DuplicatePair[]> {
  const c = await getCatalog();
  const dismissed = new Set(
    (await getDb().select({ k: artistDuplicateMarks.pairKey }).from(artistDuplicateMarks)).map((r) => r.k),
  );
  const side = (a: Artist): DuplicateSide => ({
    slug: a.slug,
    name: a.name,
    aliases: a.aliases,
    kind: a.kind,
    gender: a.gender ?? null,
    region: a.region ?? null,
    hasWiki: Boolean(a.wiki),
    seriesCount: c.mainSeriesOf(a.slug).length,
    shareCount: c.sharesWithTag(a.name).length,
  });
  const pairs: DuplicatePair[] = [];
  const arr = c.artists;
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const reason = reasonOf(arr[i], arr[j]);
      if (!reason) continue;
      const k = pairKey(arr[i].slug, arr[j].slug);
      if (dismissed.has(k)) continue;
      pairs.push({ pairKey: k, reason, a: side(arr[i]), b: side(arr[j]) });
    }
  }
  return pairs;
}

export async function dismissDuplicate(admin: User, rawA: unknown, rawB: unknown) {
  if (typeof rawA !== "string" || typeof rawB !== "string" || !rawA.trim() || !rawB.trim()) {
    throw new HttpError(400, "BAD_REQUEST", "參數不對");
  }
  const k = pairKey(rawA.trim(), rawB.trim());
  await getDb().insert(artistDuplicateMarks).values({ pairKey: k, decision: "not_duplicate", decidedBy: admin.id }).onConflictDoNothing();
  await getDb().insert(adminLog).values({ adminId: admin.id, action: "標記不是重複藝人", target: `artist-dup:${k}`, detail: "{}" });
  return { pairKey: k };
}

type Impact = { series: number; shares: number; holdings: number; deals: number; follows: number; dismissals: number; revisions: number; decisions: number; locks: number };

async function loadPair(keep: string, lose: string) {
  const db = env.DB!;
  const keepRow = await db.prepare(`SELECT slug, aliases, awards, name FROM artists WHERE slug = ?1 AND deleted_at IS NULL`).bind(keep).first<{
    slug: string;
    aliases: string;
    awards: string;
    name: string;
  }>();
  const loseRow = await db.prepare(`SELECT slug, aliases, awards, name FROM artists WHERE slug = ?1 AND deleted_at IS NULL`).bind(lose).first<{
    slug: string;
    aliases: string;
    awards: string;
    name: string;
  }>();
  if (!keepRow || !loseRow) throw new HttpError(404, "NOT_FOUND", "找不到其中一位藝人");
  return { keepRow, loseRow };
}

/** 會搬動幾筆：合併前給管理員看，也是合併後寫進 admin_log 的數字 */
export async function previewMerge(rawKeep: unknown, rawLose: unknown): Promise<Impact & { keep: string; lose: string }> {
  if (typeof rawKeep !== "string" || typeof rawLose !== "string") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const keep = rawKeep.trim();
  const lose = rawLose.trim();
  if (!keep || !lose || keep === lose) throw new HttpError(400, "INVALID", "要選兩位不同的藝人");
  await loadPair(keep, lose);
  const db = env.DB!;
  const count = async (sql: string, ...bind: unknown[]) => (await db.prepare(sql).bind(...bind).first<{ n: number }>())?.n ?? 0;
  const [series, follows, dismissals, revisions, decisions, locks] = await Promise.all([
    count(`SELECT count(*) AS n FROM series WHERE artist_slug = ?1`, lose),
    count(`SELECT count(*) AS n FROM follows WHERE artist_slug = ?1`, lose),
    count(`SELECT count(*) AS n FROM artist_dismissals WHERE artist_slug = ?1`, lose),
    count(`SELECT count(*) AS n FROM revisions WHERE target = ?1`, `artist:${lose}`),
    count(`SELECT count(*) AS n FROM target_decisions WHERE target = ?1`, `artist:${lose}`),
    count(`SELECT count(*) AS n FROM page_locks WHERE target = ?1`, `artist:${lose}`),
  ]);
  const seriesRows = await db.prepare(`SELECT no FROM series WHERE artist_slug = ?1`).bind(lose).all<{ no: number }>();
  let shares = 0;
  let holdings = 0;
  let deals = 0;
  for (const row of seriesRows.results) {
    const key = `${lose}/${row.no}`;
    shares += await count(`SELECT count(*) AS n FROM shares WHERE series_key = ?1`, key);
    holdings += await count(`SELECT count(*) AS n FROM holdings WHERE target_key = ?1 OR substr(target_key,1,?2) = ?3`, key, key.length + 1, `${key}#`);
    deals += await count(`SELECT count(*) AS n FROM deals WHERE version_key = ?1 OR substr(version_key,1,?2) = ?3`, key, key.length + 1, `${key}#`);
  }
  return { keep, lose, series, shares, holdings, deals, follows, dismissals, revisions, decisions, locks };
}

/** 合併：keep 保留，lose 併過去後軟刪除。回傳搬動的筆數（合併前算好，寫進 admin_log） */
export async function mergeArtists(admin: User, rawKeep: unknown, rawLose: unknown) {
  const impact = await previewMerge(rawKeep, rawLose);
  const { keep, lose } = impact;
  const { keepRow, loseRow } = await loadPair(keep, lose);
  const db = env.DB!;

  const [maxNoRow, counterRow] = await Promise.all([
    db.prepare(`SELECT COALESCE(MAX(no),0) AS m FROM series WHERE artist_slug = ?1`).bind(keep).first<{ m: number }>(),
    db.prepare(`SELECT value AS v FROM counters WHERE key = ?1`).bind(`series_no:${keep}`).first<{ v: number }>(),
  ]);
  let nextNo = Math.max(maxNoRow?.m ?? 0, counterRow?.v ?? 0) + 1;
  const loseSeries = await db.prepare(`SELECT id, no FROM series WHERE artist_slug = ?1 ORDER BY no ASC`).bind(lose).all<{ id: number; no: number }>();

  const stmts: D1PreparedStatement[] = [];
  const run = (sql: string, ...bind: unknown[]) => stmts.push(db.prepare(sql).bind(...bind));
  const nowExpr = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

  // ---------- 1. 系列逐一重新編號搬到 keep 底下，所有引用到「舊鍵」的地方跟著改新鍵 ----------
  let lastNo = nextNo - 1;
  for (const s of loseSeries.results) {
    const newNo = nextNo++;
    lastNo = newNo;
    const oldKey = `${lose}/${s.no}`;
    const newKey = `${keep}/${newNo}`;
    run(`UPDATE series SET artist_slug = ?2, no = ?3, updated_at = ${nowExpr} WHERE id = ?1`, s.id, keep, newNo);
    run(`UPDATE shares SET series_key = ?2 WHERE series_key = ?1`, oldKey, newKey);
    for (const [table, col] of [
      ["holdings", "target_key"],
      ["deals", "version_key"],
    ] as const) {
      const oldPrefix = `${oldKey}#`;
      const newPrefix = `${newKey}#`;
      run(`UPDATE ${table} SET ${col} = ?2 WHERE ${col} = ?1`, oldKey, newKey);
      run(`UPDATE ${table} SET ${col} = ?2 || substr(${col}, ?3) WHERE substr(${col}, 1, ?4) = ?1`, oldPrefix, newPrefix, oldPrefix.length + 1, oldPrefix.length);
    }
    // 合集標記（2026-10-01）：同一則合集同一個鍵只有一列，撞到就保留原本那列
    run(`UPDATE OR IGNORE collection_tags SET target_key = ?2 WHERE target_key = ?1`, oldKey, newKey);
    run(`UPDATE OR IGNORE collection_tags SET target_key = ?2 || substr(target_key, ?3) WHERE substr(target_key, 1, ?4) = ?1`, `${oldKey}#`, `${newKey}#`, oldKey.length + 2, oldKey.length + 1);
    for (const table of ["reports", "appeals", "target_decisions", "page_locks", "revisions"]) {
      run(`UPDATE ${table} SET target = ?2 WHERE target = ?1`, `series:${oldKey}`, `series:${newKey}`);
      for (const p of ["item:", "version:"]) {
        const oldPrefix = `${p}${oldKey}#`;
        const newPrefix = `${p}${newKey}#`;
        run(`UPDATE ${table} SET target = ?2 || substr(target, ?3) WHERE substr(target, 1, ?4) = ?1`, oldPrefix, newPrefix, oldPrefix.length + 1, oldPrefix.length);
      }
    }
  }
  if (loseSeries.results.length) {
    run(`INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)`, `series_no:${keep}`, lastNo);
  }
  run(`DELETE FROM counters WHERE key = ?1`, `series_no:${lose}`);

  // ---------- 2. 藝人層級的引用（不看系列流水號）：credits／guests／compilation JSON、追蹤、不感興趣、artist: 對象鍵 ----------
  for (const col of ["credits", "guests", "compilation"]) {
    run(`UPDATE series SET ${col} = REPLACE(${col}, ?1, ?2) WHERE instr(${col}, ?1) > 0`, JSON.stringify(lose), JSON.stringify(keep));
  }
  run(`DELETE FROM follows WHERE artist_slug = ?1 AND user_id IN (SELECT user_id FROM follows WHERE artist_slug = ?2)`, lose, keep);
  run(`UPDATE follows SET artist_slug = ?2 WHERE artist_slug = ?1`, lose, keep);
  run(`DELETE FROM artist_dismissals WHERE artist_slug = ?1 AND user_id IN (SELECT user_id FROM artist_dismissals WHERE artist_slug = ?2)`, lose, keep);
  run(`UPDATE artist_dismissals SET artist_slug = ?2 WHERE artist_slug = ?1`, lose, keep);
  // 首頁推薦歌曲：同一首兩邊都有就留 keep 那筆
  run(`DELETE FROM spotify_picks WHERE artist_slug = ?1 AND track_id IN (SELECT track_id FROM spotify_picks WHERE artist_slug = ?2)`, lose, keep);
  run(`UPDATE spotify_picks SET artist_slug = ?2 WHERE artist_slug = ?1`, lose, keep);
  // target_decisions／page_locks 是「對象一列」，跟 keep 既有的一列撞了就丟掉 lose 那列（keep 既有的優先）
  for (const table of ["target_decisions", "page_locks"]) {
    run(`DELETE FROM ${table} WHERE target = ?1 AND EXISTS (SELECT 1 FROM ${table} WHERE target = ?2)`, `artist:${lose}`, `artist:${keep}`);
    run(`UPDATE ${table} SET target = ?2 WHERE target = ?1`, `artist:${lose}`, `artist:${keep}`);
  }
  // revisions（編輯歷史）本來就是多筆，直接搬
  run(`UPDATE revisions SET target = ?2 WHERE target = ?1`, `artist:${lose}`, `artist:${keep}`);

  // ---------- 3. 別名、得獎紀錄併進 keep；lose 軟刪除 ----------
  const keepAliases: string[] = JSON.parse(keepRow.aliases || "[]");
  const loseAliases: string[] = JSON.parse(loseRow.aliases || "[]");
  const mergedAliases = Array.from(new Set([...keepAliases, ...loseAliases, loseRow.name].filter((x) => x && x !== keepRow.name)));
  const keepAwards: unknown[] = JSON.parse(keepRow.awards || "[]");
  const loseAwards: unknown[] = JSON.parse(loseRow.awards || "[]");
  const seenAward = new Set(keepAwards.map((a) => JSON.stringify(a)));
  const mergedAwards = [...keepAwards];
  for (const a of loseAwards) {
    const k = JSON.stringify(a);
    if (!seenAward.has(k)) {
      seenAward.add(k);
      mergedAwards.push(a);
    }
  }
  run(`UPDATE artists SET aliases = ?2, awards = ?3, updated_at = ${nowExpr} WHERE slug = ?1`, keep, JSON.stringify(mergedAliases), JSON.stringify(mergedAwards));
  run(`UPDATE artists SET deleted_at = ${nowExpr}, updated_at = ${nowExpr} WHERE slug = ?1`, lose);

  // ---------- 4. 轉址：跟改識別碼共用同一張表，連續合併／改名都只轉一次 ----------
  run(`DELETE FROM artist_redirects WHERE old_slug = ?1`, keep);
  run(`UPDATE artist_redirects SET new_slug = ?2 WHERE new_slug = ?1`, lose, keep);
  run(`INSERT INTO artist_redirects (old_slug, new_slug, created_by) VALUES (?1, ?2, ?3)`, lose, keep, admin.id);

  await db.batch(stmts);

  await getDb()
    .insert(adminLog)
    .values({ adminId: admin.id, action: "合併藝人", target: `artist:${keep}`, detail: JSON.stringify(impact) });
  return impact;
}
