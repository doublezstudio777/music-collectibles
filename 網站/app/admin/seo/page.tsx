import { AdminShell } from "@/components/admin-shell";
import { AdminSeo } from "@/components/admin-seo";
import { isSeoTarget } from "@/lib/seo";

export const metadata = { title: "SEO｜管理後台" };

type Props = { searchParams: Promise<{ target?: string }> };

export default async function SeoAdminPage({ searchParams }: Props) {
  const t = (await searchParams).target ?? "";
  return (
    <AdminShell current="/admin/seo">
      <AdminSeo initial={isSeoTarget(t) ? t : undefined} />
    </AdminShell>
  );
}
