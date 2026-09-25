import { ShareForm } from "@/components/share-form";

export const metadata = { title: "炫收藏" };

export default function NewSharePage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">炫收藏</h1>
      <ShareForm />
    </main>
  );
}
