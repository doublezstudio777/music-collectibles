// 零花費第二、三道防線（2c）與站台狀態。
//
// 第二道：照片每月讀取計數。/img/ 每次真的去 R2 拿檔（Cloudflare 快取沒接住）就記一次，
//   存在 D1 counters `r2_reads:YYYY-MM`（UTC 月份，跟 R2 帳單同一個月）。
//   為了省 D1 寫入額度，同一個 Worker 執行個體累積 FLUSH_EVERY 次才寫一次；執行個體被回收時沒寫進去的會少算，
//   最多少算「執行個體數 × FLUSH_EVERY」，所以門檻設在免費額度的 80% 留緩衝。
//   達門檻（預設 800 萬＝R2 Class B 免費 1,000 萬的 80%）→ 照片改回佔位圖，文字照常。
// 第三道：預算通知 webhook（/api/internal/budget-alert）→ settings.paused = 1，
//   停上傳（photos.ts acceptUpload 已擋）、停讀照片（回佔位圖）、文字照常；管理員在後台解除。

import { env } from "cloudflare:workers";
import { getDb } from "@/db";
import { adminLog, settings } from "@/db/schema";
import { DEFAULT_QUOTA } from "@/lib/server/quota";

export const DEFAULT_READ_LIMIT = 8_000_000;
export const FLUSH_EVERY = 20;

export const monthKey = (d = new Date()) => `r2_reads:${d.toISOString().slice(0, 7)}`;

let pendingReads = 0;

export type SiteStatus = { paused: boolean; pausedAt: string | null; pausedReason: string; reads: number; readLimit: number; photoDaily: number };

/** 一次讀出暫停狀態、本月讀取數、門檻；photoKey 有給就順便查那張照片是誰的、什麼用途 */
export async function siteStatus(photoKey?: string) {
  const db = env.DB!;
  const stmts = [
    db.prepare(`SELECT key, value, updated_at AS at FROM settings WHERE key IN ('paused', 'paused_reason', 'photo_read_limit', 'daily_photo_limit')`),
    db.prepare(`SELECT value FROM counters WHERE key = ?1`).bind(monthKey()),
    // 照片連同它掛的炫收藏一起查：照片刪了、收藏被隱藏或刪除，/img/ 都回 404（2026-09-28）
    ...(photoKey
      ? [
          db
            .prepare(
              `SELECT p.owner_id AS ownerId, p.purpose, p.share_no AS shareNo, p.deleted_at AS photoDeleted,
                      (p.r2_key = ?1 AND p.thumb_key != ?1) AS isMain, u.handle AS handle,
                      s.no AS shareFound, s.hidden_at AS shareHidden, s.deleted_at AS shareDeleted
               FROM photos p LEFT JOIN shares s ON s.no = p.share_no LEFT JOIN users u ON u.id = p.owner_id
               WHERE p.r2_key = ?1 OR p.thumb_key = ?1 OR p.og_key = ?1 LIMIT 1`,
            )
            .bind(photoKey),
        ]
      : []),
  ];
  const [s, c, p] = await db.batch(stmts);
  const map = new Map((s.results as { key: string; value: string; at: string }[]).map((r) => [r.key, r]));
  const limit = Number(map.get("photo_read_limit")?.value);
  const status: SiteStatus = {
    paused: map.get("paused")?.value === "1",
    pausedAt: map.get("paused")?.value === "1" ? (map.get("paused")?.at ?? null) : null,
    pausedReason: map.get("paused_reason")?.value ?? "",
    reads: ((c.results[0] as { value: number } | undefined)?.value ?? 0) + pendingReads,
    readLimit: Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_READ_LIMIT,
    photoDaily: (() => {
      const n = Number(map.get("daily_photo_limit")?.value);
      return Number.isInteger(n) && n > 0 ? n : DEFAULT_QUOTA.photo;
    })(),
  };
  const row = p?.results[0] as
    | {
        ownerId: string; purpose: string; shareNo: number | null; photoDeleted: string | null; isMain: number; handle: string | null;
        shareFound: number | null; shareHidden: string | null; shareDeleted: string | null;
      }
    | undefined;
  const photo = row ? { ownerId: row.ownerId, purpose: row.purpose, shareNo: row.shareNo, isMain: row.isMain === 1, handle: row.handle ?? "" } : null;
  /** 這張照片還能不能公開給人看：資料庫沒有這張、照片已刪、掛的收藏不見／被隱藏／被刪 → 不行 */
  const gone =
    !row || !!row.photoDeleted || (row.shareNo !== null && (row.shareFound === null || !!row.shareHidden || !!row.shareDeleted));
  return { status, photo, gone };
}

/** 記一次 R2 讀取；累積到 FLUSH_EVERY 才寫 D1 */
export async function countRead() {
  pendingReads += 1;
  if (pendingReads < FLUSH_EVERY) return;
  const n = pendingReads;
  pendingReads = 0;
  try {
    await env
      .DB!.prepare(`INSERT INTO counters (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = value + excluded.value`)
      .bind(monthKey(), n)
      .run();
  } catch {
    pendingReads += n;
  }
}

async function put(key: string, value: string) {
  await getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString() } });
}

/** 進入／解除暫停模式。by＝管理員 id，或 "system"（webhook） */
export async function setPaused(paused: boolean, by: string, reason: string, detail: Record<string, unknown> = {}) {
  await put("paused", paused ? "1" : "0");
  await put("paused_reason", paused ? reason : "");
  await getDb()
    .insert(adminLog)
    .values({ adminId: by, action: paused ? "進入暫停模式" : "解除暫停模式", target: "paused", detail: JSON.stringify({ reason, ...detail }) });
}

export async function setReadLimit(by: string, n: number) {
  await put("photo_read_limit", String(n));
  await getDb().insert(adminLog).values({ adminId: by, action: "調整照片讀取門檻", target: "photo_read_limit", detail: JSON.stringify({ to: n }) });
}

/** 暫停或超過讀取門檻時的佔位圖（不讀 R2、不快取） */
export function placeholder(reason: "paused" | "limit") {
  const text = reason === "paused" ? "照片暫停顯示" : "本月照片流量已滿";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480" viewBox="0 0 480 480"><rect width="480" height="480" fill="#E6E6E6"/><text x="240" y="248" text-anchor="middle" font-family="Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif" font-size="26" font-weight="600" fill="#4A4A4A">${text}</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Photo-Placeholder": reason,
    },
  });
}

/** 常數時間比對（webhook 密鑰） */
export function safeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** 搜尋引擎收錄開關：環境變數 ALLOW_INDEXING=1 才開放，預設不收錄 */
export const indexingAllowed = () => env.ALLOW_INDEXING === "1";
