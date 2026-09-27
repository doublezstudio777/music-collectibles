import { fail, json, requireUser } from "@/lib/server/auth";
import { submitArtistPhoto } from "@/lib/server/artist-photos";
import { handle } from "@/lib/server/trade";

/**
 * 投稿藝人照片（2026-09-28）：multipart image（主圖）、thumb（縮圖）、artist（藝人識別碼）、own＝1、license＝1、
 * occasion、date（選填）。投稿不公開，進後台「藝人照片」佇列。每人每日 5 張。
 * 先讀完 body 再檢查登入（本機 Miniflare 沒讀完 body 就回應，下一個請求會 503）
 */
export async function POST(req: Request) {
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  if (!form) return fail(400, "BAD_REQUEST", "要用 multipart 上傳");
  const f = form;
  return handle(async () => json(await submitArtistPhoto(s.user, f), 201));
}
