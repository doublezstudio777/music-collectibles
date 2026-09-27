import { AdminShell } from "@/components/admin-shell";
import { Admin } from "@/components/admin";

export const metadata = { title: "審核與下架｜管理後台" };

export default async function ModerationPage() {
  return (
    <AdminShell current="/admin/moderation">
      <Admin />
    </AdminShell>
  );
}
