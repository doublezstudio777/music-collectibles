import { AdminShell } from "@/components/admin-shell";
import { AdminMembers } from "@/components/admin-members";

export const metadata = { title: "會員｜管理後台" };

export default async function MembersPage() {
  return (
    <AdminShell current="/admin/members">
      <AdminMembers />
    </AdminShell>
  );
}
