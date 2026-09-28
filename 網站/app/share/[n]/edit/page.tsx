import Link from "next/link";
import { notFound } from "next/navigation";
import { shareHref } from "@/lib/data";
import { getViewer, pageData } from "@/lib/server/viewer";
import { ShareForm } from "@/components/share-form";
import { pendingSeriesOf } from "@/lib/server/series-link";

export const metadata = { title: "編輯炫收藏" };

type Props = { params: Promise<{ n: string }> };

/**
 * 發文者編輯已發布的炫收藏（2026-09-28）。這頁不在整頁快取名單裡（worker.ts CACHEABLE 只收 /share/{數字}），可以讀登入者。
 * 只有發文者看得到表單；真正的權限在 PUT /api/shares/{n} 判斷（非發文者 403、鎖定 423、已成交不能改出售）。
 */
export default async function EditSharePage({ params }: Props) {
  const n = Number((await params).n);
  const { c } = await pageData();
  const share = Number.isInteger(n) ? c.getShare(n) : undefined;
  if (!share) notFound();
  const viewer = await getViewer();
  const view = c.toShareView(share);
  const back = (
    <p>
      <Link className="link" href={shareHref(n)}>
        回到這則炫收藏
      </Link>
    </p>
  );
  if (!viewer || viewer.handle !== share.author) {
    return (
      <main className="wrap page page-narrow">
        <h1 className="page-title">編輯炫收藏</h1>
        <p className="empty" data-testid="edit-denied">
          只有發文者可以編輯這則
        </p>
        {back}
      </main>
    );
  }
  if (view.lock) {
    return (
      <main className="wrap page page-narrow">
        <h1 className="page-title">編輯炫收藏</h1>
        <p className="empty" data-testid="edit-locked">
          {view.lock.label}，暫時不能編輯
        </p>
        {back}
      </main>
    );
  }
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">編輯炫收藏</h1>
      <ShareForm
        options={c.formOptions(viewer.handle)}
        edit={{
          n,
          about: share.about,
          ...(view.link ? { seriesKey: view.link.seriesKey, itemId: view.link.itemId, versionId: view.link.versionId } : {}),
          kind: view.kind,
          kindNote: view.kindNote ?? "",
          story: share.story,
          tags: share.tags,
          sale: { state: view.sale.state, ...(view.sale.price ? { price: view.sale.price } : {}) },
          artists: c.formArtistsFor(share.about),
          pendingSeries: await pendingSeriesOf(n),
        }}
      />
    </main>
  );
}
