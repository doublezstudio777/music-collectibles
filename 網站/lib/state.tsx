"use client";

// 目前使用者的本機狀態：點讚（＝喜愛清單）、我有、想要、自己發的炫收藏。
//
// 還沒有帳號與資料庫，狀態存在 localStorage，換裝置或清快取就會消失。
// 第一次開啟時用 data.ts 裡示範登入者（CURRENT_USER）的資料當起點。
//
// 點讚與我有／想要分開存：點讚是「留著以後看」，不代表持有。
//
// 用 useSyncExternalStore：伺服器端與第一次渲染都是空狀態，
// 掛載後訂閱才讀 localStorage，避免 hydration 不一致。

import { useCallback, useSyncExternalStore } from "react";
import { CURRENT_USER, getUser, type ShareView } from "@/lib/data";

export type Bucket = "owned" | "wanted";

type Snapshot = {
  owned: string[];
  wanted: string[];
  liked: number[];
  myShares: ShareView[];
  ready: boolean;
};

const STORAGE_KEY = "yinzang.state.v2";
const EMPTY: Snapshot = { owned: [], wanted: [], liked: [], myShares: [], ready: false };

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
    ready: true,
  };
}

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      snapshot = seed();
    } else {
      const p = JSON.parse(raw) as Partial<Snapshot>;
      snapshot = {
        owned: p.owned ?? [],
        wanted: p.wanted ?? [],
        liked: p.liked ?? [],
        myShares: p.myShares ?? [],
        ready: true,
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
    const { owned, wanted, liked, myShares } = snapshot;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ owned, wanted, liked, myShares }));
    return true;
  } catch {
    return false;
  }
}

function toggleIn<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function toggleHolding(bucket: Bucket, key: string) {
  snapshot = { ...snapshot, [bucket]: toggleIn(snapshot[bucket], key) };
  persist();
  emit();
}

export function toggleLike(n: number) {
  snapshot = { ...snapshot, liked: toggleIn(snapshot.liked, n) };
  persist();
  emit();
}

/** 回傳新分享的流水號；存不進去（容量滿）回傳 null */
export function addMyShare(draft: Omit<ShareView, "n" | "order" | "local">): number | null {
  const n = Math.max(1000, ...snapshot.myShares.map((s) => s.n)) + 1;
  const share: ShareView = { ...draft, n, order: 1000 + n, local: true };
  const prev = snapshot;
  snapshot = { ...snapshot, myShares: [share, ...snapshot.myShares] };
  if (!persist()) {
    snapshot = prev;
    return null;
  }
  emit();
  return n;
}

export function useAppState() {
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
  const liked = useCallback((n: number) => state.liked.includes(n), [state]);
  const holds = useCallback((b: Bucket, key: string) => state[b].includes(key), [state]);
  return { state, liked, holds, ready: state.ready };
}
