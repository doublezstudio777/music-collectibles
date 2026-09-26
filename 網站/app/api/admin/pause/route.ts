import { fail, json, readBody, requireAdmin } from "@/lib/server/auth";
import { setPaused, setReadLimit } from "@/lib/server/guard";

/** 暫停模式：{ paused: boolean }；照片讀取門檻：{ readLimit: number } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  if (typeof b.paused === "boolean") {
    await setPaused(b.paused, s.user.id, b.paused ? "管理員手動暫停" : "管理員解除");
    return json({ ok: true, paused: b.paused });
  }
  if (typeof b.readLimit === "number" && Number.isInteger(b.readLimit) && b.readLimit >= 1 && b.readLimit <= 10_000_000) {
    await setReadLimit(s.user.id, b.readLimit);
    return json({ ok: true, readLimit: b.readLimit });
  }
  return fail(400, "BAD_REQUEST", "參數不對");
}
