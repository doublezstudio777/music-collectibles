import { notFound } from "next/navigation";
import { pageData } from "@/lib/server/viewer";
import { OwnedChecklist } from "@/components/owned-checklist";
import { validSlug } from "@/lib/server/me";

type Props = { params: Promise<{ artist: string }> };

export async function generateMetadata({ params }: Props) {
  const { c } = await pageData();
  const a = c.getArtist((await params).artist);
  return { title: a ? `我收藏的 ${a.name}` : "找不到這位藝人" };
}

/**
 * 我收藏了哪些（2026-10-01 一次發多張）：一位藝人的全部系列與版本，勾了就是「我有」（沿用 holdings）。
 * 在 /me 底下：不進整頁快取、不收錄（proxy.ts 對 /me 加 X-Robots-Tag）。勾的狀態由前端從 /api/me 疊上去
 */
export default async function OwnedPage({ params }: Props) {
  const slug = (await params).artist;
  if (!validSlug(slug)) notFound();
  const { c } = await pageData();
  const a = c.getArtist(slug);
  if (!a) notFound();
  return (
    <main className="wrap page own-page">
      <OwnedChecklist artist={{ slug: a.slug, name: a.name, visible: c.artistVisible(a) }} series={c.pickSeriesOf(a.slug)} />
    </main>
  );
}
