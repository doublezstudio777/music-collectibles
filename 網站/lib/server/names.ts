// 暱稱規則（2026-09-28 法務頁與帳號設定）：
// - 全站唯一：比對鍵＝NFKC（全形半形統一）→ 小寫 → 拿掉所有空白與零寬字元。「Abc」「ａｂｃ」「a b c」算同一個
// - 保留字：已刪除的會員、館長、站名這類字會員不能用（管理員不受限）
// - 自己改暱稱每 30 天一次；改名紀錄只有管理員看得到
// - 已刪除的帳號不參加比對（名字一律是「已刪除的會員」，name_key 為 NULL）
// 上線前的舊帳號沒有 name_key：每次比對前先補上（補完之後只是一次空的索引查詢）。
// 不設唯一索引：正式站舊帳號可能已經重複，唯一索引會讓遷移失敗；重複的舊帳號不自動改名，列給使用者看。

import { env } from "cloudflare:workers";
import { CURATOR } from "@/lib/levels";
import { SITE_NAME } from "@/lib/data";

export const DELETED_NAME = "已刪除的會員";
export const NAME_CHANGE_DAYS = 30;

export const nameKey = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[\s​-‍⁠﻿]/g, "");

/** 名字裡只要含有就不行 */
const CONTAINS = [DELETED_NAME, CURATOR, SITE_NAME, "樂迷藏", "音藏", "管理員", "站長"].map(nameKey);
/** 整個名字等於才不行 */
const EXACT = ["官方", "客服", "系統", "管理者", "admin", "administrator", "system", "yinzang", "moderator"].map(nameKey);

export function reservedName(name: string) {
  const k = nameKey(name);
  return EXACT.includes(k) || CONTAINS.some((w) => w && k.includes(w));
}

/**
 * 還沒有 name_key 的帳號補上（一次最多 500 位）。每次比對前都查一次：name_key 有索引，
 * 全部補完之後這一句只是一次空的索引查詢；不用 isolate 旗標，因為帳號可能從別的路徑寫進來
 */
export async function backfillNameKeys() {
  const db = env.DB!;
  const r = await db.prepare(`SELECT id, name FROM users WHERE name_key IS NULL AND status != 'deleted' LIMIT 500`).all<{ id: string; name: string }>();
  const rows = r.results ?? [];
  for (let i = 0; i < rows.length; i += 50) {
    await db.batch(rows.slice(i, i + 50).map((u) => db.prepare(`UPDATE users SET name_key = ?1 WHERE id = ?2`).bind(nameKey(u.name), u.id)));
  }
}

/** 這個暱稱有沒有別人用（except＝自己的 id） */
export async function nameTaken(name: string, except = "") {
  await backfillNameKeys();
  const row = await env
    .DB!.prepare(`SELECT id FROM users WHERE name_key = ?1 AND status != 'deleted' AND id != ?2 LIMIT 1`)
    .bind(nameKey(name), except)
    .first<{ id: string }>();
  return Boolean(row);
}

/** 暱稱有問題回訊息，沒問題回 null。max＝字數上限（註冊 20、設定頁 30，沿用既有規則） */
export async function nameProblem(name: string, opts: { max: number; except?: string; admin?: boolean }) {
  if (!name || Array.from(name).length > opts.max) return { code: "INVALID_NAME", message: `暱稱 1～${opts.max} 字` };
  if (!nameKey(name)) return { code: "INVALID_NAME", message: "暱稱不能只有空白" };
  if (!opts.admin && reservedName(name)) return { code: "NAME_RESERVED", message: "這個暱稱保留給網站用，換一個" };
  if (await nameTaken(name, opts.except)) return { code: "NAME_TAKEN", message: "這個暱稱有人用了，換一個" };
  return null;
}

/** 下次可以改暱稱的時間（ISO）；現在就能改回 null */
export function nextNameChange(changedAt: string | null | undefined, now = Date.now()) {
  if (!changedAt) return null;
  const next = Date.parse(changedAt) + NAME_CHANGE_DAYS * 86400_000;
  return next > now ? new Date(next).toISOString() : null;
}
