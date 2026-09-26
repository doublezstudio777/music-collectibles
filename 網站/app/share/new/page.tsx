import { pageData } from "@/lib/server/viewer";
import { ShareForm } from "@/components/share-form";

export const metadata = { title: "炫收藏" };

export default async function NewSharePage() {
  const { c } = await pageData();
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">炫收藏</h1>
      <ShareForm options={c.formOptions()} />
    </main>
  );
}
