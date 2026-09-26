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
// 第 1.5 階段加：追蹤藝人、示範帳號切換（認證／未認證）、檢舉、申訴、管理後台的門檻與裁決。
// 檢舉數＝data.ts 的示範計數＋自己這一票；達門檻就鎖，管理者裁決「解鎖」優先於門檻。
//
// 用 useSyncExternalStore：伺服器端與第一次渲染都是空狀態，
// 掛載後訂閱才讀 localStorage，避免 hydration 不一致。

import { useCallback, useSyncExternalStore } from "react";
import {
  appealSeeds,
  CURRENT_USER,
  DEFAULT_THRESHOLD,
  getShare,
  getUser,
  lockLabel,
  parentTargets,
  seedReportCount,
  shareTarget,
  targetLevel,
  toShareView,
  type Appeal,
  type ReportReason,
  type TargetKey,
  type TargetLevel,
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
  /** 追蹤的藝人 slug */
  follows: string[];
  /** 示範：目前用哪個帳號的認證狀態（小孟已認證、阿凱未認證） */
  account: string;
  /** 自己投的檢舉，每個對象一次 */
  reports: { target: TargetKey; reason: ReportReason; note: string }[];
  /** 管理後台：檢舉門檻 */
  threshold: number;
  /** 申訴（示範資料＋自己送的） */
  appeals: Appeal[];
  /** 管理者裁決：解鎖優先於門檻，維持鎖定則不看門檻 */
  decisions: Partial<Record<TargetKey, "unlocked" | "kept">>;
  ready: boolean;
};

const STORAGE_KEY = "yinzang.state.v4";
const OLD_KEY = "yinzang.state.v3";
const EMPTY: Snapshot = {
  owned: [], wanted: [], liked: [], myShares: [], sales: {}, threads: [], unread: [],
  follows: [], account: CURRENT_USER, reports: [], threshold: DEFAULT_THRESHOLD, appeals: [], decisions: {},
  ready: false,
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
    follows: me?.follows ?? [],
    account: CURRENT_USER,
    reports: [],
    threshold: DEFAULT_THRESHOLD,
    appeals: appealSeeds,
    decisions: {},
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
      // 上一版（第 1 階段）：出售、私訊、點讚、自己發的搬過來；我有／想要的鍵改成系列層格式，重新從示範資料起算
      const old = window.localStorage.getItem(OLD_KEY);
      const p = old ? (JSON.parse(old) as Partial<Snapshot>) : {};
      snapshot = {
        ...seed(),
        ...(p.liked ? { liked: p.liked } : {}),
        ...(p.sales ? { sales: p.sales } : {}),
        ...(p.threads ? { threads: p.threads } : {}),
        ...(p.unread ? { unread: p.unread } : {}),
        myShares: (p.myShares ?? []).map((s) => ({ ...s, kind: s.kind || "其他周邊", sale: s.sale ?? { state: "share" } })),
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

/**
 * 出價／我要買／接受／撤回前都要擋鎖定，跟單則頁同一個判斷來源 lockOfShare，
 * 不能只靠畫面藏按鈕（私訊頁可能漏擋，這裡是最後一道）。
 */
function shareForLock(n: number): Pick<ShareView, "n" | "link" | "local"> | undefined {
  const s = getShare(n);
  if (s) return toShareView(s);
  return snapshot.myShares.find((x) => x.n === n);
}

function isLockedShare(n: number): boolean {
  const s = shareForLock(n);
  return s ? Boolean(lockOfShare(snapshot, s)) : false;
}

/** 買家出價或按「我要買」：結構化訊息，回傳對話 id */
export function sendOffer(n: number, kind: OfferKind, price: number) {
  const tid = threadId(n, CURRENT_USER);
  if (isLockedShare(n)) return tid;
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
  if (isLockedShare(t.n)) return;
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
  if (isLockedShare(t.n)) return;
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
  const follows = useCallback((slug: string) => state.follows.includes(slug), [state]);
  const verified = Boolean(getUser(state.account)?.verified);
  return { state, liked, holds, saleOf, follows, verified, ready: state.ready };
}

/* ---------- 追蹤 ---------- */

export function toggleFollow(slug: string) {
  commit({ ...snapshot, follows: toggleIn(snapshot.follows, slug) });
}

/** 示範：清掉追蹤，看沒追蹤任何藝人的首頁 */
export function clearFollows() {
  commit({ ...snapshot, follows: [] });
}

/* ---------- 示範帳號 ---------- */

export function setAccount(handle: string) {
  commit({ ...snapshot, account: handle });
}

/* ---------- 檢舉、鎖定、申訴 ---------- */

export function report(target: TargetKey, reason: ReportReason, note: string) {
  if (snapshot.reports.some((r) => r.target === target)) return;
  if (!getUser(snapshot.account)?.verified) return;
  commit({ ...snapshot, reports: [...snapshot.reports, { target, reason, note: note.trim() }] });
}

export function submitAppeal(target: TargetKey, text: string, photos: string[]) {
  const appeal: Appeal = {
    id: `local-${Date.now().toString(36)}`,
    target,
    by: CURRENT_USER,
    time: "剛剛",
    text: text.trim(),
    photos,
    status: "pending",
  };
  return commit({ ...snapshot, appeals: [appeal, ...snapshot.appeals] });
}

export function decideAppeal(id: string, decision: "unlocked" | "kept") {
  const a = snapshot.appeals.find((x) => x.id === id);
  if (!a) return;
  commit({
    ...snapshot,
    appeals: snapshot.appeals.map((x) => (x.id === id ? { ...x, status: decision } : x)),
    decisions: { ...snapshot.decisions, [a.target]: decision },
  });
}

export function setThreshold(n: number) {
  if (!Number.isInteger(n) || n < 1) return;
  commit({ ...snapshot, threshold: n });
}

export type TargetState = { count: number; locked: boolean; mine: boolean; decision?: "unlocked" | "kept" };

export function targetState(state: Snapshot, t: TargetKey): TargetState {
  const mine = state.reports.some((r) => r.target === t);
  const count = seedReportCount(t) + (mine ? 1 : 0);
  const decision = state.decisions[t];
  const locked = !state.ready ? false : decision === "unlocked" ? false : decision === "kept" ? true : count >= state.threshold;
  return { count, locked, mine, decision };
}

export type Lock = { target: TargetKey; level: TargetLevel; label: string };

/** 這則收藏是否被鎖：品項、版本被鎖的優先顯示，其次這則本身 */
export function lockOfShare(state: Snapshot, s: Pick<ShareView, "n" | "link" | "local">): Lock | null {
  const targets: TargetKey[] = [...parentTargets(s.link), ...(s.local ? [] : [shareTarget(s.n)])];
  const hit = targets.find((t) => targetState(state, t).locked);
  return hit ? { target: hit, level: targetLevel(hit), label: lockLabel(targetLevel(hit)) } : null;
}

export function useLock(s: Pick<ShareView, "n" | "link" | "local">) {
  const { state } = useAppState();
  return lockOfShare(state, s);
}
