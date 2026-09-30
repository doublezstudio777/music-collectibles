import Link from "@/components/link";
import { TERMS_EFFECTIVE, TERMS_VERSION } from "@/lib/legal";

/**
 * 隱私權政策、使用條款共用外框：頁首標示版本與生效日（2026-10-01 拿掉「草稿」），底下互相連結。
 * 版本與生效日在 lib/legal.ts，改內容時一起改。
 */
export function LegalPage({ title, other, children }: { title: string; other: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <main className="wrap page page-narrow legal">
      <p className="legal-version" data-testid="legal-version">
        <b>版本 {TERMS_VERSION}</b>
        <span>生效日 {TERMS_EFFECTIVE}</span>
        <Link href="/terms/history">歷史版本</Link>
      </p>
      <h1 className="page-title">{title}</h1>
      {children}
      <p className="legal-other">
        <Link href={other.href}>{other.label}</Link>
      </p>
    </main>
  );
}
