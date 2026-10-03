import { getViewer } from "@/lib/server/viewer";
import { isAdmin } from "@/lib/server/auth";
import { AdminNav } from "@/components/admin-nav";
import type { AdminHref } from "@/lib/admin-nav";

/**
 * 管理後台外框：只有管理員（ADMIN_EMAILS 裡、Email 已驗證）看得到內容，其他人一律「只有管理員進得去」。
 * 頁面這裡擋一次，每支 /api/admin/* 再用 requireAdmin 擋一次。
 * 2026-10-03 上方分頁改成左側選單（components/admin-nav.tsx），選單項目在 lib/admin-nav.ts。
 */
export async function AdminShell({ current, children }: { current: AdminHref; children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!isAdmin(viewer)) {
    return (
      <main id="main" className="wrap page">
        <h1 className="page-title">管理後台</h1>
        <p className="empty" data-testid="admin-denied">
          只有管理員進得去
        </p>
      </main>
    );
  }
  return (
    <div className="admin-layout">
      <AdminNav current={current} />
      <main id="main" className="admin-main">
        <h1 className="page-title">管理後台</h1>
        {children}
      </main>
    </div>
  );
}
