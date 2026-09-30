import Link from "next/link";

/** 法務頁最後更新日期（兩頁共用；改內容時一起改） */
export const LEGAL_UPDATED = "2026-09-30";

/** 隱私權政策、使用條款共用外框：頁首標示草稿與最後更新日期，底下互相連結 */
export function LegalPage({ title, other, children }: { title: string; other: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <main className="wrap page page-narrow legal">
      <p className="legal-draft" data-testid="legal-draft">
        <b>草稿，待律師確認</b>
        <span>最後更新 {LEGAL_UPDATED}</span>
      </p>
      <h1 className="page-title">{title}</h1>
      {children}
      <p className="legal-other">
        <Link href={other.href}>{other.label}</Link>
      </p>
    </main>
  );
}
