import { fail, json, requireUser } from "@/lib/server/auth";
import { acceptUpload, removeUnattached, isPaused, MAX_MAIN_BYTES, MAX_OG_BYTES, MAX_THUMB_BYTES, STORAGE_LIMIT, storageUsed } from "@/lib/server/photos";

/** 表單開啟時問一次：上傳是不是暫停（暫停模式，或剩下的容量放不下一張最大的照片＋預覽圖） */
export async function GET() {
  const paused = (await isPaused()) || (await storageUsed()) + MAX_MAIN_BYTES + MAX_THUMB_BYTES + MAX_OG_BYTES > STORAGE_LIMIT;
  return json({ paused });
}

/**
 * multipart：image（主圖，長邊約 1600px WebP）、thumb（縮圖）、og（選配，1200×630 分享預覽圖 JPEG）、purpose（share｜appeal）。
 * 瀏覽器端先壓縮／畫好；伺服器端再看檔頭格式、大小、每日上限、總容量，不處理影像本身。
 */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "BAD_REQUEST", "要用 multipart 上傳");
  }
  const pick = (k: string) => {
    const v = form.get(k);
    return v && typeof v !== "string" ? (v as File) : null;
  };
  const purpose = form.get("purpose") === "appeal" ? "appeal" : "share";
  const r = await acceptUpload(s.user.id, purpose, pick("image"), pick("thumb"), pick("og"));
  if (!r.ok) return fail(r.error.status, r.error.code, r.error.message);
  return json({ id: r.id, url: r.url, thumbUrl: r.thumbUrl, ...(r.ogUrl ? { ogUrl: r.ogUrl } : {}) }, 201);
}

/** 表單裡刪掉還沒發布的照片：?id=照片 id（只能刪自己的、還沒掛到收藏的），R2 一起刪、容量扣回 */
export async function DELETE(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const ok = await removeUnattached(new URL(req.url).origin, s.user.id, id);
  return ok ? json({ ok: true }) : fail(404, "NOT_FOUND", "找不到這張照片");
}
