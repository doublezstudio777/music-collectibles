import { overrideOf, overridePhoto, pick, seoContext, seoMeta, ldJson, breadcrumbLd, HOME_CRUMB } from "@/lib/server/seo";
import { clipWidth, DESC_MAX } from "@/lib/seo";
import { SITE_NAME } from "@/lib/data";
import Link from "@/components/link";
import { ABOUT_PARAS } from "@/lib/about";
import { TAGLINE_END, TAGLINE_FIRST, TAGLINE_LINK_HREF, TAGLINE_LINK_TEXT, TAGLINE_REST_BEFORE_LINK } from "@/lib/tagline";


// 關於頁 metadata（2026-10-01 SEO）：後台可覆寫標題、描述、og 圖、不收錄
export async function generateMetadata() {
  const ctx = await seoContext();
  const o = overrideOf(ctx, "page:about");
  return seoMeta({
    path: "/about",
    title: pick(o.title, `關於${SITE_NAME}`),
    description: pick(o.description, clipWidth(ABOUT_PARAS[0], DESC_MAX)),
    photo: overridePhoto(o),
    index: !o.noindex,
  });
}

export default function AboutPage() {
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">關於{SITE_NAME}</h1>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson([breadcrumbLd([HOME_CRUMB, { name: `關於${SITE_NAME}`, path: "/about" }])]) }} />
      <section className="block prose">
        {/* 首頁標語全文（2026-09-30 使用者定稿），放在站長四段前面；四段不動 */}
        <p className="about-lede" data-testid="about-tagline">
          {TAGLINE_FIRST}
          {TAGLINE_REST_BEFORE_LINK}
          <Link className="link" href={TAGLINE_LINK_HREF}>
            {TAGLINE_LINK_TEXT}
          </Link>
          {TAGLINE_END}
        </p>
        {ABOUT_PARAS.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        <p className="about-sign">{SITE_NAME}站長</p>
      </section>
    </main>
  );
}
