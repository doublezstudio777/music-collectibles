import { json, requireUser } from "@/lib/server/auth";
import { myThreads } from "@/lib/server/trade";

/** 我的私訊（買家或賣家） */
export async function GET(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return json({ threads: await myThreads(s.user) });
}
