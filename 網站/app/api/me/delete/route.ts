import { json, readBody, requireUser } from "@/lib/server/auth";
import { cancelDeletion, requestDeletion } from "@/lib/server/deletion";
import { handle } from "@/lib/server/trade";

/**
 * 申請刪除帳號（2026-09-28 改申請制）：{ reason }。不會立刻刪除，管理員在後台「刪帳申請」執行；
 * 處理前帳號照常可用，可以取消。刪什麼、留什麼見 lib/server/deletion.ts
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return handle(async () => json({ ok: true, ...(await requestDeletion(s.user, b.reason)) }, 201));
}

/** 取消申請 */
export async function DELETE(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  await cancelDeletion(s.user);
  return json({ ok: true });
}
