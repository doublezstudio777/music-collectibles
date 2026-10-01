"use client";

import Link from "@/components/link";
import { useEffect, useState } from "react";
import { priceText, shareHref, userHref, type Sale, type ShareView } from "@/lib/data";
import { SaveMsg, useSave } from "@/components/save-status";
import { api, openPanel, refreshAccount, useAccount } from "@/lib/account";
import type { PublicOffer, ThreadMessage, ThreadRowView } from "@/lib/server/trade";
import { Ava } from "@/components/ava";
import { UnreadBadge } from "@/components/site-header";
import { Photo } from "@/components/share-card";
import { MoneyInput, RegionNote, parsePrice } from "@/components/share-detail";
import { track } from "@/lib/analytics";

/** 所在地區（國家層級）；沒有紀錄就不顯示 */
const regionText = (r?: string) => (r ? ` · 所在地區 ${r}` : "");

const saleLine = (sale: Sale) =>
  sale.state === "sale"
    ? `定價出售 ${priceText(sale.price ?? 0)}`
    : sale.state === "offer"
      ? "開放出價"
      : sale.state === "sold"
        ? "已售出"
        : "純分享";

type Row = ThreadRowView;
type Person = { handle: string; name: string; avatar?: string | null };

type Detail = {
  thread: {
    id: number;
    shareNo: number;
    direct: boolean;
    iAmSeller: boolean;
    buyer: Person;
    seller: Person;
    other: Person;
    buyerRegion?: string;
    sellerRegion?: string;
    otherRegion?: string;
    blocked: "me" | "them" | null;
    reported: boolean;
    messages: ThreadMessage[];
  };
  share: ShareView | null;
  offers: PublicOffer[];
};
type ShareDetail = Detail & { share: ShareView };

const REASONS = [
  { v: "harass", label: "騷擾" },
  { v: "scam", label: "詐騙" },
  { v: "spam", label: "廣告洗版" },
  { v: "other", label: "其他" },
] as const;

