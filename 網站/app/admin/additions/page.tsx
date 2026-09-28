import { AdminShell } from "@/components/admin-shell";
import { AdminAdditions } from "@/components/admin-additions";

export const metadata = { title: "待確認的新增｜管理後台" };

export default async function AdditionsPage() {
  return (
    <AdminShell current="/admin/additions">
      <AdminAdditions />
    </AdminShell>
  );
}
