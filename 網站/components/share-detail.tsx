"use client";

import { Ava } from "@/components/ava";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { priceText, userHref, type Sale, type SaleState, type ShareView } from "@/lib/data";
import { api, whenLoggedIn } from "@/lib/account";
import { useAction, useAppState } from "@/lib/state";
import type { PublicOffer } from "@/lib/server/trade";
import { AppealBox } from "@/components/report";
import { LikeButton } from "@/components/like-button";
import { Photo, TagList } from "@/components/share-card";
import { ShareActions, type ShareInfo } from "@/components/share-actions";
import { LevelTag } from "@/components/level-tag";

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


/**
 * 大圖（長邊 1600px）：登入會員點照片才打開。/img/ 伺服器端會再檢查登入與每日上限，
 * 用 fetch 取檔才看得到 401／429 的說明；浮水印已燒進檔案（2026-09-29）。
 * 多張時可以左右切換（按鈕、方向鍵、手機左右滑）。
 */
function Lightbox({
  list,
  start,
  alt,
  onClose,
}: {
  list: string[];
  start: number;
  alt: string;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(start);
  const [got, setGot] = useState<{ src: string; url: string; error: string }>({
    src: "",
    url: "",
    error: "",
  });
  const touch = useRef<number | null>(null);
  const src = list[idx];
  const url = got.src === src ? got.url : "";
  const error = got.src === src ? got.error : "";
  const many = list.length > 1;
  const go = useCallback(
    (d: number) => setIdx((i) => (i + d + list.length) % list.length),
    [list.length],
  );
  useEffect(() => {
    let alive = true;
    let made = "";
    fetch(src, { credentials: "same-origin" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) {
          const msg = (await r.text()).trim() || "大圖打不開，稍後再試";
          if (alive) setGot({ src, url: "", error: msg });
          return;
        }
        made = URL.createObjectURL(await r.blob());
        if (alive) setGot({ src, url: made, error: "" });
      })
      .catch(
        () =>
          alive && setGot({ src, url: "", error: "連不上網站，檢查網路再試" }),
      );
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [src]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (many && e.key === "ArrowRight") go(1);
      else if (many && e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, go, many]);
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="大圖"
      onClick={onClose}
      data-testid="lightbox"
      onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const x0 = touch.current;
        const x1 = e.changedTouches[0]?.clientX;
        touch.current = null;
        if (many && x0 !== null && x1 !== undefined && Math.abs(x1 - x0) > 40)
          go(x1 < x0 ? 1 : -1);
      }}
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        aria-label="關閉"
      >
        ×
      </button>
      {url ? (
        <span className="lightbox-frame" onClick={(e) => e.stopPropagation()}>
          {/* eslint-disable-next-line @next/next/no-img-element -- blob 網址，next/image 用不上 */}
          <img src={url} alt={alt} data-testid="lightbox-img" data-src={src} />
        </span>
      ) : (
        <p className="lightbox-msg" role="status">
          {error || "讀取中"}
        </p>
      )}
      {many ? (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            aria-label="上一張"
            data-testid="lightbox-prev"
            onClick={(e) => (e.stopPropagation(), go(-1))}
          >
            ‹
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            aria-label="下一張"
            data-testid="lightbox-next"
            onClick={(e) => (e.stopPropagation(), go(1))}
          >
            ›
          </button>
          <span className="lightbox-count">
            {idx + 1}／{list.length}
          </span>
        </>
      ) : null}
    </div>
  );
}

/**
 * 單則頁照片：大家先看縮圖；登入會員點開看大圖，沒登入點了跳登入。
 * 多張時：大圖區可以左右滑（scroll-snap），下面一排縮圖點了切換。
 */
