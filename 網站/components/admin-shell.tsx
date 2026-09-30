import Link from "next/link";
import { getViewer } from "@/lib/server/viewer";
import { isAdmin } from "@/lib/server/auth";

const TABS = [
  { href: "/admin", label: "儀表板" },
  { href: "/admin/moderation", label: "審核與下架" },
  { href: "/admin/error-reports", label: "錯誤回報" },
  { href: "/admin/dm-reports", label: "私訊檢舉" },
  { href: "/admin/feedback", label: "意見回饋" },
  { href: "/admin/additions", label: "待確認的新增" },
  { href: "/admin/members", label: "會員" },
  { href: "/admin/duplicates", label: "疑似重複藝人" },
  { href: "/admin/artist-photos", label: "藝人照片" },
  { href: "/admin/spotify-picks", label: "推薦歌曲" },
  { href: "/admin/seo", label: "SEO" },
  { href: "/admin/deletions", label: "刪帳申請" },
  { href: "/admin/takedowns", label: "侵權通知" },
] as const;

/**
 * 管理後台外框：只有管理員（ADMIN_EMAILS 裡、Email 已驗證）看得到內容，其他人一律「只有管理員進得去」。
 * 頁面這裡擋一次，每支 /api/admin/* 再用 requireAdmin 擋一次。
 */
export async function AdminShell({ current, children }: { current: (typeof TABS)[number]["href"]; children: React.ReactNode }) {
  const viewer = await getViewer();
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
      <nav className="admin-tabs" aria-label="管理後台">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className="admin-tab" aria-current={t.href === current ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
