"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CURRENT_USER,
  getShare,
  getUser,
  priceText,
  shareHref,
  toShareView,
  type Message,
  type Sale,
  type ShareView,
  type Thread,
} from "@/lib/data";
import { closeDeal, markRead, respondOffer, sendOffer, sendText, useAppState } from "@/lib/state";
import { Photo } from "@/components/share-card";
import { MoneyInput, parsePrice } from "@/components/share-detail";

const nameOf = (handle: string) => getUser(handle)?.name ?? handle;

const preview = (m?: Message) => {
  if (!m) return "";
  if (m.offer) return `${m.offer.kind === "buy" ? "我要買" : "出價"} ${priceText(m.offer.price)}`;
  return m.text ?? "";
};

const saleLine = (sale: Sale) =>
  sale.state === "sale"
    ? `定價出售 ${priceText(sale.price ?? 0)}`
    : sale.state === "offer"
      ? "開放出價"
      : sale.state === "sold"
        ? "已售出"
        : "純分享";

type Row = { thread: Thread; share: ShareView; seller: string; other: string; iAmSeller: boolean };

function OfferBubble({
  msg,
  row,
  sale,
}: {
  msg: Message;
  row: Row;
  sale: Sale;
}) {
  const o = msg.offer!;
  const mine = msg.from === CURRENT_USER;
  const closed = sale.state === "sold";
  const status =
    o.status === "sold"
      ? "成交"
      : o.status === "rejected"
        ? "已拒絕"
        : closed
          ? "未成交"
          : o.status === "accepted"
            ? "賣家已接受"
            : "等回覆";
  return (
    <div className={`msg msg-offer${mine ? " mine" : ""}`} data-status={o.status}>
      <span className="offer-kind">{o.kind === "buy" ? "我要買" : "出價"}</span>
      <b className="offer-amt">{priceText(o.price)}</b>
      <span className={`offer-status${o.status === "sold" ? " is-deal" : o.status === "accepted" ? " is-ok" : ""}`}>
        {status}
      </span>
      {row.iAmSeller && !closed && (o.status === "open" || o.status === "accepted") ? (
        <div className="offer-acts">
          {o.status === "open" ? (
            <>
              <button type="button" className="btn btn-line" onClick={() => respondOffer(row.thread.id, msg.id, "accepted")}>
                接受
              </button>
              <button type="button" className="btn btn-line" onClick={() => respondOffer(row.thread.id, msg.id, "rejected")}>
                拒絕
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-line"
              onClick={() => closeDeal(row.share.n, row.thread.buyer, o.price, sale)}
            >
              成交給這位
            </button>
          )}
        </div>
      ) : null}
      <time>{msg.time}</time>
    </div>
  );
}

