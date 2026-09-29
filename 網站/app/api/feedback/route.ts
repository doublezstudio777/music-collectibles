import { clientIp, fail, json, tokenFrom, userByToken } from "@/lib/server/auth";
import { submitFeedback } from "@/lib/server/feedback";
import { verifyTurnstile } from "@/lib/server/services";
import { handle } from "@/lib/server/trade";

/**
 * 意見回饋：multipart（kind、body、email、turnstileToken，選填 image＋thumb）。未登入也能送；
 * Turnstile 一律要過，每個 IP 每小時 5 則。已登入沒填 Email 就用帳號的 Email
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, "BAD_REQUEST", "參數不對");
  }
  if (!(await verifyTurnstile(form.get("turnstileToken"), clientIp(req)))) {
    return fail(400, "TURNSTILE_FAILED", "機器人驗證沒過，重新整理再試一次");
  }
  const t = tokenFrom(req);
  const s = t ? await userByToken(t.token) : null;
  const file = (k: string) => {
    const v = form.get(k);
    return v && typeof v !== "string" ? (v as File) : null;
  };
  return handle(async () =>
    json(
      await submitFeedback(s?.user ?? null, clientIp(req), {
        kind: form.get("kind"),
        body: form.get("body"),
        email: form.get("email"),
        image: file("image"),
        thumb: file("thumb"),
      }),
      201,
    ),
  );
}
