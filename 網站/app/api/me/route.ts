import { currentUser, json, publicMe } from "@/lib/server/auth";
import { myState } from "@/lib/server/me";
import { canTrade, requestCountry, touchActivity } from "@/lib/server/geo";

/**
 * 目前登入的使用者＋個人狀態（點讚、我有、想要、追蹤），網頁開站只打這一支。
 * 沒登入回 { user: null, state: null }，不是錯誤。
 * geo：當下連線國家與能不能交易（交易只限台灣；按鈕顯示用，真正的擋在各交易 API）。
 * 登入者順便記今天的活動國家（所在地區與活躍人數用，每人每天最多寫一次）。
 */
export async function GET(req: Request) {
  const s = await currentUser(req);
  const geo = { country: requestCountry(req), canTrade: canTrade(req) };
  if (s) await touchActivity(s.user.id, req);
  return json(
    s ? { user: publicMe(s.user), state: await myState(s.user.id), geo } : { user: null, state: null, geo },
    200,
    { "Cache-Control": "no-store" },
  );
}
