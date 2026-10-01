"use client";

// 條款更新公告（2026-10-01）：小版本更新（例：隱私權政策 1.1 補 Google Analytics）不強制重新同意，改成網站公告。
// 畫面底部一條，關掉之後這台瀏覽器不再出現；生效後 30 天自動不再顯示。
// 固定在底部、掛載後才出現，不推動頁面內容，整頁快取的 HTML 也不受影響。
// 發文表單、合集表單、勾選頁、後台底部有自己的黏底列，這些頁不顯示。
import Link from "@/components/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TERMS_NOTICE } from "@/lib/legal";

const HIDE = /^\/(share\/(new|batch|collection)|me\/owned|admin)/;
const key = (v: string) => `lmb_terms_notice_${v}`;

export function TermsNotice() {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const n = TERMS_NOTICE;
    if (!n) return;
    const until = Date.parse(`${n.effective}T00:00:00+08:00`) + 30 * 86400_000;
    let seen = false;
    try {
      seen = localStorage.getItem(key(n.version)) === "1";
    } catch {
      /* 無痕模式讀不到就照樣顯示 */
    }
    // 掛載後才決定顯示（伺服器輸出一律不顯示），不是同步狀態
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(!seen && Date.now() < until);
  }, []);
  if (!show || !TERMS_NOTICE || HIDE.test(pathname ?? "")) return null;
  const n = TERMS_NOTICE;
  const close = () => {
    try {
      localStorage.setItem(key(n.version), "1");
    } catch {
      /* 存不了就只關這一次 */
    }
    setShow(false);
  };
  return (
    <div className="terms-notice" role="region" aria-label="條款更新公告" data-testid="terms-notice">
      <p>
        {n.text}，{n.effective.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, "$2 月 $3 日")}生效，不用重新同意。
        <Link className="link" href={n.href}>
          看全文
        </Link>
      </p>
      <button type="button" className="terms-notice-x" aria-label="關閉公告" onClick={close}>
        ×
      </button>
    </div>
  );
}
