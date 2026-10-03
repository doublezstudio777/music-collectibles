import { AdminShell } from "@/components/admin-shell";
import { AdminStatus } from "@/components/admin-status";

export const metadata = { title: "網站狀態｜管理後台" };

export default async function StatusAdminPage() {
  return (
    <AdminShell current="/admin/status">
      <AdminStatus />
    </AdminShell>
  );
}
