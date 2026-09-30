import { GuideContent } from "@/components/guide-content";
import { seoMeta, ldJson, breadcrumbLd, HOME_CRUMB } from "@/lib/server/seo";
import { SITE_NAME } from "@/lib/data";

export async function generateMetadata() {
  return seoMeta({
    path: "/guide",
    title: "新手指南",
    description: `第一次來${SITE_NAME}：怎麼炫收藏、補專輯與版本資料、開價出售、回報疑似盜版，還有等級與稱號怎麼算。`,
    photo: null,
  });
}

export default function GuidePage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">新手指南</h1>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([breadcrumbLd([HOME_CRUMB, { name: "新手指南", path: "/guide" }])]) }} />
      <GuideContent />
    </main>
  );
}
