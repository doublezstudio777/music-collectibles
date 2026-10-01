import { waitUntil } from "cloudflare:workers";
import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { runAutofill } from "@/lib/server/autofill";
import { scanState, startReleaseScan } from "@/lib/server/release-scan";
import { getDb } from "@/db";
import { adminLog } from "@/db/schema";
import { handle } from "@/lib/server/trade";

/** 後台「待確認的新增」上方的每月補新作品狀態（進度、建了哪些、疑義清單） */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  return json({ state: await scanState() }, 200, { "Cache-Control": "no-store" });
}

/**
 * { action: start } 現在開一輪（不等月初；之後每 10 分鐘的排程會接著分批查完）；
 * { action: run } 接著查一批（背景跑，跟排程同一支、同一把鎖，最多 25 秒）。兩者都立刻回應，進度用 GET 看
 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const action = str(b.action);
  return handle(async () => {
    if (action !== "start" && action !== "run") return fail(400, "BAD_REQUEST", "參數不對");
    if (action === "start") {
      await startReleaseScan({ trigger: "manual" });
      await getDb().insert(adminLog).values({ adminId: s.user.id, action: "手動開始每月補新作品", target: "release_scan", detail: "{}" });
    }
    waitUntil(runAutofill({ ms: 25_000, maxCalls: 20, scan: true }).catch((e) => console.error("[每月補新作品] 手動執行失敗", e)));
    return json({ ok: true, state: await scanState() });
  });
}
