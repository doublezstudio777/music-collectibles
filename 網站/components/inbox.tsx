"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { priceText, shareHref, type Sale, type ShareView } from "@/lib/data";
import { api, openPanel, refreshAccount, useAccount } from "@/lib/account";
import type { PublicOffer, ThreadMessage } from "@/lib/server/trade";
import { Photo } from "@/components/share-card";
import { MoneyInput, parsePrice } from "@/components/share-detail";

const saleLine = (sale: Sale) =>
  sale.state === "sale"
    ? `定價出售 ${priceText(sale.price ?? 0)}`
    : sale.state === "offer"
      ? "開放出價"
      : sale.state === "sold"
        ? "已售出"
        : "純分享";

type Row = {
  id: number;
  shareNo: number;
  what: string;
  thumb: string | null;
  iAmSeller: boolean;
  other: { handle: string; name: string };
  lastFrom: string;
  preview: string;
  time: string;
  unread: boolean;
};

type Detail = {
  thread: {
    id: number;
    shareNo: number;
    iAmSeller: boolean;
    buyer: { handle: string; name: string };
    seller: { handle: string; name: string };
    messages: ThreadMessage[];
  };
  share: ShareView;
  offers: PublicOffer[];
};

function OfferBubble({ msg, d, frozen, run }: { msg: ThreadMessage; d: Detail; frozen: boolean; run: (p: string, b: unknown) => void }) {
  const o = msg.offer!;
  const { me } = useAccount();
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
      {seller && !closed && !frozen && o.status === "open" ? (
        <div className="offer-acts">
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "accepted" })}>
            接受
          </button>
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "rejected" })}>
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
          <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/withdraw`, {})}>
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
  const { me } = useAccount();
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

  const run = async (path: string, body: unknown) => {
    setError("");
    const r = await api(path, { body });
    if (!r.ok) setError(r.error.message);
    setVersion((v) => v + 1);
    onChange();
  };

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

  const { thread, share } = d;
  const sale = share.sale;
  const frozen = Boolean(share.lock) && sale.state !== "sold";
  const iAmSeller = thread.iAmSeller;
  const other = iAmSeller ? thread.buyer : thread.seller;
  const hasBuy = thread.messages.some((m) => m.offer?.kind === "buy" && m.offer.status !== "rejected" && m.offer.status !== "withdrawn");

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await run(`/api/threads/${id}/messages`, { text });
    setText("");
  };
  const offer = async () => {
    const p = parsePrice(amount);
    if (!p) {
      setError("填一個整數金額");
      return;
    }
    await run(`/api/shares/${share.n}/offers`, { kind: "offer", price: p });
    setAmount("");
    setOffering(false);
  };

  return (
    <section className="convo" aria-label={`跟${other.name}的私訊`}>
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
            {iAmSeller ? `你的收藏 · 買家 ${thread.buyer.name}` : `賣家 ${thread.seller.name}`} · {saleLine(sale)}
          </span>
        </div>
        <div className="pin-acts">
          <Link className="btn btn-text" href={shareHref(share.n)}>
            看這則
          </Link>
        </div>
      </div>
      <div className="msgs" data-testid="msgs">
        {thread.messages.map((m) =>
          m.from === null ? (
            <p key={m.id} className="msg-sys">
              {m.text} · {m.time}
            </p>
          ) : m.offer ? (
            <OfferBubble key={m.id} msg={m} d={d} frozen={frozen} run={run} />
          ) : (
            <div key={m.id} className={`msg${m.from === me?.handle ? " mine" : ""}`}>
              <p>{m.text}</p>
              <time>{m.time}</time>
            </div>
          ),
        )}
      </div>
      <div className="composer">
        {frozen ? <p className="msg-sys">交易暫停</p> : null}
        {!frozen && !iAmSeller && sale.state === "offer" ? (
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
        {!frozen && !iAmSeller && sale.state === "sale" && !hasBuy ? (
          <div>
            <button type="button" className="btn btn-line" onClick={() => run(`/api/shares/${share.n}/offers`, { kind: "buy" })}>
              我要買 {priceText(sale.price ?? 0)}
            </button>
          </div>
        ) : null}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <form className="composer-row" onSubmit={send}>
          <label className="sr-only" htmlFor="convo-text">
            訊息
          </label>
          <input id="convo-text" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          <button type="submit" className="btn btn-p btn-lg">
            送出
          </button>
        </form>
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
          {rows.map((r) => (
            <li key={r.id}>
              <Link className="thread-row" href={`/messages/${r.id}`} aria-current={r.id === current ? "page" : undefined}>
                <span className="photo">
                  <span className={`photo-fill ph-${r.shareNo % 4}`}>
                    {r.thumb ? <span className="thread-thumb" style={{ backgroundImage: `url(${r.thumb})` }} /> : null}
                  </span>
                </span>
                <span className="thread-main">
                  <b>
                    {r.other.name} · {r.what}
                  </b>
                  <span>{r.lastFrom ? `${r.lastFrom}：${r.preview}` : ""}</span>
                </span>
                <span className="thread-side">
                  <span>{r.iAmSeller ? "你的收藏" : "你問的"}</span>
                  {r.unread && r.id !== current ? <span className="unread-dot" aria-label="未讀" /> : null}
                </span>
              </Link>
            </li>
          ))}
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
