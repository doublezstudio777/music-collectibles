import { json, readBody, requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/trade";
import { setHidden } from "@/lib/server/takedown";
import { purgeSharePhotos } from "@/lib/server/photos";

/** 隱藏／恢復：{ type: artist|series|item|version|share, key, hidden } */
export async function POST(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const b = await readBody(req);
  return handle(async () => {
    // reason（選填）：下架炫收藏時寫進通知信與操作紀錄（2026-10-02 總檢 M2）
    const r = await setHidden(s.user, b.type, b.key, b.hidden, typeof b.reason === "string" ? b.reason.trim().slice(0, 200) : "");
    // 炫收藏隱藏：照片快取一併清（主圖＋縮圖）。/img/ 本身也會先查 D1 回 404，這裡是把副本丟掉
    let purged = 0;
    if (b.type === "share" && b.hidden === true) purged = await purgeSharePhotos(new URL(req.url).origin, Number(String(b.key).replace(/^\/?share\//, "")));
    return json({ ...r, purgedPhotos: purged });
  });
}
