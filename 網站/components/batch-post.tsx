"use client";

// 一次發多張（2026-10-01）：先統一選交易狀態，再逐張放照片、寫說明（每張可以個別改），最後一次發布，產生 N 則獨立的收藏。
//
// - 發布照舊一則一則打 POST /api/shares（同一套驗證：同意條款、交易只限台灣、每日上限、照片要是自己剛上傳的）
// - 每日上限（發文 30 則、上傳 30 張）先問 /api/shares/quota：超過的那幾張在發布前就標「這次發不了」，不送
// - 照片上傳跟炫收藏表單同一套（瀏覽器燒浮水印＋查證碼），選了就傳
// - 草稿存這台瀏覽器的 localStorage（每位會員一份）：專輯、說明、交易設定、已經傳好的照片；中途離開回來照樣在。
//   發好的那幾張從草稿拿掉，發不了的留著明天再發

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "@/components/link";
import { api, useAccount, whenLoggedIn } from "@/lib/account";
import { useAppState } from "@/lib/state";
import { uploadCoverOg } from "@/lib/image";
import { PHOTO_LICENSE_URL, SITE_NAME, shareHref, type SaleState } from "@/lib/data";
import type { BatchEntry } from "@/lib/catalog";
import { PhotoPicker, usePhotoPicker, type PickedPhoto } from "@/components/photo-picker";
import { MoneyInput, parsePrice, RegionNote } from "@/components/share-detail";
import { track } from "@/lib/analytics";

type Trade = Exclude<SaleState, "sold">;
const TRADES: { key: Trade; label: string }[] = [
  { key: "share", label: "純分享" },
  { key: "offer", label: "開放出價" },
  { key: "sale", label: "定價出售" },
];

/** 存進草稿的照片：已經上傳好的才存（id、網址、查證碼） */
type DraftPhoto = { id: string; url: string; code?: string };
type Row = BatchEntry & {
  story: string;
  trade: Trade;
  /** 這張自己改過交易狀態（統一設定再變不會蓋掉） */
  own: boolean;
  price: string;
  photos: DraftPhoto[];
};
type Draft = { v: 1; trade: Trade; rows: Row[] };
type Quota = { shares: { left: number; limit: number }; uploads: { left: number; limit: number }; maxPhotos: number };
type Result = { key: string; label: string; n?: number; error?: string };

const draftKey = (handle: string) => `yz_batch:${handle}`;
const readDraft = (handle: string): Draft | null => {
  try {
    const d = JSON.parse(localStorage.getItem(draftKey(handle)) ?? "null") as Draft | null;
    return d && d.v === 1 && Array.isArray(d.rows) ? d : null;
  } catch {
    return null;
  }
};
const toRow = (e: BatchEntry, trade: Trade): Row => ({ ...e, story: "", trade, own: false, price: "", photos: [] });

export function BatchPost({ entries }: { entries: BatchEntry[] }) {
  const acc = useAccount();
  const handle = acc.me?.handle ?? "";
  if (acc.status === "loading") return <p role="status">讀取中</p>;
  if (!handle) {
    return (
      <p className="empty">
        <button type="button" className="btn btn-line" onClick={() => whenLoggedIn("登入後才能發文", () => undefined)}>
          登入
        </button>
      </p>
    );
  }
  return <Body key={handle} handle={handle} entries={entries} />;
}

