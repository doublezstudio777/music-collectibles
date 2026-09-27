import { AdminShell } from "@/components/admin-shell";
import { AdminDeletions } from "@/components/admin-deletions";

export const metadata = { title: "刪帳申請｜管理後台" };

export default async function DeletionsPage() {
  return (
    <AdminShell current="/admin/deletions">
      <AdminDeletions />
    </AdminShell>
  );
}
