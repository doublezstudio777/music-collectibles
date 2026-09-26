"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { priceText, shareTarget, userHref, type Sale, type SaleState, type ShareView } from "@/lib/data";
import { api, whenLoggedIn } from "@/lib/account";
import { useAction, useAppState } from "@/lib/state";
import type { PublicOffer } from "@/lib/server/trade";
import { AppealBox, ReportBox } from "@/components/report";
import { LikeButton } from "@/components/like-button";
import { NextPhase } from "@/components/next-phase";
import { Photo, TagList } from "@/components/share-card";

/** 金額輸入：只收正整數 */
export function parsePrice(raw: string) {
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function MoneyInput({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <label className="money" htmlFor={id}>
      <span aria-hidden="true">NT$</span>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
        aria-label={label}
      />
    </label>
  );
}


const STATUS_TEXT = {
  open: "等回覆",
  accepted: "賣家已接受",
  rejected: "已拒絕",
  withdrawn: "已撤回",
  sold: "成交",
} as const;

/** 賣家自己看：出售狀態三段切換＋定價 */
function SellerBar({ share, sale }: { share: ShareView; sale: Sale }) {
  const act = useAction();
  const [draft, setDraft] = useState<SaleState | null>(null);
  const [price, setPrice] = useState(sale.price ? String(sale.price) : "");
  const [error, setError] = useState("");
  const shown = draft ?? sale.state;

  if (sale.state === "sold") {
    return (
      <div className="seller-bar">
        <p className="seller-row">
          <b>已售出</b>
          {sale.soldTo ? <span>成交給 {sale.soldTo}</span> : null}
          {sale.soldAt ? <span className="deal-note">{sale.soldAt}</span> : null}
          <button
            type="button"
            className="btn btn-line"
            onClick={async () => {
              const r = await act(`/api/shares/${share.n}/reopen`, { body: {} });
              if (!r.ok) setError(r.error.message);
            }}
          >
            改回出售中
          </button>
        </p>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    );
  }

  const pick = (s: SaleState) => {
    setError("");
    if (s === "sale") {
      setDraft("sale");
      return;
    }
    setDraft(null);
    void save(s);
  };

  const save = async (state: SaleState, p?: number) => {
    const r = await act(`/api/shares/${share.n}`, { method: "PATCH", body: { state, ...(p ? { price: p } : {}) } });
    if (!r.ok) setError(r.error.message);
  };

  const applyPrice = () => {
    const p = parsePrice(price);
    if (!p) {
      setError("填一個整數金額");
      return;
    }
    setError("");
    setDraft(null);
    void save("sale", p);
  };

  return (
    <div className="seller-bar" data-testid="seller-bar">
      <div className="seg" role="group" aria-label="要不要賣">
        {(
          [
            ["share", "純分享"],
            ["offer", "開放出價"],
            ["sale", "定價出售"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={shown === k} onClick={() => pick(k)}>
            {label}
          </button>
        ))}
      </div>
      {shown === "sale" ? (
        <div className="seller-row">
          <MoneyInput id="seller-price" value={price} onChange={setPrice} label="定價" />
          <button type="button" className="btn btn-line btn-lg" onClick={applyPrice}>
            {sale.state === "sale" ? "改價格" : "開始出售"}
          </button>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
      ) : null}
      {error && shown !== "sale" ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/** 買家看：依狀態顯示出價或我要買 */
function BuyBox({ share, sale, offers }: { share: ShareView; sale: Sale; offers: PublicOffer[] }) {
  const router = useRouter();
  const { me } = useAppState();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");

  if (sale.state === "offer") {
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      const p = parsePrice(amount);
      if (!p) {
        setError("填一個整數金額");
        return;
      }
      whenLoggedIn("登入後才能出價", async () => {
        const r = await api<{ result: number }>(`/api/shares/${share.n}/offers`, { body: { kind: "offer", price: p } });
        if (r.ok) router.push(`/messages/${r.data.result}`);
        else setError(r.error.message);
      });
    };
    return (
      <div className="deal">
        <div className="deal-top">
          <b>開放出價</b>
          {offers.length ? <span className="deal-note">{offers.length} 筆出價</span> : null}
        </div>
        {open ? (
          <form className="offer-form" onSubmit={submit} noValidate>
            <MoneyInput id="offer-amount" value={amount} onChange={setAmount} label="出價金額" />
            <button type="submit" className="btn btn-p btn-lg">
              送出出價
            </button>
            {error ? <p className="field-error">{error}</p> : null}
          </form>
        ) : (
          <div className="deal-actions one">
            <button type="button" className="btn btn-p btn-lg" onClick={() => setOpen(true)}>
              出價
            </button>
          </div>
        )}
      </div>
    );
  }

  if (sale.state === "sale") {
    const mineOpen = offers.find(
      (o) => o.buyer.handle === me?.handle && o.kind === "buy" && (o.status === "open" || o.status === "accepted"),
    );
    const go = (path: string, body: unknown, reason: string) =>
      whenLoggedIn(reason, async () => {
        const r = await api<{ result: number }>(path, { body });
        if (r.ok) router.push(`/messages/${r.data.result}`);
        else setError(r.error.message);
      });
    const buy = () => {
      if (mineOpen) router.push(`/messages/${mineOpen.threadId}`);
      else go(`/api/shares/${share.n}/offers`, { kind: "buy" }, "登入後才能買");
    };
    return (
      <div className="deal">
        <div className="deal-top">
          <span className="deal-state">定價出售</span>
          <strong className="deal-price">{priceText(sale.price ?? 0)}</strong>
        </div>
        <div className="deal-actions">
          <button type="button" className="btn btn-p btn-lg" onClick={buy}>
            我要買
          </button>
          <button type="button" className="btn btn-line btn-lg" onClick={() => go(`/api/shares/${share.n}/threads`, {}, "登入後才能私訊")}>
            問賣家
          </button>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
    );
  }

  return null;
}

function SoldBox({ sale }: { sale: Sale }) {
  const shown = sale.soldPrice ?? sale.price;
  return (
    <div className="deal">
      <div className="deal-top">
        <b>已售出</b>
        {shown ? <span className="deal-strike">{priceText(shown)}</span> : null}
        {sale.soldAt ? <span className="deal-note">{sale.soldAt}</span> : null}
      </div>
    </div>
  );
}

/** 賣家自己看的交易區：價格＋幾筆出價，沒有買的按鈕 */
function OwnerBox({ sale, offers }: { sale: Sale; offers: PublicOffer[] }) {
  if (sale.state === "share") return null;
  if (sale.state === "sold") return <SoldBox sale={sale} />;
  return (
    <div className="deal">
      <div className="deal-top">
        {sale.state === "sale" ? (
          <strong className="deal-price">{priceText(sale.price ?? 0)}</strong>
        ) : (
          <b>開放出價</b>
        )}
        <span className="deal-note">
          {offers.length} 筆出價 · <Link href="/messages">看私訊</Link>
        </span>
      </div>
    </div>
  );
}

/** 被鎖：不能定價、出價、我要買，既有出價凍結 */
function FrozenBox({ sale, offers }: { sale: Sale; offers: PublicOffer[] }) {
  return (
    <div className="deal deal-frozen" data-testid="frozen">
      <div className="deal-top">
        <b>交易暫停</b>
        {sale.state === "sale" ? <span className="deal-strike">{priceText(sale.price ?? 0)}</span> : null}
        {offers.length ? <span className="deal-note">{offers.length} 筆出價凍結</span> : null}
      </div>
    </div>
  );
}

/** 出價公開列表：金額公開、誰出的公開；賣家多了接受／拒絕／成交給這位 */
function OfferList({
  share,
  sale,
  offers,
  mine,
  frozen,
}: {
  share: ShareView;
  sale: Sale;
  offers: PublicOffer[];
  mine: boolean;
  frozen: boolean;
}) {
  const act = useAction();
  const { me } = useAppState();
  const [error, setError] = useState("");
  if (offers.length === 0) return null;
  const closed = sale.state === "sold" || frozen;
  const run = async (path: string, body: unknown) => {
    setError("");
    const r = await act(path, { body });
    if (!r.ok) setError(r.error.message);
  };
  return (
    <section className="offers" aria-labelledby="offers-title">
      <h2 id="offers-title">
        出價<span className="count">{offers.length}</span>
      </h2>
      <ul>
        {offers.map((o) => {
          const lost = closed && o.status !== "sold";
          const live = o.status === "open" || o.status === "accepted";
          const status =
            frozen && sale.state !== "sold" && live
              ? "凍結"
              : lost && o.status !== "rejected" && o.status !== "withdrawn"
                ? "未成交"
                : STATUS_TEXT[o.status];
          const cls = o.status === "sold" ? " is-deal" : o.status === "accepted" ? " is-ok" : "";
          const off = o.status === "rejected" || o.status === "withdrawn" || lost;
          return (
            <li key={o.id} className={`offer-row${off ? " is-off" : ""}`} data-status={status === "凍結" ? "frozen" : o.status}>
              <div className="offer-who">
                <Link className="who" href={userHref(o.buyer.handle)}>
                  <span className="ava ava-sm" aria-hidden="true">
                    {Array.from(o.buyer.name)[0] ?? "?"}
                  </span>
                  <span>{o.buyer.name}</span>
                </Link>
                <span className="offer-kind">{o.kind === "buy" ? "我要買" : "出價"}</span>
                <span className="offer-amt">{priceText(o.price)}</span>
                <span className="offer-when">{o.time}</span>
              </div>
              <div className="offer-acts">
                <span className={`offer-status${cls}`}>{status}</span>
                {mine && !closed && o.status === "open" ? (
                  <>
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "accepted" })}>
                      接受
                    </button>
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "rejected" })}>
                      拒絕
                    </button>
                  </>
                ) : null}
                {mine && !closed && o.status === "accepted" ? (
                  <button type="button" className="btn btn-line" onClick={() => run(`/api/shares/${share.n}/close`, { offerId: o.id })}>
                    成交給這位
                  </button>
                ) : null}
                {!mine && o.buyer.handle === me?.handle && !closed && o.status === "open" ? (
                  <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/withdraw`, {})}>
                    撤回
                  </button>
                ) : null}
                {mine || o.buyer.handle === me?.handle ? (
                  <Link className="btn btn-text" href={`/messages/${o.threadId}`}>
                    私訊
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </section>
  );
}

export function ShareDetail({ share, offers }: { share: ShareView; offers: PublicOffer[] }) {
  const { me, ready } = useAppState();
  const mine = Boolean(me) && share.author.handle === me?.handle;
  const sale = share.sale;
  const lock = share.lock;
  const frozen = Boolean(lock) && sale.state !== "sold";
  const fake = share.hasFakes;

  return (
    <div className="detail" data-sale={sale.state}>
      <div className={share.image ? "detail-photo has-image" : "detail-photo"}>
        <Photo share={share} sale={sale} lock={lock} sizes="(max-width: 1000px) 100vw, 640px" />
      </div>
      <div className="detail-info">
        {lock ? (
          <div className="lock-banner" role="status" data-target={lock.target}>
            <b>{lock.label}</b>
            <span>{frozen ? "交易暫停" : "內容照常可看"}</span>
          </div>
        ) : null}
        {lock && mine ? <AppealBox target={lock.target} /> : null}
        {mine && ready && !frozen ? <SellerBar key={sale.state + (sale.price ?? "")} share={share} sale={sale} /> : null}
        <h1 className="page-title">{share.what}</h1>
        <div className="detail-by">
          <Link className="who" href={userHref(share.author.handle)}>
            <span className="ava ava-sm" aria-hidden="true">
              {share.author.initials}
            </span>
            <span>{share.author.name}</span>
          </Link>
          <span className="when">{share.time}</span>
          <LikeButton n={share.n} base={share.likes} large />
        </div>
        {frozen && sale.state !== "share" ? (
          <FrozenBox sale={sale} offers={offers} />
        ) : mine ? (
          <OwnerBox sale={sale} offers={offers} />
        ) : sale.state === "sold" ? (
          <SoldBox sale={sale} />
        ) : (
          <BuyBox share={share} sale={sale} offers={offers} />
        )}
        {fake && share.link ? (
          <p className="fake-note">
            <span className="flag flag-fake">有已知仿冒</span>
            <Link className="link" href={`${share.link.href}-fakes`}>
              對照正版與仿冒
            </Link>
          </p>
        ) : null}
        {share.story ? <p className="prose">{share.story}</p> : null}
        <TagList about={share.about} tags={share.tags} />
        {share.link ? (
          <p className="detail-link">
            <Link className="link" href={share.link.href}>
              {share.link.label}
            </Link>
          </p>
        ) : mine ? (
          <p className="detail-link">
            <NextPhase label="補上系列或品項" className="btn btn-line" />
          </p>
        ) : null}
        <p className="detail-kind">
          <span>{share.kind}</span>
          {share.kindNote ? <span className="sub">{share.kindNote}</span> : null}
          {share.refPhoto ? <span className="sub">照片可當辨識參考</span> : null}
        </p>
        <OfferList share={share} sale={sale} offers={offers} mine={mine} frozen={frozen} />
        {!mine ? <ReportBox target={shareTarget(share.n)} label="檢舉這則" /> : null}
      </div>
    </div>
  );
}
