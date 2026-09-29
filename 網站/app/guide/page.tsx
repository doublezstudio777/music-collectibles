import { GuideContent } from "@/components/guide-content";
import { ogMeta } from "@/lib/server/og";
import { siteOrigin } from "@/lib/server/viewer";

export async function generateMetadata() {
  return ogMeta({
    origin: await siteOrigin(),
    path: "/guide",
    title: "新手指南",
    description: "炫收藏、補資料、買賣、回報、等級與稱號",
    photo: null,
  });
}

export default function GuidePage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">新手指南</h1>
      <GuideContent />
    </main>
  );
}
