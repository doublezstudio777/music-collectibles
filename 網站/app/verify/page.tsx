// 照片查證（2026-09-29）：輸入照片浮水印上的查證碼，查這張照片原本屬於哪一則收藏。
// 不進整頁快取（worker.ts CACHEABLE 沒列），每次查詢都算同一個 IP 的次數（lib/server/verify.ts）。
// 露出多少：收藏公開中才給縮圖、標題、發文者、發布日期；下架的只說是哪位會員；已刪帳號只說「已刪除的會員」。
import Link from "next/link";
import { headers } from "next/headers";
import { normVerifyCode, SITE_NAME, shareHref, userHref } from "@/lib/data";
import { photoUrl } from "@/lib/server/content";
import { pageData } from "@/lib/server/viewer";
import { lookupVerifyCode, verifyAllowed, type VerifyRow } from "@/lib/server/verify";

export const metadata = { title: "照片查證" };

type Props = { searchParams?: Promise<{ c?: string }> };

/** 台灣時間 YYYY/MM/DD */
const twDate = (iso: string) => {
  const d = new Date(Date.parse(iso) + 8 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}`;
};

type Outcome =
  | { kind: "none" }
  | { kind: "limited" }
  | { kind: "notFound"; code: string }
  | { kind: "gone"; code: string; who: string; what: "收藏" | "照片" }
  | { kind: "found"; code: string; n: number; title: string; thumb: string; date: string; author: { name: string; handle: string } | null };

async function check(raw: string): Promise<Outcome> {
  if (!raw.trim()) return { kind: "none" };
  const h = await headers();
  if (!(await verifyAllowed(h.get("cf-connecting-ip")))) return { kind: "limited" };
  const code = normVerifyCode(raw);
  const row = code ? await lookupVerifyCode(code) : null;
  if (!code || !row || row.shareNo === null) return { kind: "notFound", code: code || raw.trim().slice(0, 12) };
  return present(code, row);
}

async function present(code: string, row: VerifyRow): Promise<Outcome> {
  const deletedUser = row.userStatus === "deleted" || !row.handle || row.handle.startsWith("del-");
  const who = deletedUser ? "已刪除的會員" : `${SITE_NAME}會員 @${row.handle}`;
  const { c } = await pageData();
  const share = !row.shareGone && row.shareNo !== null ? c.getShare(row.shareNo) : undefined;
  if (!share) return { kind: "gone", code, who, what: "收藏" };
  if (row.photoDeleted) return { kind: "gone", code, who, what: "照片" };
  return {
    kind: "found",
    code,
    n: share.n,
    title: share.what,
    thumb: photoUrl(row.thumbKey),
    date: row.createdAt ? twDate(row.createdAt) : "",
    author: deletedUser ? null : { name: share.authorName ?? row.name ?? share.author, handle: row.handle! },
  };
}

export default async function VerifyPage({ searchParams }: Props) {
  const raw = String((await searchParams)?.c ?? "").slice(0, 40);
  const r = await check(raw);
  return (
    <main className="wrap page page-narrow">
      <h1 className="page-title">照片查證</h1>
      <form className="verify-form" action="/verify" method="get" data-testid="verify-form">
        <label className="field-label" htmlFor="verify-code">
          查證碼
        </label>
        <div className="verify-row">
          <input
            id="verify-code"
            name="c"
            className="input verify-input"
            defaultValue={raw}
            maxLength={12}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="verify-input"
          />
          <button type="submit" className="btn btn-p" data-testid="verify-submit">
            查詢
          </button>
        </div>
      </form>
      <Result r={r} />
    </main>
  );
}

function Result({ r }: { r: Outcome }) {
  if (r.kind === "none") return null;
  if (r.kind === "limited")
    return (
      <p className="verify-msg" role="alert" data-testid="verify-limited">
        查詢次數太多，一小時後再查
      </p>
    );
  if (r.kind === "notFound")
    return (
      <p className="verify-msg" role="status" data-testid="verify-none">
        查無此查證碼
      </p>
    );
  if (r.kind === "gone")
    return (
      <p className="verify-msg" role="status" data-testid="verify-gone">
        這張照片來自{r.who}，{r.what}已下架
      </p>
    );
  return (
    <section className="verify-card" data-testid="verify-found">
      <Link className="verify-thumb" href={shareHref(r.n)} tabIndex={-1} aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={r.thumb} alt="" width={120} height={120} />
      </Link>
      <dl className="verify-dl">
        <dt>查證碼</dt>
        <dd className="verify-code">#{r.code}</dd>
        <dt>收藏</dt>
        <dd>
          <Link className="link" href={shareHref(r.n)} data-testid="verify-share">
            {r.title}
          </Link>
        </dd>
        <dt>發文者</dt>
        <dd>
          {r.author ? (
            <Link className="link" href={userHref(r.author.handle)} data-testid="verify-author">
              {r.author.name} @{r.author.handle}
            </Link>
          ) : (
            "已刪除的會員"
          )}
        </dd>
        {r.date ? (
          <>
            <dt>發布日期</dt>
            <dd>{r.date}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
