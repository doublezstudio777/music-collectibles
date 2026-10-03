"use client";

// 條款更新公告（2026-10-01）：小版本更新（例：隱私權政策 1.1 補 Google Analytics）不強制重新同意，改成網站公告。
// 畫面底部一條，關掉之後這台瀏覽器不再出現；生效後 30 天自動不再顯示。
// 固定在底部、掛載後才出現，不推動頁面內容，整頁快取的 HTML 也不受影響。
// 發文表單、合集表單、勾選頁、後台底部有自己的黏底列，這些頁不顯示。
//
// 2026-10-03 用戶回報 iPhone「按完一次，下一次進來又有」：關掉的狀態原本只存 localStorage，
// iPhone 上 Safari、無痕、LINE／FB 內建瀏覽器、加到主畫面各自一份，LINE 點進來每次都是新的；1.1 換 1.2 也會再出現一次。
// 改成三層，任一層說「關過了」就不顯示：
//   1. localStorage lmb_terms_notice_{版本}（原本的）
//   2. 第一方 cookie lmb_tn=版本：/api/notice 由伺服器發（一年），前端同時先寫一份
//   3. 登入會員：伺服器 user_notices（/api/me 的 noticeSeen），以及同意過的條款版本 ≥ 公告版本（註冊時就同意新版的不用再看）
// 只看「最新一版」：cookie 與伺服器存的是版本號，比較用 ≥，關過新版就不會再看到舊版
import Link from "@/components/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TERMS_NOTICE, versionAtLeast } from "@/lib/legal";
import { api, useAccount } from "@/lib/account";

const HIDE = /^\/(share\/(new|batch|collection)|me\/owned|admin)/;
const key = (v: string) => `lmb_terms_notice_${v}`;
const COOKIE = "lmb_tn";

function seenHere(v: string) {
  let seen = false;
  try {
    seen = localStorage.getItem(key(v)) === "1";
  } catch {
    /* 無痕模式讀不到就看 cookie */
  }
  const c = document.cookie.match(/(?:^|;\s*)lmb_tn=([^;]*)/)?.[1];
  return seen || versionAtLeast(c ? decodeURIComponent(c) : null, v);
}

export function TermsNotice() {
  const pathname = usePathname();
  const acc = useAccount();
  // null＝還沒在瀏覽器端判斷（伺服器輸出與第一次 hydration 一律不顯示）
  const [local, setLocal] = useState<boolean | null>(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    const n = TERMS_NOTICE;
    if (!n) return;
    const until = Date.parse(`${n.effective}T00:00:00+08:00`) + 30 * 86400_000;
    // 掛載後才決定顯示，不是同步狀態
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(Date.now() < until && !seenHere(n.version));
  }, []);
  const n = TERMS_NOTICE;
  if (!n || !local || closed || HIDE.test(pathname ?? "")) return null;
  // 等 /api/me 回來再決定，登入會員不會先閃一下
  if (acc.status === "loading") return null;
  if (acc.me && (versionAtLeast(acc.me.noticeSeen, n.version) || versionAtLeast(acc.me.termsVersion, n.version))) return null;
  const close = () => {
    try {
      localStorage.setItem(key(n.version), "1");
    } catch {
      /* 存不了就靠 cookie */
    }
    const secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${COOKIE}=${encodeURIComponent(n.version)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setClosed(true);
    // 伺服器再發一次 cookie（不受 Safari 對前端 cookie 的 7 天上限），登入會員另外記在帳號上
    void api("/api/notice", { body: { version: n.version } });
  };
  return (
    <div className="terms-notice" role="region" aria-label="條款更新公告" data-testid="terms-notice">
      <p>
        {n.text}，{n.effective.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, "$2 月 $3 日")}生效。
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
