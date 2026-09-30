import { requireConsented } from "@/lib/server/terms";
import { fail, json, readBody } from "@/lib/server/auth";
import { renameAddition } from "@/lib/server/additions";
import { handle } from "@/lib/server/trade";
import { hit } from "@/lib/server/services";

/** 改自己新增的名稱：{ type: artist|series|version, ref, name, year?, region? }。新增者本人或管理員，永遠可以改，每次改都留紀錄 */
export async function POST(req: Request) {
  const b = await readBody(req);
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  return handle(async () => {
    if (!(await hit(`rename-add:${s.user.id}`, 60, 3600))) return fail(429, "RATE_LIMITED", "改太多次了，等一下再試");
    return json(await renameAddition(s.user, b.type, b.ref, b.name, b.year, b.region));
  });
}
