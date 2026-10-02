import { pageData } from "@/lib/server/viewer";
import { CollectionForm } from "@/components/collection-form";
import { validSlug } from "@/lib/server/me";

export const metadata = { title: "發合集" };

type Props = { searchParams: Promise<{ artist?: string }> };

/**
 * 全家福合集發文（2026-10-01 一次發多張）。不在整頁快取名單裡（worker.ts 只收 /share/{數字}），不收錄（lib/seo.ts PRIVATE）。
 * ?artist=slug：從藝人相關的入口過來時先選好那位藝人
 */
export default async function NewCollectionPage({ searchParams }: Props) {
  const slug = (await searchParams).artist ?? "";
  const { c } = await pageData();
  const a = validSlug(slug) ? c.getArtist(slug) : undefined;
  return (
    <main id="main" className="wrap page sf-page">
      <h1 className="page-title">發合集</h1>
      <CollectionForm preset={a ? { slug: a.slug, name: a.name } : null} />
    </main>
  );
}
