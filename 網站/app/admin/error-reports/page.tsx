import { AdminShell } from "@/components/admin-shell";
import { AdminErrorReports } from "@/components/admin-error-reports";

export const metadata = { title: "錯誤回報｜管理後台" };

export default async function ErrorReportsPage() {
  return (
    <AdminShell current="/admin/error-reports">
      <AdminErrorReports />
    </AdminShell>
  );
}
