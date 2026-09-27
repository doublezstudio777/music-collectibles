import { env } from "cloudflare:workers";
import { currentUser, json } from "@/lib/server/auth";

/**
 * 讚數、我有／想要人數（2026-09-28 起按讚不再讓整頁快取作廢，數字改由這支小請求取得）。
 * GET /api/counts?s=12&s=13&v={版本鍵}&v=…
 * 回傳「扣掉請求者自己」的人數：前端顯示＝這個數＋自己有沒有按，按了馬上變，不會有先後順序的問題。
 * 沒登入就是總數。各最多 90 個（D1 單一查詢參數上限 100）。不快取。
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const nos = Array.from(new Set(q.getAll("s").map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, 90);
  const keys = Array.from(new Set(q.getAll("v").filter((k) => k && k.length <= 200))).slice(0, 90);
  const s = await currentUser(req);
  const me = s?.user.id ?? "";
  const db = env.DB!;
  const stmts = [];
  if (nos.length) {
    stmts.push(
      db
        .prepare(`SELECT share_no AS k, COUNT(*) AS c FROM likes WHERE user_id != ?1 AND share_no IN (${nos.map((_, i) => `?${i + 2}`).join(",")}) GROUP BY share_no`)
        .bind(me, ...nos),
    );
  }
  if (keys.length) {
    stmts.push(
      db
        .prepare(
          `SELECT target_key AS k, kind, COUNT(*) AS c FROM holdings WHERE user_id != ?1 AND target_key IN (${keys.map((_, i) => `?${i + 2}`).join(",")}) GROUP BY target_key, kind`,
        )
        .bind(me, ...keys),
    );
  }
  const res = stmts.length ? await db.batch(stmts) : [];
  const likes: Record<string, number> = Object.fromEntries(nos.map((n) => [n, 0]));
  const owned: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  const wanted: Record<string, number> = { ...owned };
  let i = 0;
  if (nos.length) for (const r of res[i++].results as { k: number; c: number }[]) likes[r.k] = r.c;
  if (keys.length) {
    for (const r of res[i++].results as { k: string; kind: string; c: number }[]) {
      if (r.kind === "owned") owned[r.k] = r.c;
      else if (r.kind === "wanted") wanted[r.k] = r.c;
    }
  }
  return json({ likes, owned, wanted }, 200, { "Cache-Control": "no-store" });
}
