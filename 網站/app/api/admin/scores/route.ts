import { env } from "cloudflare:workers";
import { fail, json, readBody, requireAdmin } from "@/lib/server/auth";
import { recomputeScores } from "@/lib/server/scores";

/**
 * 立刻重算一次分數（正常由每天的 Cron 跑，這支給管理員手動觸發、也給本機驗收用）。
 * 本機（LOCAL_TEST=1）可帶 { now: ISO 時間 } 模擬未來的時間，驗「7 天後入帳」；正式站不收這個參數。
 */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  let now = new Date();
  if (b.now !== undefined) {
    if (env.LOCAL_TEST !== "1") return fail(400, "BAD_REQUEST", "參數不對");
    now = new Date(String(b.now));
    if (!Number.isFinite(now.getTime())) return fail(400, "BAD_REQUEST", "時間格式不對");
  }
  return json({ ok: true, ...(await recomputeScores(now)) });
}
