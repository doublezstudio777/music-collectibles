import { DeleteRequest } from "@/components/delete-request";

export const metadata = { title: "申請刪除帳號" };

export default function DeleteRequestPage() {
  return (
    <main id="main" className="wrap page page-narrow">
      <h1 className="page-title">申請刪除帳號</h1>
      <DeleteRequest />
    </main>
  );
}