function Body({ handle, entries }: { handle: string; entries: BatchEntry[] }) {
  const acc = useAccount();
  const canTrade = acc.geo.canTrade;
  // 草稿＋這次帶進來的（同一張以草稿為準，草稿裡多的照樣留著）
  const [init] = useState(() => {
    const d = typeof window === "undefined" ? null : readDraft(handle);
    const trade: Trade = d?.trade ?? "share";
    const fromDraft = new Map((d?.rows ?? []).map((r) => [r.key, r]));
    const rows = [...entries.map((e) => fromDraft.get(e.key) ?? toRow(e, trade)), ...(d?.rows ?? []).filter((r) => !entries.some((e) => e.key === r.key))];
    return { trade, rows, restored: Boolean(d?.rows.length) };
  });
  const [trade, setTrade] = useState<Trade>(init.trade);
  const [rows, setRows] = useState<Row[]>(init.rows);
  const [restored, setRestored] = useState(init.restored);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);
  const [paused, setPaused] = useState(false);
  /** 每張的照片狀態（上傳中、失敗）由各自的 picker 回報 */
  const [live, setLive] = useState<Record<string, PickedPhoto[]>>({});

  const loadQuota = useCallback(() => {
    void api<Quota>("/api/shares/quota").then((r) => r.ok && setQuota(r.data));
  }, []);
  useEffect(() => {
    loadQuota();
    void api<{ paused: boolean }>("/api/uploads").then((r) => r.ok && setPaused(r.data.paused));
  }, [loadQuota]);

  // 草稿：有變就存；全部發完就清掉
  useEffect(() => {
    try {
      if (rows.length) localStorage.setItem(draftKey(handle), JSON.stringify({ v: 1, trade, rows } satisfies Draft));
      else localStorage.removeItem(draftKey(handle));
    } catch {
      /* 無痕模式存不了就算了 */
    }
  }, [rows, trade, handle]);

  const patch = (key: string, p: Partial<Row>) => setRows((xs) => xs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const onPhotos = useCallback((key: string, items: PickedPhoto[]) => {
    setLive((m) => ({ ...m, [key]: items }));
    const done = items.filter((x) => x.status === "done" && x.id && x.url).map((x) => ({ id: x.id!, url: x.url!, ...(x.code ? { code: x.code } : {}) }));
    setRows((xs) => xs.map((r) => (r.key === key && JSON.stringify(r.photos) !== JSON.stringify(done) ? { ...r, photos: done } : r)));
  }, []);
  const remove = (key: string) => {
    // 已經傳好、還沒發的照片一起從伺服器刪掉
    for (const p of rows.find((r) => r.key === key)?.photos ?? []) void api(`/api/uploads?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    setRows((xs) => xs.filter((r) => r.key !== key));
  };
  const setAllTrade = (t: Trade) => {
    setTrade(t);
    setRows((xs) => xs.map((r) => (r.own ? r : { ...r, trade: t })));
  };

  /* ---------- 每張的狀態 ---------- */
  const tradeOf = (r: Row): Trade => (canTrade ? r.trade : "share");
  const problem = (r: Row): string => {
    const items = live[r.key] ?? [];
    if (items.some((x) => x.status === "queued" || x.status === "uploading")) return "照片還在上傳";
    if (items.some((x) => x.status === "error")) return items.find((x) => x.status === "error")?.error || "有照片沒傳上去";
    if (!r.photos.length) return "還沒放照片";
    if (tradeOf(r) === "sale" && !parsePrice(r.price)) return "填一個整數金額";
    return "";
  };
  const ready = rows.filter((r) => !problem(r));
  const left = quota?.shares.left ?? Infinity;
  // 今天的發文額度依清單順序分給準備好的
  const overLimit = new Set(ready.slice(Math.max(0, left)).map((r) => r.key));
  const sendable = ready.filter((r) => !overLimit.has(r.key));

  const publish = () =>
    whenLoggedIn("登入後才能發文", async () => {
      setTried(true);
      if (!sendable.length) return;
      setBusy(true);
      const out: Result[] = [];
      for (const r of sendable) {
        const items = live[r.key] ?? [];
        const cover = items.find((x) => x.id === r.photos[0]?.id);
        await uploadCoverOg(r.photos[0].id, cover?.file ?? r.photos[0].url, handle, cover?.code ?? r.photos[0].code).catch(() => null);
        const t = tradeOf(r);
        const res = await api<{ n: number }>("/api/shares", {
          body: {
            photoIds: r.photos.map((p) => p.id),
            about: r.about,
            seriesKey: r.seriesKey,
            kind: r.kind,
            ...(r.itemId ? { itemId: r.itemId } : r.itemIds?.[r.kind] ? { itemId: r.itemIds[r.kind] } : {}),
            ...(r.versionId ? { versionId: r.versionId } : {}),
            story: r.story.trim(),
            tags: [],
            sale: t === "sale" ? { state: "sale", price: parsePrice(r.price) } : { state: t },
          },
        });
        if (res.ok) {
          out.push({ key: r.key, label: r.label, n: res.data.n });
          track("share_publish", { kind: "批次" });
        }
        else {
          out.push({ key: r.key, label: r.label, error: res.error.message });
          // 條款要先同意、或今天額度用完：後面的也不會過，停下來
          if (res.error.code === "TERMS_REQUIRED" || res.status === 429 || res.status === 401) break;
        }
      }
      const sent = new Set(out.filter((x) => x.n).map((x) => x.key));
      setRows((xs) => xs.filter((r) => !sent.has(r.key)));
      setResults(out);
      setBusy(false);
      loadQuota();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  const notSent = rows.filter((r) => !results?.some((x) => x.key === r.key && x.n));

  return (
    <div className="bp" data-testid="batch-post">
      {results ? <Results results={results} rows={notSent} overLimit={overLimit} quota={quota} /> : null}
      {restored && !results ? (
        <p className="bp-restored" role="status" data-testid="bp-restored">
          已接上這台瀏覽器裡的草稿
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              for (const r of rows) for (const p of r.photos) void api(`/api/uploads?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
              setRows(entries.map((e) => toRow(e, trade)));
              setRestored(false);
            }}
            data-testid="bp-clear-draft"
          >
            清掉草稿
          </button>
        </p>
      ) : null}

      {rows.length ? (
        <div className="sf bp-grid">
          <div className="sf-main">
          <section className="bp-common" aria-labelledby="bp-trade">
            <h2 className="field-label" id="bp-trade">
              交易狀態 <span className="sub-inline">每張可以個別改</span>
            </h2>
            {canTrade ? (
              <div className="seg" role="group" aria-labelledby="bp-trade" data-testid="bp-trade">
                {TRADES.map((t) => (
                  <button key={t.key} type="button" aria-pressed={trade === t.key} onClick={() => setAllTrade(t.key)} data-trade={t.key}>
                    {t.label}
                  </button>
                ))}
              </div>
            ) : (
              <RegionNote />
            )}
            {quota ? (
              <p className="bp-quota" data-testid="bp-quota">
                今天還能發 <b className="num">{quota.shares.left}</b> 則、上傳 <b className="num">{quota.uploads.left}</b> 張照片
              </p>
            ) : null}
          </section>

          <ol className="bp-list" data-testid="bp-list">
            {rows.map((r, i) => (
              <Entry
                key={r.key}
                i={i}
                row={r}
                trade={tradeOf(r)}
                canTrade={canTrade}
                handle={handle}
                paused={paused}
                onPaused={() => setPaused(true)}
                problem={tried || r.photos.length ? problem(r) : ""}
                over={overLimit.has(r.key) ? (quota?.shares.left ?? 0) : null}
                onPatch={(p) => patch(r.key, p)}
                onPhotos={onPhotos}
                onRemove={() => remove(r.key)}
              />
            ))}
          </ol>
          </div>

          <aside className="sf-summary bp-summary" aria-label="發布">
            <span className="sf-sum-text">
              <b className="sf-sum-title" data-testid="bp-sum">
                {sendable.length ? `可以發 ${sendable.length} 則` : "還沒有可以發的"}
              </b>
              <span className="sf-sum-missing" data-testid="bp-sum-missing">
                {[
                  rows.length - ready.length ? `${rows.length - ready.length} 則還沒準備好` : "",
                  overLimit.size ? `${overLimit.size} 則超過今天的上限，這次發不了` : "",
                ]
                  .filter(Boolean)
                  .join("、")}
              </span>
            </span>
            <span className="sf-license" data-testid="bp-license">
              發布即表示這些照片是你本人拍攝，並同意以{" "}
              <a className="link" href={PHOTO_LICENSE_URL} target="_blank" rel="license noopener">
                CC BY-NC-ND 4.0
              </a>{" "}
              授權他人非商業分享（須標示你與{SITE_NAME}、不得修改）。這項授權發布後無法撤回。詳見
              <a className="link" href="/terms#t7" target="_blank" rel="noopener">
                使用條款
              </a>
              。
            </span>
            <span className="sf-sum-acts">
              <button type="button" className="btn btn-p" disabled={busy || !sendable.length} onClick={publish} data-testid="bp-submit">
                {busy ? "發布中…" : sendable.length ? `發布 ${sendable.length} 則` : "發布"}
              </button>
            </span>
          </aside>
        </div>
      ) : results ? null : (
        <EmptyStart />
      )}
    </div>
  );
}

