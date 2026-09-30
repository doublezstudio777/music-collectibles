import { fail, json, readBody, requireAdmin, str } from "@/lib/server/auth";
import { clearSeoOg, saveSeo, saveSite, seoForm, seoOverrides, seoSearch, uploadSeoOg } from "@/lib/server/seo-admin";
import { seoContext } from "@/lib/server/seo";
import { handle } from "@/lib/server/trade";
import { isSeoTarget } from "@/lib/seo";

/**
 * 後台 SEO（2026-10-01）：
 * GET ?target=artist:{slug}｜series:{slug}/{no}｜page:home｜page:about → 這頁的自動值、覆寫值、收錄判斷
 * GET ?q=關鍵字 → 找藝人、系列；不帶參數 → 全站設定＋有覆寫過的清單
 * POST JSON { action: save, target, title, description, noindex }｜{ action: site, suffix, description }｜{ action: clear-og, target }
 * POST multipart { target, image }（og 圖 1200×630）
 * 先讀完 body 再檢查登入（本機 Miniflare 沒讀完 body 就回應，下一個請求會 503）
 */
export async function GET(req: Request) {
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const url = new URL(req.url);
  const target = url.searchParams.get("target");
  const q = url.searchParams.get("q");
  return handle(async () => {
    if (target !== null) {
      if (!isSeoTarget(target)) return fail(400, "BAD_REQUEST", "對象不對");
      return json(await seoForm(target), 200, { "Cache-Control": "no-store" });
    }
    if (q !== null) return json({ list: await seoSearch(q.slice(0, 40)) }, 200, { "Cache-Control": "no-store" });
    const ctx = await seoContext();
    return json({ site: ctx.site, overrides: await seoOverrides() }, 200, { "Cache-Control": "no-store" });
  });
}

export async function POST(req: Request) {
  const multipart = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let form: FormData | null = null;
  let b: Record<string, unknown> = {};
  if (multipart) {
    try {
      form = await req.formData();
    } catch {
      form = null;
    }
  } else b = await readBody(req);
  const s = await requireAdmin(req);
  if (s instanceof Response) return s;
  const origin = new URL(req.url).origin;
  return handle(async () => {
    if (multipart) {
      const target = String(form?.get("target") ?? "");
      if (!form || !isSeoTarget(target)) return fail(400, "BAD_REQUEST", "參數不對");
      const v = form.get("image");
      return json(await uploadSeoOg(s.user, target, v && typeof v !== "string" ? (v as File) : null, origin), 201);
    }
    const action = str(b.action);
    if (action === "site") return json(await saveSite(s.user, b));
    const target = str(b.target);
    if (!isSeoTarget(target)) return fail(400, "BAD_REQUEST", "對象不對");
    if (action === "save") return json(await saveSeo(s.user, target, b));
    if (action === "clear-og") return json(await clearSeoOg(s.user, target, origin));
    return fail(400, "BAD_REQUEST", "參數不對");
  });
}