function DetailPhoto({
  share,
  sale,
  lock,
}: {
  share: ShareView;
  sale: Sale;
  lock: ShareView["lock"];
}) {
  const [big, setBig] = useState<number | null>(null);
  const [cur, setCur] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const { me, ready } = useAppState();
  /**
   * 登入者預設看高清（2026-09-28）：伺服器輸出與 hydration 第一次一律是縮圖（整頁快取的 HTML 只有縮圖網址），
   * 瀏覽器確認登入（/api/me）後才換成長邊 1600px；載入失敗（到每日上限 429 等）退回縮圖。
   */
  const hi = ready && Boolean(me);
  const [failed, setFailed] = useState<string[]>([]);
  const pick = (image: string | undefined, thumb: string | undefined) =>
    hi && image && image !== thumb && !failed.includes(image) ? image : thumb;
  const onFail = (src: string | undefined) => src && setFailed((xs) => (xs.includes(src) ? xs : [...xs, src]));
  const close = useCallback(() => setBig(null), []);
  const list = share.photos ?? [];
  if (list.length < 2) {
    const main =
      share.image && share.image !== share.thumb ? share.image : null;
    const src = pick(share.image, share.thumb);
    const photo = (
      <Photo
        share={share}
        sale={sale}
        lock={lock}
        src={src}
        hires={src !== share.thumb}
        under={share.thumb}
        onError={() => src !== share.thumb && onFail(src)}
        sizes="(max-width: 1000px) 100vw, 640px"
      />
    );
    if (!main) return photo;
    return (
      <>
        <button
          type="button"
          className="photo-open"
          aria-label={me ? "點開大圖" : "登入後可以點開大圖"}
          data-testid="photo-open"
          onClick={() => whenLoggedIn("登入後可以點開大圖", () => setBig(0))}
        >
          {photo}
        </button>
        {big !== null ? (
          <Lightbox
            list={[main]}
            start={0}
            alt={share.what}
            onClose={close}
          />
        ) : null}
      </>
    );
  }
  const goTo = (i: number) => {
    const el = track.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    setCur(i);
  };
  return (
    <div className="gallery" data-testid="gallery" data-current={cur}>
      <div className="gallery-main">
        <div
          className="gallery-track"
          ref={track}
          data-testid="gallery-track"
          onScroll={(e) => {
            const el = e.currentTarget;
            const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (i !== cur && i >= 0 && i < list.length) setCur(i);
          }}
        >
          {list.map((p, i) => (
            <div
              className="gallery-slide"
              key={p.thumb}
              aria-hidden={i !== cur}
            >
              <button
                type="button"
                className="photo-open"
                tabIndex={i === cur ? 0 : -1}
                aria-label={
                  me ? `點開第 ${i + 1} 張大圖` : "登入後可以點開大圖"
                }
                data-testid="photo-open"
                onClick={() =>
                  whenLoggedIn("登入後可以點開大圖", () => setBig(i))
                }
              >
                <Photo
                  share={share}
                  sale={sale}
                  lock={lock}
                  src={pick(p.image, p.thumb)}
                  hires={pick(p.image, p.thumb) !== p.thumb}
                  under={p.thumb}
                  onError={() => pick(p.image, p.thumb) !== p.thumb && onFail(p.image)}
                  sizes="(max-width: 1000px) 100vw, 640px"
                />
              </button>
            </div>
          ))}
        </div>
        <span className="gallery-count" aria-hidden="true">
          {cur + 1}／{list.length}
        </span>
      </div>
      <ul className="gallery-strip" data-testid="gallery-strip">
        {list.map((p, i) => (
          <li key={p.thumb}>
            <button
              type="button"
              aria-label={`看第 ${i + 1} 張`}
              aria-current={i === cur}
              onClick={() => goTo(i)}
            >
              <Image src={p.thumb} alt="" fill sizes="64px" unoptimized />
            </button>
          </li>
        ))}
      </ul>
      {big !== null ? (
        <Lightbox
          list={list.map((p) => p.image)}
          start={big}
          alt={share.what}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

/** 最後編輯時間：台灣時間 YYYY/MM/DD HH:mm（伺服器與瀏覽器都用同一個時區算，不會 hydration 不一致） */
function EditedTime({ iso }: { iso: string }) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, "0");
  const text = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return <time dateTime={iso}>{text}</time>;
}

/**
 * 管理員專用：每張照片「標為辨識參考」／「取消」（2026-09-28，取代會員自勾）。
 * 標過的照片會出現在版本區塊的「辨識參考照片」。按下去按鈕停用顯示處理中，成功後顯示「已更新」並重新整理這頁資料。
 */
function RefPhotoAdmin({ share }: { share: ShareView }) {
  const router = useRouter();
  const list = share.photos?.length ? share.photos : share.thumb ? [{ image: share.image ?? share.thumb, thumb: share.thumb }] : [];
  const [marked, setMarked] = useState<number[]>(share.refIdx ?? []);
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!list.length) return null;
  const toggle = async (i: number) => {
    const on = !marked.includes(i);
    setBusy(i);
    setMsg(null);
    const r = await api<{ on: boolean }>("/api/admin/ref-photo", { body: { share: share.n, key: list[i].thumb, on } });
    setBusy(null);
    if (!r.ok) {
      setMsg({ ok: false, text: r.error.message });
      return;
    }
    setMarked(on ? [...marked, i].sort((a, b) => a - b) : marked.filter((x) => x !== i));
    setMsg({ ok: true, text: on ? `第 ${i + 1} 張已標為辨識參考` : `第 ${i + 1} 張已取消辨識參考` });
    setTimeout(() => setMsg(null), 3000);
    router.refresh();
  };
  return (
    <div className="ref-admin" data-testid="ref-admin">
      <span className="sub">管理員：辨識參考</span>
      <ul className="ref-admin-list">
        {list.map((p, i) => (
          <li key={p.thumb}>
            <span className="ref-admin-thumb" style={{ backgroundImage: `url(${p.thumb})` }} aria-hidden="true" />
            <button
              type="button"
              className="btn btn-line"
              disabled={busy !== null}
              aria-pressed={marked.includes(i)}
              onClick={() => toggle(i)}
              data-testid="ref-toggle"
            >
              {busy === i ? "處理中…" : marked.includes(i) ? "取消" : "標為辨識參考"}
            </button>
          </li>
        ))}
      </ul>
      {msg ? (
        <p className={msg.ok ? "sub" : "field-error"} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

/** 海外連線：交易按鈕的位置改顯示這一行（真正的擋在 API） */
export function RegionNote() {
  return (
    <p className="region-note" data-testid="region-note">
      交易僅限台灣地區
    </p>
  );
}

const STATUS_TEXT = {
  open: "等回覆",
  accepted: "賣家已接受",
  rejected: "已拒絕",
  withdrawn: "已撤回",
  sold: "成交",
} as const;

/**
 * 發文者的操作盒（2026-09-28 上傳表單改版，線框 #s9）：手機在照片下方、桌機在右欄最上面。
 * 左邊「你的收藏」＋目前狀態，右邊一顆「編輯」（編輯頁就是同一張表單，照片也在裡面）。
 * 出售的快改留在盒子裡、不收進選單：純分享只露一個「我想賣」，出售中直接展開三段切換與價格，已售出是「改回出售中」。
 */
function OwnerPanel({ share, sale, offers, canEdit }: { share: ShareView; sale: Sale; offers: PublicOffer[]; canEdit: boolean }) {
  const act = useAction();
  const { canTrade } = useAppState();
  const [open, setOpen] = useState(sale.state === "offer" || sale.state === "sale");
  const [draft, setDraft] = useState<SaleState | null>(null);
  const [price, setPrice] = useState(sale.price ? String(sale.price) : "");
  const [error, setError] = useState("");
  const shown = draft ?? sale.state;
  const n = offers.length;
  const status =
    sale.state === "sold"
      ? ["已售出", sale.soldTo ? `成交給 ${sale.soldTo}` : "", sale.soldAt ?? ""].filter(Boolean).join("・")
      : sale.state === "sale"
        ? `定價出售 ${priceText(sale.price ?? 0)}${n ? `・${n} 筆出價` : ""}`
        : sale.state === "offer"
          ? `開放出價${n ? `・${n} 筆出價` : ""}`
          : "純分享";
  const save = async (state: SaleState, p?: number) => {
    const r = await act(`/api/shares/${share.n}`, { method: "PATCH", body: { state, ...(p ? { price: p } : {}) } });
    if (!r.ok) setError(r.error.message);
  };
  const pick = (st: SaleState) => {
    setError("");
    if (st === "sale") return setDraft("sale");
    setDraft(null);
    void save(st);
  };
  const applyPrice = () => {
    const p = parsePrice(price);
    if (!p) return setError("填一個整數金額");
    setError("");
    setDraft(null);
    void save("sale", p);
  };
  return (
    <div className="owner-box" data-testid="owner-box" data-state={sale.state}>
      <div className="owner-top">
        <span className="owner-status">
          <span className="sub">你的收藏</span>
          <b data-testid="owner-status">{status}</b>
        </span>
        {canEdit ? (
          <Link className="btn btn-line" href={`/share/${share.n}/edit`} data-testid="share-edit-open">
            編輯
          </Link>
        ) : null}
      </div>
      {sale.state === "sold" ? (
        canTrade ? (
          <button
            type="button"
            className="btn-text owner-link"
            onClick={async () => {
              const r = await act(`/api/shares/${share.n}/reopen`, { body: {} });
              if (!r.ok) setError(r.error.message);
            }}
            data-testid="owner-reopen"
          >
            改回出售中
          </button>
        ) : (
          <RegionNote />
        )
      ) : !canTrade ? (
        <>
          <RegionNote />
          {sale.state !== "share" ? (
            <button type="button" className="btn-text owner-link" onClick={() => void save("share")}>
              改回純分享
            </button>
          ) : null}
        </>
      ) : !open ? (
        <button type="button" className="btn-text owner-link" onClick={() => setOpen(true)} data-testid="owner-want-sell">
          我想賣
        </button>
      ) : (
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
              <button type="button" className="btn btn-line" onClick={applyPrice} data-testid="owner-price">
                {sale.state === "sale" ? "改價格" : "開始出售"}
              </button>
            </div>
          ) : null}
        </div>
      )}
      {n && sale.state !== "share" && sale.state !== "sold" ? (
        <Link className="link owner-link" href="/messages">
          看私訊
        </Link>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

/** 買家看：依狀態顯示出價或我要買 */
function BuyBox({ share, sale, offers }: { share: ShareView; sale: Sale; offers: PublicOffer[] }) {
  const router = useRouter();
  const { me, canTrade } = useAppState();
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
        {!canTrade ? (
          <RegionNote />
        ) : open ? (
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
        {!canTrade ? <RegionNote /> : null}
        <div className={canTrade ? "deal-actions" : "deal-actions one"}>
          {canTrade ? (
            <button type="button" className="btn btn-p btn-lg" onClick={buy}>
              我要買
            </button>
          ) : null}
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
  const { me, canTrade } = useAppState();
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
                  <Ava name={o.buyer.name} src={o.buyer.avatar} />
                  <span className="who-name">{o.buyer.name}</span>
                </Link>
                <LevelTag badge={o.badge} />
                {o.region ? <span className="region-tag" title="所在地區">{o.region}</span> : null}
                <span className="offer-kind">{o.kind === "buy" ? "我要買" : "出價"}</span>
                <span className="offer-amt">{priceText(o.price)}</span>
                <span className="offer-when">{o.time}</span>
              </div>
              <div className="offer-acts">
                <span className={`offer-status${cls}`}>{status}</span>
                {mine && !closed && !canTrade && (o.status === "open" || o.status === "accepted") ? <RegionNote /> : null}
                {mine && !closed && canTrade && o.status === "open" ? (
                  <>
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "accepted" })}>
                      接受
                    </button>
                    <button type="button" className="btn btn-line" onClick={() => run(`/api/offers/${o.id}/respond`, { answer: "rejected" })}>
                      拒絕
                    </button>
                  </>
                ) : null}
                {mine && !closed && canTrade && o.status === "accepted" ? (
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

export function ShareDetail({
  share,
  offers,
  shareInfo,
}: {
  share: ShareView;
  offers: PublicOffer[];
  /** 被鎖定的是 null：不出現分享按鈕 */
  shareInfo: ShareInfo | null;
}) {
  const { me, ready } = useAppState();
  const mine = Boolean(me) && share.author.handle === me?.handle;
  const sale = share.sale;
  const lock = share.lock;
  const frozen = Boolean(lock) && sale.state !== "sold";
  const fake = share.hasFakes;

  return (
    <div className="detail" data-sale={sale.state}>
      <div className={share.image ? "detail-photo has-image" : "detail-photo"}>
        <DetailPhoto share={share} sale={sale} lock={lock} />
      </div>
      <div className="detail-info">
        {lock ? (
          <div className="lock-banner" role="status" data-target={lock.target}>
            <b>{lock.label}</b>
            <span>{frozen ? "交易暫停" : "內容照常可看"}</span>
          </div>
        ) : null}
        {lock && mine ? <AppealBox target={lock.target} /> : null}
        {mine && ready && !frozen ? <OwnerPanel key={sale.state + (sale.price ?? "")} share={share} sale={sale} offers={offers} canEdit={!lock} /> : null}
        <h1 className="page-title">{share.what}</h1>
        <div className="detail-by">
          <Link className="who" href={userHref(share.author.handle)}>
            <span className="ava ava-sm" aria-hidden="true">
              {share.author.initials}
            </span>
            <span className="who-name">{share.author.name}</span>
          </Link>
          <LevelTag badge={share.author.badge} />
          <span className="when">{share.time}</span>
          <LikeButton n={share.n} base={share.likes} large />
        </div>
        {share.editedAt ? (
          <p className="sub edited-at" data-testid="edited-at">
            最後編輯於 <EditedTime iso={share.editedAt} />
          </p>
        ) : null}
        {me?.admin && ready ? <RefPhotoAdmin share={share} /> : null}
        {shareInfo && !lock ? <ShareActions info={shareInfo} /> : null}
        {frozen && sale.state !== "share" ? (
          <FrozenBox sale={sale} offers={offers} />
        ) : mine ? null : sale.state === "sold" ? (
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
        <TagList about={share.about} tags={share.tags} links={share.tagLinks} />
        {share.link ? (
          <p className="detail-link">
            <Link className="link" href={share.link.href}>
              {share.link.label}
            </Link>
          </p>
        ) : mine && ready && !lock ? (
          <p className="detail-link">
            <Link className="link" href={`/share/${share.n}/edit#share-form-sec-where`} data-testid="fill-where">
              補上是哪一張
            </Link>
          </p>
        ) : null}
        <p className="detail-kind">
          <span>{share.kind}</span>
          {share.kindNote ? <span className="sub">{share.kindNote}</span> : null}
        </p>
        <OfferList share={share} sale={sale} offers={offers} mine={mine} frozen={frozen} />
      </div>
    </div>
  );
}
