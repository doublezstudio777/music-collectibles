import { AdminShell } from "@/components/admin-shell";
import { AdminTakedowns } from "@/components/admin-takedowns";

export const metadata = { title: "侵權通知｜管理後台" };

export default async function TakedownsPage() {
  return (
    <AdminShell current="/admin/takedowns">
      <AdminTakedowns />
    </AdminShell>
  );
}
