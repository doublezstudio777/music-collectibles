import { AdminShell } from "@/components/admin-shell";
import { AdminDmReports } from "@/components/admin-dm-reports";

export const metadata = { title: "私訊檢舉｜管理後台" };

export default async function DmReportsPage() {
  return (
    <AdminShell current="/admin/dm-reports">
      <AdminDmReports />
    </AdminShell>
  );
}
