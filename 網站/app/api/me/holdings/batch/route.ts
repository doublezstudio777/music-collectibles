import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import { env } from "cloudflare:workers";
import { holdingLevel, validHoldingKey } from "@/lib/server/me";
import { hit } from "@/lib/server/services";

/** 一次最多幾個鍵 */
const MAX_KEYS = 200;

/**
 * 一次登記多個「我有」（2026-10-01 一次發多張：合集「把這些也登記成擁有」）。
 * { keys: string[] } → { added: string[], missing: string[] }。只做「設成有」，不會取消任何一個；
 * 找不到的鍵（被隱藏、刪除、合併）回在 missing，其餘照樣登記。存在性用內容目錄查（不逐一打 D1）
 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  const raw = Array.isArray(body.keys) ? body.keys : null;
  if (!raw || raw.length === 0 || raw.length > MAX_KEYS || !raw.every(validHoldingKey)) return fail(400, "BAD_REQUEST", "參數不對");
  if (!(await hit(`hold-batch:${s.user.id}`, 60, 3600))) return fail(429, "RATE_LIMITED", "太頻繁了，等一下再試");
  const c = await getCatalog();
  const keys = Array.from(new Set(raw as string[]));
  const exists = (k: string) => {
    const lv = holdingLevel(k);
    return lv === "series" ? Boolean(c.getSeriesByKey(k)) : lv === "item" ? Boolean(c.resolveItemKey(k)) : Boolean(c.resolveVersionKey(k));
  };
  const added = keys.filter(exists);
  // 一句寫完（D1 每次請求的查詢數有上限）：鍵已經過 validHoldingKey（只有小寫英數、連字號、/、#），可以直接放進字串
  if (added.length) {
    await env
      .DB!.prepare(`INSERT OR IGNORE INTO holdings (user_id, kind, target_key) VALUES ${added.map((k) => `(?1, 'owned', '${k}')`).join(",")}`)
      .bind(s.user.id)
      .run();
  }
  return json({ added, missing: keys.filter((k) => !added.includes(k)) });
}
