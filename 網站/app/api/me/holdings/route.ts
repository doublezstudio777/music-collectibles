import { fail, json, readBody, requireUser } from "@/lib/server/auth";
import { contentKeyExists, setHolding, validVersionKey } from "@/lib/server/me";

/** { kind: "owned"|"wanted", key: 版本鍵, on: true|false } */
export async function POST(req: Request) {
  const s = await requireUser(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  const kind = body.kind === "owned" || body.kind === "wanted" ? body.kind : null;
  if (!kind || !validVersionKey(body.key) || typeof body.on !== "boolean") return fail(400, "BAD_REQUEST", "參數不對");
  if (body.on && !(await contentKeyExists(body.key as string, "version"))) return fail(404, "NOT_FOUND", "找不到這個版本");
  await setHolding(s.user.id, kind, body.key, body.on);
  return json({ kind, key: body.key, on: body.on });
}
