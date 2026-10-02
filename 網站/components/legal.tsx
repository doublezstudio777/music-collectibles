import Link from "@/components/link";
import { TERMS_EFFECTIVE, TERMS_VERSION } from "@/lib/legal";

/**
 * 隱私權政策、使用條款共用外框：頁首標示版本與生效日（2026-10-01 拿掉「草稿」），底下互相連結。
 * 版本與生效日在 lib/legal.ts，改內容時一起改。
 */
export function LegalPage({
  title,
  other,
  children,
  version = TERMS_VERSION,
  effective = TERMS_EFFECTIVE,
}: {
  title: string;
  other: { href: string; label: string };
  children: React.ReactNode;
  /** 舊版全文頁（/privacy/v1-0）用：標示那一版的版本與生效日 */
  version?: string;
  effective?: string;
}) {
  return (
    <main id="main" className="wrap page page-narrow legal">
      <p className="legal-version" data-testid="legal-version">
        <b>版本 {version}</b>
        <span>生效日 {effective}</span>
        {version !== TERMS_VERSION ? <span>（舊版，現行版本是 {TERMS_VERSION}）</span> : null}
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
