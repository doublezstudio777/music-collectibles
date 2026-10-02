import { requireConsented } from "@/lib/server/terms";
import { fail, json, requireUser } from "@/lib/server/auth";
import { removeAvatar, uploadAvatar } from "@/lib/server/avatars";
import { handle } from "@/lib/server/trade";

/**
 * 換大頭貼：multipart image（瀏覽器端已裁正方形、壓成 256×256 WebP）。一天最多 5 次。
 * 先讀完 body 再檢查登入（本機 Miniflare 沒讀完 body 就回應，下一個請求會 503）
 */
export async function POST(req: Request) {
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  if (!form) return fail(400, "BAD_REQUEST", "要用 multipart 上傳");
  const v = form.get("image");
  const file = v && typeof v !== "string" ? (v as File) : null;
  return handle(async () => json(await uploadAvatar(s.user, file, new URL(req.url).origin), 201));
}

/** 移除自己的大頭貼，回到暱稱字樣頭像 */
export async function DELETE(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return handle(async () => json(await removeAvatar(s.user, new URL(req.url).origin)));
}