function Conversation({ row }: { row: Row }) {
  const { saleOf } = useAppState();
  const sale = saleOf(row.share);
  const [text, setText] = useState("");
  const [offering, setOffering] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const { thread, share, iAmSeller } = row;

  useEffect(() => {
    markRead(thread.id);
  }, [thread.id, thread.messages.length]);

  const liveOffer = [...thread.messages].reverse().find((m) => m.offer && m.offer.status !== "rejected");
  const canClose = iAmSeller && sale.state !== "sold" && (liveOffer || sale.state === "sale");
  const hasBuy = thread.messages.some((m) => m.offer?.kind === "buy" && m.offer.status !== "rejected");

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    sendText(thread.id, text);
    setText("");
  };
  const offer = () => {
    const p = parsePrice(amount);
    if (!p) {
      setError("填一個整數金額");
      return;
    }
    sendOffer(share.n, "offer", p);
    setAmount("");
    setError("");
    setOffering(false);
  };

  return (
    <section className="convo" aria-label={`跟${nameOf(row.other)}的私訊`}>
      <Link className="back" href="/messages">
        ‹ 私訊
      </Link>
      <div className="pin">
        <Link href={shareHref(share.n)} aria-hidden="true" tabIndex={-1}>
          <Photo share={share} sizes="56px" />
        </Link>
        <div className="thread-main">
          <Link className="pin-title" href={shareHref(share.n)}>
            {share.what}
          </Link>
          <span className="pin-sub">
            {iAmSeller ? `你的收藏 · 買家 ${nameOf(row.other)}` : `賣家 ${nameOf(row.seller)}`} · {saleLine(sale)}
          </span>
        </div>
        <div className="pin-acts">
          {canClose ? (
            <button
              type="button"
              className="btn btn-line"
              onClick={() => closeDeal(share.n, thread.buyer, liveOffer?.offer?.price ?? sale.price, sale)}
            >
              成交給{nameOf(thread.buyer)}
            </button>
          ) : null}
          <Link className="btn btn-text" href={shareHref(share.n)}>
            看這則
          </Link>
        </div>
      </div>
      <div className="msgs" data-testid="msgs">
        {thread.messages.map((m) =>
          m.from === "system" ? (
            <p key={m.id} className="msg-sys">
              {m.text} · {m.time}
            </p>
          ) : m.offer ? (
            <OfferBubble key={m.id} msg={m} row={row} sale={sale} />
          ) : (
            <div key={m.id} className={`msg${m.from === CURRENT_USER ? " mine" : ""}`}>
              <p>{m.text}</p>
              <time>{m.time}</time>
            </div>
          ),
        )}
      </div>
      <div className="composer">
        {!iAmSeller && sale.state === "offer" ? (
          offering ? (
            <div className="composer-offer">
              <MoneyInput id="convo-offer" value={amount} onChange={setAmount} label="出價金額" />
              <button type="button" className="btn btn-line btn-lg" onClick={offer}>
                送出出價
              </button>
              <button type="button" className="btn btn-text" onClick={() => setOffering(false)}>
                取消
              </button>
              {error ? <p className="field-error">{error}</p> : null}
            </div>
          ) : (
            <div>
              <button type="button" className="btn btn-line" onClick={() => setOffering(true)}>
                出價
              </button>
            </div>
          )
        ) : null}
        {!iAmSeller && sale.state === "sale" && !hasBuy ? (
          <div>
            <button type="button" className="btn btn-line" onClick={() => sendOffer(share.n, "buy", sale.price ?? 0)}>
              我要買 {priceText(sale.price ?? 0)}
            </button>
          </div>
        ) : null}
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
  const { state, ready } = useAppState();
  if (!ready) return null;

  const findShare = (n: number): ShareView | undefined => {
    const s = getShare(n);
    return s ? toShareView(s) : state.myShares.find((x) => x.n === n);
  };

  const rows: Row[] = state.threads.flatMap((thread) => {
    const share = findShare(thread.n);
    if (!share) return [];
    const seller = share.author.handle;
    const iAmSeller = seller === CURRENT_USER;
    if (!iAmSeller && thread.buyer !== CURRENT_USER) return [];
    if (thread.messages.length === 0 && thread.id !== id) return [];
    return [{ thread, share, seller, other: iAmSeller ? thread.buyer : seller, iAmSeller }];
  });
  rows.sort((a, b) => Number(state.unread.includes(b.thread.id)) - Number(state.unread.includes(a.thread.id)));
  const current = id ? rows.find((r) => r.thread.id === id) : undefined;

  return (
    <div className={`inbox${id ? " has-thread" : ""}`}>
      <nav className="inbox-list" aria-label="私訊">
        <h1>私訊</h1>
        {rows.length === 0 ? <p className="inbox-empty">還沒有私訊</p> : null}
        <ul>
          {rows.map((r) => {
            const last = r.thread.messages.filter((m) => m.from !== "system").at(-1);
            const unread = state.unread.includes(r.thread.id);
            return (
              <li key={r.thread.id}>
                <Link
                  className="thread-row"
                  href={`/messages/${r.thread.id}`}
                  aria-current={r.thread.id === id ? "page" : undefined}
                >
                  <Photo share={r.share} sizes="48px" />
                  <span className="thread-main">
                    <b>
                      {nameOf(r.other)} · {r.share.what}
                    </b>
                    <span>{last ? `${nameOf(last.from)}：${preview(last)}` : ""}</span>
                  </span>
                  <span className="thread-side">
                    <span>{r.iAmSeller ? "你的收藏" : "你問的"}</span>
                    {unread ? <span className="unread-dot" aria-label="未讀" /> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {id ? (
        current ? (
          <Conversation key={current.thread.id} row={current} />
        ) : (
          <section className="convo">
            <Link className="back" href="/messages">
              ‹ 私訊
            </Link>
            <p className="inbox-empty">找不到這段對話</p>
          </section>
        )
      ) : (
        <section className="convo" aria-hidden="true" />
      )}
    </div>
  );
}
