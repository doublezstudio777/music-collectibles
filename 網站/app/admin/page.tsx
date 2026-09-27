import { AdminShell } from "@/components/admin-shell";
import { AdminDashboard } from "@/components/admin-dashboard";

export const metadata = { title: "管理後台" };

export default async function AdminPage() {
  return (
    <AdminShell current="/admin">
      <AdminDashboard />
    </AdminShell>
  );
}
