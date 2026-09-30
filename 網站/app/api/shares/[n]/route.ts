import { requireConsented } from "@/lib/server/terms";
import { json, readBody } from "@/lib/server/auth";
import { handle, HttpError } from "@/lib/server/trade";
import { getCatalog } from "@/lib/server/content";
import { editShare, publicOffers, setSale } from "@/lib/server/trade";
import { tradeBlocked } from "@/lib/server/geo";

const num = async (p: Promise<Record<string, string>>, k: string) => {
  const v = Number((await p)[k]);
  if (!Number.isInteger(v) || v <= 0) throw new HttpError(404, "NOT_FOUND", "找不到");
  return v;
};

/** 單則：內容＋公開出價列表 */
export async function GET(_req: Request, ctx: { params: Promise<{ n: string }> }) {
  return handle(async () => {
    const n = await num(ctx.params, "n");
    const c = await getCatalog();
    const s = c.getShare(n);
    if (!s) throw new HttpError(404, "NOT_FOUND", "找不到這則收藏");
    return json({ share: c.toDetailView(s), offers: await publicOffers(n) });
  });
}

/** 作者改出售狀態：{ state: share|offer|sale, price? } */
export async function PATCH(req: Request, ctx: { params: Promise<{ n: string }> }) {
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const body = await readBody(req);
  // 開放出價、定價出售、改價都算交易，要在台灣；改回純分享（下架）海外也可以
  if (body.state !== "share") {
    const blocked = tradeBlocked(req);
    if (blocked) return blocked;
  }
  return handle(async () => {
    await setSale(s.user, await num(ctx.params, "n"), body.state, body.price);
    return json({ ok: true });
  });
}

/**
 * 發文者編輯已發布的內容（2026-09-28）：{ about, seriesKey?, itemId?, versionId?, kind?, kindNote?, story, tags, sale? }
 * 發文者以外（管理員除外）一律 403；出售狀態改成開放出價／定價出售一樣要在台灣
 */
export async function PUT(req: Request, ctx: { params: Promise<{ n: string }> }) {
  // 先把 body 讀完再判斷登入：沒讀完就回 401，本機 Miniflare 同一條連線的下一個請求會卡住
  const body = await readBody(req);
  const s = await requireConsented(req);
  if (s instanceof Response) return s;
  const sale = body.sale as { state?: unknown } | undefined;
  if (sale && sale.state !== "share") {
    const blocked = tradeBlocked(req);
    if (blocked) return blocked;
  }
  return handle(async () => json(await editShare(s.user, await num(ctx.params, "n"), body)));
}
