import { pageData } from "@/lib/server/viewer";
import { BatchPost } from "@/components/batch-post";
import { validHoldingKey } from "@/lib/server/me";
import type { BatchEntry } from "@/lib/catalog";

export const metadata = { title: "一起發文" };

type Props = { searchParams: Promise<{ keys?: string; from?: string }> };

/**
 * 一次發多張（2026-10-01）：從「我收藏了哪些」或合集「挑幾張單獨發文」帶過來的專輯（?keys=鍵,鍵），
 * 統一選交易狀態 → 每張放照片、寫說明（可以個別改）→ 一次發布，產生 N 則獨立的收藏。
 * 草稿存在這台瀏覽器（localStorage）；不在整頁快取名單裡、不收錄
 */
export default async function BatchPage({ searchParams }: Props) {
  const raw = ((await searchParams).keys ?? "").split(",").filter(validHoldingKey).slice(0, 60);
  const { c } = await pageData();
  const entries = Array.from(new Set(raw))
    .map((k) => c.batchEntryOf(k))
    .filter((x): x is BatchEntry => x !== null);
  return (
    <main id="main" className="wrap page sf-page bp-page">
      <h1 className="page-title">一起發文</h1>
      <BatchPost entries={entries} />
    </main>
  );
}
