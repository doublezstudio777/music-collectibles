"use client";

// 目前使用者的本機狀態：點讚（＝喜愛清單）、我有、想要、自己發的炫收藏、
// 出售狀態的變更、出價與私訊。
//
// 還沒有帳號與資料庫，狀態存在 localStorage，換裝置或清快取就會消失。
// 第一次開啟時用 data.ts 的示範資料當起點（示範登入者 CURRENT_USER、示範對話）。
//
// 點讚與我有／想要分開存：點讚是「留著以後看」，不代表持有。
// 錢貨不經過平台：成交只是賣家把這則標成已售出，之後雙方自己約。
//
// 用 useSyncExternalStore：伺服器端與第一次渲染都是空狀態，
// 掛載後訂閱才讀 localStorage，避免 hydration 不一致。

import { useCallback, useSyncExternalStore } from "react";
import {
  CURRENT_USER,
  getUser,
  priceText,
  threads as seedThreads,
  UNREAD_SEED,
  type Message,
  type OfferKind,
  type OfferStatus,
  type Sale,
  type ShareView,
  type Thread,
} from "@/lib/data";

export type Bucket = "owned" | "wanted";

type Snapshot = {
  owned: string[];
  wanted: string[];
  liked: number[];
  myShares: ShareView[];
  /** 本機改過的出售狀態，蓋過 data.ts */
  sales: Record<number, Sale>;
  threads: Thread[];
  unread: string[];
  ready: boolean;
};

const STORAGE_KEY = "yinzang.state.v3";
const OLD_KEY = "yinzang.state.v2";
const EMPTY: Snapshot = {
  owned: [], wanted: [], liked: [], myShares: [], sales: {}, threads: [], unread: [], ready: false,
};

let snapshot: Snapshot = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

function seed(): Snapshot {
  const me = getUser(CURRENT_USER);
  return {
    owned: me?.owned ?? [],
    wanted: me?.wanted ?? [],
    liked: me?.liked ?? [],
    myShares: [],
    sales: {},
    threads: seedThreads,
    unread: UNREAD_SEED,
    ready: true,
  };
}

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Snapshot>;
      snapshot = { ...seed(), ...p, ready: true };
    } else {
      // 上一版只存點讚、我有、想要、自己發的，搬過來，其餘用示範資料
      const old = window.localStorage.getItem(OLD_KEY);
      const p = old ? (JSON.parse(old) as Partial<Snapshot>) : {};
      snapshot = {
        ...seed(),
        ...(p.owned ? { owned: p.owned } : {}),
        ...(p.wanted ? { wanted: p.wanted } : {}),
        ...(p.liked ? { liked: p.liked } : {}),
        myShares: (p.myShares ?? []).map((s) => ({ ...s, sale: s.sale ?? { state: "share" } })),
      };
    }
  } catch {
    snapshot = seed();
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  hydrateOnce();
  return () => {
    listeners.delete(listener);
  };
}

function persist() {
  try {
    const { ready: _ready, ...rest } = snapshot;
    void _ready;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
    return true;
  } catch {
    return false;
  }
}

function commit(next: Snapshot) {
  const prev = snapshot;
  snapshot = next;
  if (!persist()) {
    snapshot = prev;
    return false;
  }
  emit();
  return true;
}

function toggleIn<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function toggleHolding(bucket: Bucket, key: string) {
  commit({ ...snapshot, [bucket]: toggleIn(snapshot[bucket], key) });
}

export function toggleLike(n: number) {
  commit({ ...snapshot, liked: toggleIn(snapshot.liked, n) });
}

/** 回傳新分享的流水號；存不進去（容量滿）回傳 null */
export function addMyShare(draft: Omit<ShareView, "n" | "order" | "local">): number | null {
  const n = Math.max(1000, ...snapshot.myShares.map((s) => s.n)) + 1;
  const share: ShareView = { ...draft, n, order: 1000 + n, local: true };
  return commit({ ...snapshot, myShares: [share, ...snapshot.myShares] }) ? n : null;
}

/* ---------- 出售、出價、私訊 ---------- */

const now = () => "剛剛";
let seq = 0;
const newId = (tid: string) => `${tid}-local-${Date.now().toString(36)}-${seq++}`;

const sys = (tid: string, text: string): Message => ({ id: newId(tid), from: "system", time: now(), text });

export const threadId = (n: number, buyer: string) => `${n}-${buyer}`;

function upsertThread(list: Thread[], n: number, buyer: string, add: Message[]) {
  const id = threadId(n, buyer);
  const found = list.find((t) => t.id === id);
  if (found) return list.map((t) => (t.id === id ? { ...t, messages: [...t.messages, ...add] } : t));
  return [...list, { id, n, buyer, messages: add }];
}

/** 對某則收藏的每一條對話插一行系統訊息 */
function broadcast(list: Thread[], n: number, text: (t: Thread) => string | null) {
  return list.map((t) => {
    if (t.n !== n) return t;
    const line = text(t);
    return line ? { ...t, messages: [...t.messages, sys(t.id, line)] } : t;
  });
}

const stateWord: Record<Sale["state"], string> = {
  share: "這件不賣了",
  offer: "改為開放出價",
  sale: "改為定價出售",
  sold: "這件已售出",
};

