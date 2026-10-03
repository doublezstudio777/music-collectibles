// 管理後台左側選單（2026-10-03，WordPress 式）。選單只看這一份。
//
// 新增一個後台頁：
//   1. 建 app/admin/{路徑}/page.tsx，外面包 <AdminShell current="/admin/{路徑}">
//   2. 在下面對應的分組加一行 { href, label }；有「待處理數字」再加 count
//   3. count 用到新的 key：在 AdminCountKey 加上，lib/server/admin-counts.ts 補一個計數（只算該頁列出、要你處理的那幾筆）
// 前後端都會 import，不能碰伺服器模組。

/** 待處理數字的來源（/api/admin/nav-counts 一次回傳全部） */
export type AdminCountKey =
  | "moderation"
  | "dmReports"
  | "takedowns"
  | "errorReports"
  | "additions"
  | "duplicates"
  | "artistPhotos"
  | "deletions"
  | "feedback";

export type AdminNavItem = { href: string; label: string; count?: AdminCountKey };
/** title 空字串＝不分組、不能收合（儀表板） */
export type AdminNavGroup = { id: string; title: string; items: AdminNavItem[] };

export const ADMIN_NAV = [
  { id: "home", title: "", items: [{ href: "/admin", label: "儀表板" }] },
  {
    id: "review",
    title: "審核",
    items: [
      { href: "/admin/moderation", label: "檢舉與下架", count: "moderation" },
      { href: "/admin/dm-reports", label: "私訊檢舉", count: "dmReports" },
      { href: "/admin/takedowns", label: "侵權通知", count: "takedowns" },
      { href: "/admin/error-reports", label: "錯誤回報", count: "errorReports" },
    ],
  },
  {
    id: "catalog",
    title: "資料庫",
    items: [
      { href: "/admin/additions", label: "待確認的新增", count: "additions" },
      { href: "/admin/duplicates", label: "疑似重複藝人", count: "duplicates" },
      { href: "/admin/artist-photos", label: "藝人照片", count: "artistPhotos" },
      { href: "/admin/spotify-picks", label: "推薦歌曲" },
    ],
  },
  {
    id: "members",
    title: "會員",
    items: [
      { href: "/admin/members", label: "會員管理" },
      { href: "/admin/deletions", label: "刪帳申請", count: "deletions" },
      { href: "/admin/feedback", label: "意見回饋", count: "feedback" },
    ],
  },
  {
    id: "site",
    title: "網站",
    items: [
      { href: "/admin/seo", label: "SEO" },
      { href: "/admin/status", label: "網站狀態" },
    ],
  },
] as const satisfies readonly AdminNavGroup[];

/** 所有後台頁的網址（AdminShell 的 current 只能填這些） */
export type AdminHref = (typeof ADMIN_NAV)[number]["items"][number]["href"];

export type AdminCounts = Record<AdminCountKey, number>;