/** 對話右上：封鎖、檢舉（文字按鈕）。封鎖要再按一次確認 */
function SafetyActions({ d, reload }: { d: Detail; reload: () => void }) {
  const [mode, setMode] = useState<"" | "block" | "report">("");
  const [reason, setReason] = useState<string>("harass");
  const [note, setNote] = useState("");
  const op = useSave(4000);
  const other = d.thread.other;
  if (!other.handle) return null;
  const block = (blocked: boolean) =>
    void op.run(async () => {
      const r = await api("/api/me/blocks", { body: { handle: other.handle, blocked } });
      if (!r.ok) return { ok: false, text: r.error.message };
      setMode("");
      reload();
      return { ok: true, text: blocked ? "已封鎖" : "已解除封鎖" };
    });
  const report = (e: React.FormEvent) => {
    e.preventDefault();
    void op.run(async () => {
      if (reason === "other" && !note.trim()) return { ok: false, text: "寫一句原因" };
      const r = await api(`/api/threads/${d.thread.id}/report`, { body: { reason, note } });
      if (!r.ok && r.error.code !== "ALREADY_REPORTED") return { ok: false, text: r.error.message };
      setMode("");
      reload();
      return { ok: true, text: "已送出檢舉" };
    });
  };
  return (
    <div className="convo-safety">
      <div className="convo-safety-row">
        {d.thread.blocked === "me" ? null : (
          <button type="button" className="btn-text report-btn" onClick={() => setMode(mode === "block" ? "" : "block")} data-testid="dm-block">
            封鎖
          </button>
        )}
        {d.thread.reported ? (
          <span className="convo-reported" data-testid="dm-reported">
            已檢舉
          </span>
        ) : (
          <button type="button" className="btn-text report-btn" onClick={() => setMode(mode === "report" ? "" : "report")} data-testid="dm-report">
            檢舉
          </button>
        )}
      </div>
      {mode === "block" ? (
        <div className="convo-panel" role="group" aria-label="封鎖">
          <p>封鎖 {other.name} 後，你們都不能再傳訊息給對方，也不能開新對話。可以在設定頁解除。</p>
          <div className="convo-panel-acts">
            <button type="button" className="btn btn-line" onClick={() => block(true)} disabled={op.busy} data-testid="dm-block-confirm">
              確定封鎖
            </button>
            <button type="button" className="btn-text" onClick={() => setMode("")}>
              取消
            </button>
          </div>
        </div>
      ) : null}
      {mode === "report" ? (
        <form className="convo-panel" onSubmit={report} noValidate aria-label="檢舉">
          <fieldset className="report-reasons">
            <legend className="field-label">檢舉 {other.name}</legend>
            {REASONS.map((r) => (
              <label key={r.v} className="report-reason">
                <input type="radio" name="dm-reason" value={r.v} checked={reason === r.v} onChange={() => setReason(r.v)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className="sr-only" htmlFor="dm-report-note">
            補充
          </label>
          <textarea
            id="dm-report-note"
            className="input"
            rows={2}
            maxLength={500}
            placeholder={reason === "other" ? "寫一句原因（必填）" : "補充（選填）"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <p className="page-meta">管理員只看得到誰檢舉誰、理由與補充，看不到你們的訊息內容。</p>
          <div className="convo-panel-acts">
            <button type="submit" className="btn btn-line" disabled={op.busy} data-testid="dm-report-send">
              送出檢舉
            </button>
            <button type="button" className="btn-text" onClick={() => setMode("")}>
              取消
            </button>
          </div>
        </form>
      ) : null}
      <SaveMsg {...op.msg} testid="dm-safety-msg" />
    </div>
  );
}

function OfferBubble({ msg, d, frozen, run, busy }: { msg: ThreadMessage; d: ShareDetail; frozen: boolean; run: (p: string, b: unknown) => void; busy: boolean }) {
  const o = msg.offer!;
  const { me, geo } = useAccount();
  const mine = msg.from === me?.handle;
  const closed = d.share.sale.state === "sold";
  const status =
    o.status === "sold"
      ? "成交"
      : o.status === "rejected"
        ? "已拒絕"
        : o.status === "withdrawn"
          ? "已撤回"
          : closed
            ? "未成交"
            : o.status === "accepted"
              ? "賣家已接受"
              : "等回覆";
  const seller = d.thread.iAmSeller;
  return (
    <div className={`msg msg-offer${mine ? " mine" : ""}`} data-status={o.status}>
      <span className="offer-kind">{o.kind === "buy" ? "我要買" : "出價"}</span>
      <b className="offer-amt">{priceText(o.price)}</b>
      <span className={`offer-status${o.status === "sold" ? " is-deal" : o.status === "accepted" ? " is-ok" : ""}`}>{status}</span>
      {seller && !closed && !frozen && !geo.canTrade && o.status === "open" ? <RegionNote /> : null}
      {seller && !closed && !frozen && geo.canTrade && o.status === "open" ? (
        <div className="offer-acts">
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "accepted" })} disabled={busy}>
            接受
          </button>
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "rejected" })} disabled={busy}>
            拒絕
          </button>
        </div>
      ) : null}
      {seller && !closed && !frozen && o.status === "accepted" ? (
        <Link className="btn btn-text" href={shareHref(d.share.n)}>
          去單則頁成交
        </Link>
      ) : null}
      {!seller && mine && !closed && !frozen && o.status === "open" ? (
        <div className="offer-acts">
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/withdraw`, {})} disabled={busy}>
            撤回
          </button>
        </div>
      ) : null}
      {frozen && o.status === "open" ? <span className="offer-frozen-note">交易暫停</span> : null}
      <time>{msg.time}</time>
    </div>
  );
}

function Conversation({ id, onChange }: { id: number; onChange: () => void }) {
  const { me, geo } = useAccount();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [text, setText] = useState("");
  const [offering, setOffering] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    api<Detail>(`/api/threads/${id}`).then((r) => {
      if (!alive) return;
      if (r.ok) setD(r.data);
      else setMissing(true);
      void refreshAccount();
    });
    return () => {
      alive = false;
    };
  }, [id, version]);

  // 接受、拒絕、撤回：處理中按鈕停用，成功顯示「已更新」約 3 秒，失敗顯示原因（2026-09-28 回饋一致化）
  const op = useSave();
  const run = (path: string, body: unknown, ok?: () => void) =>
    void op.run(async () => {
      setError("");
      const r = await api(path, { body });
      if (r.ok) ok?.();
      setVersion((v) => v + 1);
      onChange();
      return r.ok ? { ok: true, text: "已更新" } : { ok: false, text: r.error.message };
    });

  if (missing) {
    return (
      <section className="convo">
        <Link className="back" href="/messages">
          ‹ 私訊
        </Link>
        <p className="inbox-empty">找不到這段對話</p>
      </section>
    );
  }
  if (!d) return <section className="convo" aria-busy="true" />;

  const { thread } = d;
  const reload = () => {
    setVersion((v) => v + 1);
    onChange();
  };
  const other = thread.other;
  const blockedNote =
    thread.blocked === "me" ? (
      <div className="convo-blocked" data-testid="dm-blocked-me">
        <p>你已封鎖 {other.name}</p>
        <button
          type="button"
          className="btn btn-line"
          onClick={() =>
            void op.run(async () => {
              const r = await api("/api/me/blocks", { body: { handle: other.handle, blocked: false } });
              if (!r.ok) return { ok: false, text: r.error.message };
              reload();
              return { ok: true, text: "已解除封鎖" };
            })
          }
          data-testid="dm-unblock"
        >
          解除封鎖
        </button>
      </div>
    ) : thread.blocked === "them" ? (
      <p className="convo-blocked" data-testid="dm-blocked-them">
        目前無法傳訊息給這位會員
      </p>
    ) : null;
  const needVerify = !me?.verified;
  const verifyNote = needVerify ? (
    <p className="convo-blocked" data-testid="dm-need-verify">
      驗證 Email 後才能傳訊息
      <button type="button" className="btn btn-line" onClick={() => openPanel("verify", undefined, me?.email)}>
        驗證 Email
      </button>
    </p>
  ) : null;

  const textForm = (
    <form
      className="composer-row"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await run(`/api/threads/${id}/messages`, { text }, () => track("dm_send"));
        setText("");
      }}
    >
      <label className="sr-only" htmlFor="convo-text">
        訊息
      </label>
      <input id="convo-text" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" maxLength={1000} />
      <button type="submit" className="btn btn-p btn-lg">
        送出
      </button>
    </form>
  );

  const bubbles = (dd: Detail, frozen: boolean) =>
    dd.thread.messages.map((m) =>
      m.from === null ? (
        <p key={m.id} className="msg-sys">
          {m.text} · {m.time}
        </p>
      ) : m.offer && dd.share ? (
        <OfferBubble key={m.id} msg={m} d={dd as ShareDetail} frozen={frozen} run={run} busy={op.busy} />
      ) : (
        <div key={m.id} className={`msg${m.from === me?.handle ? " mine" : ""}`}>
          <p>{m.text}</p>
          <time>{m.time}</time>
        </div>
      ),
    );

  if (!d.share) {
    return (
      <section className="convo" aria-label={`跟${other.name}的私訊`} data-kind="direct">
        <Link className="back" href="/messages">
          ‹ 私訊
        </Link>
        <div className="pin">
          <Link href={other.handle ? userHref(other.handle) : "#"} aria-hidden="true" tabIndex={-1} className="pin-ava">
            <Ava name={other.name} src={other.avatar} />
          </Link>
          <div className="thread-main">
            {other.handle ? (
              <Link className="pin-title" href={userHref(other.handle)}>
                {other.name}
              </Link>
            ) : (
              <span className="pin-title">{other.name}</span>
            )}
            <span className="pin-sub">直接私訊{regionText(thread.otherRegion)}</span>
          </div>
          <SafetyActions d={d} reload={reload} />
        </div>
        <div className="msgs" data-testid="msgs">
          {thread.messages.length ? bubbles(d, false) : <p className="msg-sys">還沒有訊息</p>}
        </div>
        <div className="composer">
          <SaveMsg {...op.msg} testid="offer-msg" />
          {blockedNote ?? verifyNote ?? textForm}
        </div>
      </section>
    );
  }

  const share = d.share;
  const sale = share.sale;
  const frozen = Boolean(share.lock) && sale.state !== "sold";
  const iAmSeller = thread.iAmSeller;
  const hasBuy = thread.messages.some((m) => m.offer?.kind === "buy" && m.offer.status !== "rejected" && m.offer.status !== "withdrawn");

  const offer = async () => {
    const p = parsePrice(amount);
    if (!p) {
      setError("填一個整數金額");
      return;
    }
    await run(`/api/shares/${share.n}/offers`, { kind: "offer", price: p }, () => track("offer_make", { kind: "出價" }));
    setAmount("");
    setOffering(false);
  };

  return (
    <section className="convo" aria-label={`跟${other.name}的私訊`} data-kind="share">
      <Link className="back" href="/messages">
        ‹ 私訊
      </Link>
      <div className="pin">
        <Link href={shareHref(share.n)} aria-hidden="true" tabIndex={-1}>
          <Photo share={share} sizes="56px" small />
        </Link>
        <div className="thread-main">
          <Link className="pin-title" href={shareHref(share.n)}>
            {share.what}
          </Link>
          <span className="pin-sub">
            {iAmSeller
              ? `你的收藏 · ${thread.buyer.name}${regionText(thread.buyerRegion)}`
              : `${sale.state === "share" || sale.state === "sold" ? "" : "賣家 "}${thread.seller.name}${regionText(thread.sellerRegion)}`}{" "}
            · {saleLine(sale)}
          </span>
        </div>
        <div className="pin-acts">
          <Link className="btn btn-text" href={shareHref(share.n)}>
            看這則
          </Link>
        </div>
        <SafetyActions d={d} reload={reload} />
      </div>
      <div className="msgs" data-testid="msgs">
        {thread.messages.length ? bubbles(d, frozen) : <p className="msg-sys">還沒有訊息</p>}
      </div>
      <div className="composer">
        {blockedNote}
        {frozen ? <p className="msg-sys">交易暫停</p> : null}
        {!blockedNote && !frozen && !iAmSeller && !geo.canTrade && (sale.state === "offer" || (sale.state === "sale" && !hasBuy)) ? <RegionNote /> : null}
        {!blockedNote && !frozen && !iAmSeller && geo.canTrade && sale.state === "offer" ? (
          offering ? (
            <div className="composer-offer">
              <MoneyInput id="convo-offer" value={amount} onChange={setAmount} label="出價金額" />
              <button type="button" className="btn btn-line btn-lg" onClick={offer}>
                送出出價
              </button>
              <button type="button" className="btn btn-text" onClick={() => setOffering(false)}>
                取消
              </button>
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-line" onClick={() => setOffering(true)}>
                出價
              </button>
            </div>
          )
        ) : null}
        {!blockedNote && !frozen && !iAmSeller && geo.canTrade && sale.state === "sale" && !hasBuy ? (
          <div>
            <button type="button" className="btn btn-line" onClick={() => run(`/api/shares/${share.n}/offers`, { kind: "buy" }, () => track("offer_make", { kind: "我要買" }))}>
              我要買 {priceText(sale.price ?? 0)}
            </button>
          </div>
        ) : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <SaveMsg {...op.msg} testid="offer-msg" />
        {blockedNote ? null : (verifyNote ?? textForm)}
      </div>
    </section>
  );
}

export function Inbox({ id }: { id?: string }) {
  const { status } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [version, setVersion] = useState(0);
  const current = id ? Number(id) : undefined;

  useEffect(() => {
    if (status !== "user") return;
    let alive = true;
    api<{ threads: Row[] }>("/api/threads").then((r) => {
      if (alive) setRows(r.ok ? r.data.threads : []);
    });
    return () => {
      alive = false;
    };
  }, [status, current, version]);
  const load = () => setVersion((v) => v + 1);

  if (status === "loading") return null;
  if (status === "anon") {
    return (
      <p className="empty">
        登入後才看得到私訊
        <button type="button" className="btn btn-p empty-btn" onClick={() => openPanel("login")}>
          登入
        </button>
      </p>
    );
  }
  if (!rows) return null;

  return (
    <div className={`inbox${id ? " has-thread" : ""}`}>
      <nav className="inbox-list" aria-label="私訊">
        <h1>私訊</h1>
        {rows.length === 0 ? <p className="inbox-empty">還沒有私訊</p> : null}
        <ul>
          {rows.map((r) => {
            const unread = r.id === current ? 0 : r.unread;
            return (
              <li key={r.id}>
                <Link
                  className={`thread-row${unread ? " is-unread" : ""}`}
                  href={`/messages/${r.id}`}
                  aria-current={r.id === current ? "page" : undefined}
                  data-kind={r.shareNo ? "share" : "direct"}
                  data-thread={r.id}
                >
                  {r.shareNo ? (
                    <span className="photo">
                      <span className={`photo-fill ph-${r.shareNo % 4}`}>
                        {r.thumb ? <span className="thread-thumb" style={{ backgroundImage: `url(${r.thumb})` }} /> : null}
                      </span>
                    </span>
                  ) : (
                    <span className="thread-ava">
                      <Ava name={r.other.name} src={r.other.avatar} />
                    </span>
                  )}
                  <span className="thread-main">
                    <b className="thread-who">
                      {r.other.name}
                      {r.otherRegion ? <span className="region-tag">{r.otherRegion}</span> : null}
                    </b>
                    {r.shareNo ? <span className="thread-what">{r.what}</span> : null}
                    <span className="thread-last">{r.lastFrom ? `${r.lastFrom}：${r.preview}` : ""}</span>
                  </span>
                  <span className="thread-side">
                    <span>{r.time}</span>
                    {unread ? (
                      <>
                        <UnreadBadge n={unread} className="unread-inline" />
                        <span className="sr-only">{unread} 則未讀</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {current ? (
        <Conversation key={current} id={current} onChange={load} />
      ) : (
        <section className="convo" aria-hidden="true" />
      )}
    </div>
  );
}