/** 直接打開 /share/batch（2026-10-02 建議 11）：說怎麼開始，連到追蹤的藝人的「我收藏了哪些」 */
function EmptyStart() {
  const { state, ready } = useAppState();
  const follows = ready ? state.follows.slice(0, 6) : [];
  return (
    <div className="bp-empty-box" data-testid="bp-empty">
      <p>還沒有要發的收藏。先到藝人頁按「我收藏了哪些」勾選，勾好再回來一起發文。</p>
      <div className="bp-empty-links">
        {follows.map((slug) => (
          <Link key={slug} className="btn btn-line" href={`/me/owned/${slug}`} data-testid="bp-empty-artist">
            勾選 {slug}
          </Link>
        ))}
        <Link className="btn btn-line" href="/artists">
          {follows.length ? "其他藝人" : "找藝人"}
        </Link>
      </div>
    </div>
  );
}

function Results({ results, rows, overLimit, quota }: { results: Result[]; rows: Row[]; overLimit: Set<string>; quota: Quota | null }) {
  const ok = results.filter((r) => r.n);
  const bad = results.filter((r) => !r.n);
  const skipped = rows.filter((r) => overLimit.has(r.key) && !bad.some((b) => b.key === r.key));
  return (
    <section className="bp-results" role="status" data-testid="bp-results">
      {ok.length ? (
        <>
          <h2 className="block-title">
            發好了 <span className="count">{ok.length}</span>
          </h2>
          <ul className="bp-res-list" data-testid="bp-ok">
            {ok.map((r) => (
              <li key={r.key}>
                <Link className="link" href={shareHref(r.n!)}>
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {bad.length || skipped.length ? (
        <>
          <h2 className="block-title">
            這次發不了 <span className="count">{bad.length + skipped.length}</span>
          </h2>
          <ul className="bp-res-list" data-testid="bp-bad">
            {bad.map((r) => (
              <li key={r.key} data-key={r.key}>
                {r.label}
                <span className="sub">{r.error}</span>
              </li>
            ))}
            {skipped.map((r) => (
              <li key={r.key} data-key={r.key}>
                {r.label}
                <span className="sub">今天的發文上限 {quota?.shares.limit ?? 30} 則已滿，草稿留著，明天再發</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function Entry({
  i,
  row,
  trade,
  canTrade,
  handle,
  paused,
  onPaused,
  problem,
  over,
  onPatch,
  onPhotos,
  onRemove,
}: {
  i: number;
  row: Row;
  trade: Trade;
  canTrade: boolean;
  handle: string;
  paused: boolean;
  onPaused: () => void;
  problem: string;
  /** 超過今天的發文上限：今天還能發幾則；沒超過是 null */
  over: number | null;
  onPatch: (p: Partial<Row>) => void;
  onPhotos: (key: string, items: PickedPhoto[]) => void;
  onRemove: () => void;
}) {
  const initial = useMemo<PickedPhoto[]>(() => row.photos.map((p) => ({ key: p.id, id: p.id, preview: p.url, url: p.url, code: p.code, status: "done" })), []); // eslint-disable-line react-hooks/exhaustive-deps -- 只在掛載時用草稿
  const picker = usePhotoPicker(initial, onPaused, handle);
  const sent = useRef("");
  useEffect(() => {
    const sig = picker.items.map((x) => `${x.key}:${x.status}:${x.id ?? ""}`).join("|");
    if (sig === sent.current) return;
    sent.current = sig;
    onPhotos(row.key, picker.items);
  }, [picker.items, onPhotos, row.key]);
  const labelId = `bp-photo-${i}`;
  return (
    <li className={`bp-entry${over !== null ? " is-over" : ""}`} data-key={row.key} data-testid="bp-entry">
      <div className="bp-head">
        <span className="bp-n">{i + 1}</span>
        <b className="bp-label" id={labelId}>
          {row.label}
        </b>
        <button type="button" className="btn-text bp-remove" onClick={onRemove} data-testid="bp-remove">
          不發這張
        </button>
      </div>
      {row.kinds.length > 1 ? (
        <div className="picks bp-kinds" role="group" aria-label="是什麼">
          {row.kinds.map((k) => (
            <button key={k} type="button" className="pick" aria-pressed={row.kind === k} onClick={() => onPatch({ kind: k })}>
              {k}
            </button>
          ))}
        </div>
      ) : null}
      <PhotoPicker picker={picker} labelId={labelId} paused={paused} />
      <label className="sr-only" htmlFor={`bp-story-${i}`}>
        想說的話
      </label>
      <textarea
        id={`bp-story-${i}`}
        className="input textarea bp-story"
        rows={2}
        maxLength={2000}
        placeholder="想說的話（選填）"
        value={row.story}
        onChange={(e) => onPatch({ story: e.target.value })}
        data-testid="bp-story"
      />
      {canTrade ? (
        <div className="bp-trade">
          <div className="seg seg-sm" role="group" aria-label={`第 ${i + 1} 張的交易狀態`} data-testid="bp-entry-trade">
            {TRADES.map((t) => (
              <button key={t.key} type="button" aria-pressed={trade === t.key} onClick={() => onPatch({ trade: t.key, own: true })} data-trade={t.key}>
                {t.label}
              </button>
            ))}
          </div>
          {trade === "sale" ? <MoneyInput id={`bp-price-${i}`} value={row.price} onChange={(v) => onPatch({ price: v })} label={`第 ${i + 1} 張的價格`} /> : null}
        </div>
      ) : null}
      {over !== null ? (
        <p className="bp-over" data-testid="bp-over">
          這次發不了：今天還能發 {over} 則
        </p>
      ) : problem ? (
        <p className="field-error" data-testid="bp-problem">
          {problem}
        </p>
      ) : null}
    </li>
  );
}
