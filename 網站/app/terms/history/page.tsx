import Link from "@/components/link";
import { TERMS_HISTORY } from "@/lib/legal";

// 條款歷史版本（2026-10-01，使用條款第 18 條第 4 項）。改版時在 lib/legal.ts 的 TERMS_HISTORY 補一列，舊版全文另存一頁連過來
export const metadata = { title: "使用條款與隱私權政策歷史版本" };

// 2026-10-02：「現行」照台灣日期算，不寫死在最新版上（1.1 是 10-01 公告、10-08 才生效，公告期間現行的仍是 1.0）。
// 每次請求現算，不讓建置當下的日期被存起來
export const dynamic = "force-dynamic";

/** 台灣日期 YYYY-MM-DD */
const todayTW = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
/** 2026-10-08 → 10/08 */
const md = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;

export default function TermsHistoryPage() {
  const today = todayTW();
  // 現行＝已生效的版本裡最新的一版（TERMS_HISTORY 新的在前）
  const current = TERMS_HISTORY.find((h) => h.effective <= today)?.version;
  return (
    <main className="wrap page page-narrow legal">
      <h1 className="page-title">使用條款與隱私權政策歷史版本</h1>
      <p>每次修改都會加一個版本號，舊版全文留在這裡可以查。使用條款與隱私權政策一起改版，版本號相同。</p>
      <div className="tbl-scroll">
        <table className="tbl legal-tbl" data-testid="terms-history">
          <thead>
            <tr>
              <th>版本</th>
              <th>生效日</th>
              <th>說明</th>
              <th>全文</th>
            </tr>
          </thead>
          <tbody>
            {TERMS_HISTORY.map((h) => (
              <tr key={h.version}>
                <td>
                  {h.version}
                  {h.effective > today ? `（${md(h.effective)} 生效）` : h.version === current ? "（現行）" : ""}
                </td>
                <td data-label="生效日">{h.effective}</td>
                <td data-label="說明">{h.note}</td>
                <td data-label="全文">
                  <Link href={h.terms}>使用條款</Link>、<Link href={h.privacy}>隱私權政策</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="legal-meta">2026 年 10 月 1 日以前網站上的條款標示為草稿，不列入版本。</p>
    </main>
  );
}
