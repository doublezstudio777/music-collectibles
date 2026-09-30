import { passwordIterations } from "@/lib/server/services";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  clientIp, fail, handleProblem, json, normEmail, readBody, sendCode, str, userByEmail, userByHandle,
  validEmail, validPassword,
} from "@/lib/server/auth";
import { hashPassword, randomToken } from "@/lib/server/crypto";
import { hit, verifyTurnstile } from "@/lib/server/services";
import { recordRegister } from "@/lib/server/geo";
import { nameKey, nameProblem } from "@/lib/server/names";
import { recordConsent } from "@/lib/server/terms";
import { TERMS_VERSION } from "@/lib/legal";

/** 註冊：Email＋密碼＋帳號名＋顯示名稱。成功後寄 6 位數驗證碼，驗證完才算登入 */
export async function POST(req: Request) {
  const body = await readBody(req);
  if (!(await verifyTurnstile(body.turnstileToken, clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const handle = str(body.handle).toLowerCase();
  const name = str(body.name);
  if (!validEmail(email)) return fail(400, "INVALID_EMAIL", "Email 格式不對");
  if (!validPassword(password)) return fail(400, "WEAK_PASSWORD", "密碼至少 8 個字");
  const hp = handleProblem(handle);
  if (hp) return fail(400, "INVALID_HANDLE", hp);
  if (!name || Array.from(name).length > 20) return fail(400, "INVALID_NAME", "顯示名稱 1～20 字");
  // 條款同意（2026-10-01 法務修正 M2）：必勾，版本要是現行版（頁面開著期間改版就請重新整理）
  if (body.agreeTerms !== true) return fail(400, "TERMS_REQUIRED", "勾選同意使用條款與隱私權政策才能註冊");
  if (body.termsVersion !== TERMS_VERSION) return fail(409, "TERMS_CHANGED", "使用條款剛更新，重新整理頁面再註冊");
  if (!(await hit(`register:${clientIp(req) ?? "local"}`, 10, 3600))) {
    return fail(429, "RATE_LIMITED", "註冊太多次了，一小時後再試");
  }
  if (await userByEmail(email)) return fail(409, "EMAIL_TAKEN", "這個 Email 已經註冊過，直接登入就好");
  if (await userByHandle(handle)) return fail(409, "HANDLE_TAKEN", "這個帳號名有人用了");
  // 暱稱全站唯一、保留字（2026-09-28）
  const np = await nameProblem(name, { max: 20 });
  if (np) return fail(np.code === "NAME_TAKEN" ? 409 : 400, np.code, np.message);

  const [user] = await getDb()
    .insert(users)
    .values({ id: randomToken(12), email, passwordHash: await hashPassword(password, passwordIterations()), handle, name, nameKey: nameKey(name) })
    .returning();
  await recordConsent(user.id, TERMS_VERSION, "register");
  await recordRegister(user.id, req);
  await sendCode(user, "verify");
  return json({ pending: "verify", email }, 201);
}
