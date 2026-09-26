import { pageData } from "@/lib/server/viewer";
import { isAdmin } from "@/lib/server/auth";
import { Admin } from "@/components/admin";

export const metadata = { title: "管理後台" };

/** 只有管理員（環境變數 ADMIN_EMAILS 裡、Email 已驗證）進得去；API 另外再擋一次 */
export default async function AdminPage() {
  const { viewer } = await pageData();
  if (!isAdmin(viewer)) {
    return (
      <main className="wrap page">
        <h1 className="page-title">管理後台</h1>
        <p className="empty" data-testid="admin-denied">
          只有管理員進得去
        </p>
      </main>
    );
  }
  return (
    <main className="wrap page">
      <h1 className="page-title">管理後台</h1>
      <Admin />
    </main>
  );
}
