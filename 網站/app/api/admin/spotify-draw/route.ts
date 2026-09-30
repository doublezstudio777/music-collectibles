import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { drawStatus, runSpotifyDraw, sampleArtist } from "@/lib/server/spotify-draw";
import { handle } from "@/lib/server/trade";

/** 後台「推薦歌曲」上方的自動抽歌狀態 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json(await drawStatus(), 200, { "Cache-Control": "no-store" });
}

/**
 * { action: run } 手動跑一批（跟排程同一支，抽完讓首頁換新）；
 * { action: sample, artist, times } 同一位藝人連抽 times 次（最多 20，不寫資料庫，驗多樣性用）
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const action = str(b.action);
  return handle(async () => {
    if (action === "run") return json(await runSpotifyDraw({ publish: true }));
    if (action === "sample") {
      const times = Math.min(20, Math.max(1, Number(b.times) || 20));
      const r = await sampleArtist(str(b.artist), times);
      return r ? json(r) : fail(404, "NOT_FOUND", "這位藝人沒有對應 Spotify");
    }
    return fail(400, "BAD_REQUEST", "參數不對");
  });
}
