import { AdminShell } from "@/components/admin-shell";
import { AdminDuplicates } from "@/components/admin-duplicates";

export const metadata = { title: "疑似重複藝人｜管理後台" };

export default async function DuplicatesPage() {
  return (
    <AdminShell current="/admin/duplicates">
      <AdminDuplicates />
    </AdminShell>
  );
}
