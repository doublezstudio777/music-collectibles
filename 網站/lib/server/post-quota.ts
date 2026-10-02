// 今天還能發幾則、還能上傳幾張（2026-10-01 一次發多張）：批次發文先問一次，超過的那幾張在發布前就標出來。
// 數字讀的是 /api/shares、/api/uploads 實際在用的同一組計數（rate_limits 的 share:{id}:{日}、upload:{id}:{日}），
// 這裡只讀不寫；真正擋的還是那兩支 API。

import { env } from "cloudflare:workers";
import { DAILY_UPLOADS, MAX_SHARE_PHOTOS } from "@/lib/server/photos";
import { SHARE_DAILY } from "@/lib/server/trade";
import { taiwanDay } from "@/lib/server/services";

export async function postQuota(userId: string) {
  const day = taiwanDay();
  const rows = await env
    .DB!.prepare("SELECT key, count, reset_at AS resetAt FROM rate_limits WHERE key IN (?1, ?2)")
    .bind(`share:${userId}:${day}`, `upload:${userId}:${day}`)
    .all<{ key: string; count: number; resetAt: string }>();
  const used = (prefix: string) => {
    const r = rows.results.find((x) => x.key.startsWith(prefix));
    return r && Date.parse(r.resetAt) > Date.now() ? r.count : 0;
  };
  const shares = used("share:");
  const uploads = used("upload:");
  return {
    shares: { used: shares, limit: SHARE_DAILY, left: Math.max(0, SHARE_DAILY - shares) },
    uploads: { used: uploads, limit: DAILY_UPLOADS, left: Math.max(0, DAILY_UPLOADS - uploads) },
    maxPhotos: MAX_SHARE_PHOTOS,
  };
}