/** 賣家把已售出改回出售中：沿用原本的定價／開放出價設定，成交紀錄不保留 */
export function reopenSale(n: number, before: Sale) {
  if (before.state !== "sold") return;
  const next: Sale = before.price ? { state: "sale", price: before.price } : { state: "offer" };
  commit({
    ...snapshot,
    sales: { ...snapshot.sales, [n]: next },
    threads: broadcast(snapshot.threads, n, () => "賣家改回出售中"),
  });
}

/** 賣家改出售狀態：每條進行中的對話插一行 */
export function setSale(n: number, next: Sale, before: Sale) {
  const changed = next.state !== before.state || next.price !== before.price;
  if (!changed) return;
  const line =
    next.state === "sale" && before.state === "sale"
      ? `價格改為 ${priceText(next.price ?? 0)}`
      : next.state === "sale"
        ? `改為定價出售 ${priceText(next.price ?? 0)}`
        : stateWord[next.state];
  commit({
    ...snapshot,
    sales: { ...snapshot.sales, [n]: next },
    threads: broadcast(snapshot.threads, n, () => line),
  });
}

/** 買家出價或按「我要買」：結構化訊息，回傳對話 id */
export function sendOffer(n: number, kind: OfferKind, price: number) {
  const tid = threadId(n, CURRENT_USER);
  const msg: Message = { id: newId(tid), from: CURRENT_USER, time: now(), offer: { kind, price, status: "open" } };
  commit({
    ...snapshot,
    threads: upsertThread(snapshot.threads, n, CURRENT_USER, [msg]),
  });
  return tid;
}

/** 開一條對話但不送出價（問賣家） */
export function openThread(n: number) {
  const tid = threadId(n, CURRENT_USER);
  if (!snapshot.threads.some((t) => t.id === tid)) {
    commit({ ...snapshot, threads: [...snapshot.threads, { id: tid, n, buyer: CURRENT_USER, messages: [] }] });
  }
  return tid;
}

export function sendText(tid: string, text: string) {
  const t = snapshot.threads.find((x) => x.id === tid);
  if (!t || !text.trim()) return;
  const msg: Message = { id: newId(tid), from: CURRENT_USER, time: now(), text: text.trim() };
  commit({ ...snapshot, threads: upsertThread(snapshot.threads, t.n, t.buyer, [msg]) });
}

function setOfferStatus(list: Thread[], msgId: string, status: OfferStatus) {
  return list.map((t) => ({
    ...t,
    messages: t.messages.map((m) => (m.id === msgId && m.offer ? { ...m, offer: { ...m.offer, status } } : m)),
  }));
}

/** 賣家接受或拒絕一筆出價 */
export function respondOffer(tid: string, msgId: string, answer: "accepted" | "rejected") {
  const t = snapshot.threads.find((x) => x.id === tid);
  const m = t?.messages.find((x) => x.id === msgId);
  if (!t || !m?.offer) return;
  const line = `賣家${answer === "accepted" ? "接受" : "拒絕"}了 ${priceText(m.offer.price)}`;
  let list = setOfferStatus(snapshot.threads, msgId, answer);
  list = list.map((x) => (x.id === tid ? { ...x, messages: [...x.messages, sys(tid, line)] } : x));
  commit({ ...snapshot, threads: list });
}

/** 買家撤回自己還在等回覆的出價；公開列表標「已撤回」，不移除紀錄 */
export function withdrawOffer(tid: string, msgId: string) {
  const t = snapshot.threads.find((x) => x.id === tid);
  const m = t?.messages.find((x) => x.id === msgId);
  if (!t || !m?.offer || m.from !== CURRENT_USER || m.offer.status !== "open") return;
  const line = `買家撤回了 ${priceText(m.offer.price)}`;
  let list = setOfferStatus(snapshot.threads, msgId, "withdrawn");
  list = list.map((x) => (x.id === tid ? { ...x, messages: [...x.messages, sys(tid, line)] } : x));
  commit({ ...snapshot, threads: list });
}

/** 成交給某位買家：這則標已售出，成交那條插「已成交」，其他條插「這件已售出」 */
export function closeDeal(n: number, buyer: string, price: number | undefined, before: Sale) {
  const tid = threadId(n, buyer);
  const t = snapshot.threads.find((x) => x.id === tid);
  const offerMsg = t
    ? [...t.messages].reverse().find((m) => m.offer && m.offer.status !== "rejected")
    : undefined;
  const dealPrice = offerMsg?.offer?.price ?? price;
  let list = offerMsg ? setOfferStatus(snapshot.threads, offerMsg.id, "sold") : snapshot.threads;
  list = broadcast(list, n, (x) =>
    x.id === tid ? (dealPrice ? `已成交 ${priceText(dealPrice)}` : "已成交") : "這件已售出",
  );
  const sold: Sale = {
    state: "sold",
    price: before.price,
    soldPrice: dealPrice,
    soldTo: buyer,
    soldAt: now(),
  };
  commit({ ...snapshot, sales: { ...snapshot.sales, [n]: sold }, threads: list });
}

export function markRead(tid: string) {
  if (snapshot.unread.includes(tid)) commit({ ...snapshot, unread: snapshot.unread.filter((u) => u !== tid) });
}

export function useAppState() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
  const liked = useCallback((n: number) => state.liked.includes(n), [state]);
  const holds = useCallback((b: Bucket, key: string) => state[b].includes(key), [state]);
  /** 這則現在的出售狀態：本機改過的優先 */
  const saleOf = useCallback((s: Pick<ShareView, "n" | "sale">): Sale => state.sales[s.n] ?? s.sale, [state]);
  return { state, liked, holds, saleOf, ready: state.ready };
}
