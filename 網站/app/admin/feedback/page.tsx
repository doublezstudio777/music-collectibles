import { AdminShell } from "@/components/admin-shell";
import { AdminFeedback } from "@/components/admin-feedback";

export const metadata = { title: "意見回饋｜管理後台" };

export default async function FeedbackAdminPage() {
  return (
    <AdminShell current="/admin/feedback">
      <AdminFeedback />
    </AdminShell>
  );
}
