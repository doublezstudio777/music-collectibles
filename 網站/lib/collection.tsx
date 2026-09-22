"use client";

// 我有／我想要／已儲存的本機狀態。
//
// 階段 0 沒有帳號與資料庫，狀態存在瀏覽器的 localStorage，
// 換裝置或清快取就會消失。這是刻意的：先確認介面方向，再導入帳號。
//
// 「已儲存」與「我有」分開，依 00_現況.md：
// 留著以後看的儲存不表示持有。
//
// 用 useSyncExternalStore 而不是 useEffect + setState：
// localStorage 在伺服器端不存在，第一次渲染必須跟伺服器一致（全空），
// 等掛載後訂閱時才讀取，否則會 hydration 不一致。

import { useCallback, useSyncExternalStore } from "react";

export type Bucket = "owned" | "wanted" | "saved";

type Snapshot = {
  owned: string[];
  wanted: string[];
  saved: string[];
  /** 是否已讀過 localStorage。未就緒時不要顯示空狀態，會閃一下 */
  ready: boolean;
};

const STORAGE_KEY = "yinzang.collection.v1";
const SERVER_SNAPSHOT: Snapshot = { owned: [], wanted: [], saved: [], ready: false };

let snapshot: Snapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;

  // 無痕視窗、封鎖站台資料或預覽環境都可能讓讀取直接丟例外
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<Snapshot>) : {};
    snapshot = {
      owned: parsed.owned ?? [],
      wanted: parsed.wanted ?? [],
      saved: parsed.saved ?? [],
      ready: true,
    };
  } catch {
    snapshot = { owned: [], wanted: [], saved: [], ready: true };
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // 訂閱發生在掛載之後，這時候讀 localStorage 不會影響 hydration
  hydrateOnce();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => snapshot;
const getServerSnapshot = () => SERVER_SNAPSHOT;

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 忽略，狀態在記憶體裡仍然有效
  }
}

function toggleKey(bucket: Bucket, key: string) {
  const list = snapshot[bucket];
  const next = list.includes(key) ? list.filter((item) => item !== key) : [...list, key];
  snapshot = { ...snapshot, [bucket]: next };
  persist();
  emit();
}

export function useCollection() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const has = useCallback(
    (bucket: Bucket, key: string) => state[bucket].includes(key),
    [state],
  );

  const toggle = useCallback((bucket: Bucket, key: string) => toggleKey(bucket, key), []);

  return { state, has, toggle, ready: state.ready };
}
