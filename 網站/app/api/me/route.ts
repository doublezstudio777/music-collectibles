import { currentUser, json, publicMe } from "@/lib/server/auth";
import { myState } from "@/lib/server/me";

/**
 * 目前登入的使用者＋個人狀態（點讚、我有、想要、追蹤），網頁開站只打這一支。
 * 沒登入回 { user: null, state: null }，不是錯誤。
 */
export async function GET(req: Request) {
  const s = await currentUser(req);
  return json(
    s ? { user: publicMe(s.user), state: await myState(s.user.id) } : { user: null, state: null },
    200,
    { "Cache-Control": "no-store" },
  );
}
