import { requireConsented } from "@/lib/server/terms";
import { json, readBody, requireUser } from "@/lib/server/auth";
import { handle, HttpError, setSharePhotos, sharePhotoList } from "@/lib/server/trade";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 作者編輯照片用：目前的照片清單（依順序，第一張是封面） */
export async function GET(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  return handle(async () => json({ photos: await sharePhotoList(s.user, await num(ctx.params, "n")) }));
}

/** 作者存照片：{ photoIds: 新順序 }，原有的沒列進來就刪掉（R2 一起刪） */
export async function PUT(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  return handle(async () => json(await setSharePhotos(s.user, await num(ctx.params, "n"), body.photoIds, new URL(req.url).origin)));
}
