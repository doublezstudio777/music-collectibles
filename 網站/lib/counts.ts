"use client";

// 讚數、我有／想要人數的顯示。
//
// 2026-09-28 起按讚、我有、想要不再讓整頁快取作廢（拿掉 likes／holdings 的內容版本觸發器），
// 頁面 HTML 裡的數字可能是舊的（最多到下一次內容更新或快取 5 分鐘到期）。所以：
// 1. 先顯示 HTML 裡的總數（useLiveCount：記下「拿到這份總數時自己按了沒」，扣回去再疊上現在的狀態）
// 2. 同一頁所有要顯示的數字集中成一個 /api/counts 小請求（等 30ms 收齊），拿到「扣掉自己」的人數後，
//    改顯示「別人的人數＋自己有沒有按」。按了馬上變，也不會有請求先後順序的問題
// 換帳號（登入、登出）時重抓。

import { useEffect, useState, useSyncExternalStore } from "react";
import { useAppState } from "@/lib/state";

type Snap = { total: number; who: string; mine: boolean };

export function useLiveCount(total: number, on: boolean): number {
  const { ready, me } = useAppState();
  const who = me?.id ?? "";
  const [snap, setSnap] = useState<Snap | null>(null);
  const stale = !snap || snap.total !== total || snap.who !== who;
  const cur = ready && stale ? { total, who, mine: on } : snap;
  if (ready && stale) setSnap(cur);
  if (!ready || !cur) return total;
  return total - (cur.mine ? 1 : 0) + (on ? 1 : 0);
}

type Kind = "likes" | "owned" | "wanted";
let who: string | null = null;
const data: Record<Kind, Map<string, number>> = { likes: new Map(), owned: new Map(), wanted: new Map() };
const asked = { s: new Set<string>(), v: new Set<string>() };
const queue = { s: new Set<string>(), v: new Set<string>() };
let timer: ReturnType<typeof setTimeout> | null = null;
let tick = 0;
const listeners = new Set<() => void>();

function reset(next: string) {
  who = next;
  (Object.keys(data) as Kind[]).forEach((k) => data[k].clear());
  asked.s.clear();
  asked.v.clear();
  tick++;
}

async function flush() {
  timer = null;
  const s = [...queue.s].slice(0, 90);
  const v = [...queue.v].slice(0, 90);
  s.forEach((x) => queue.s.delete(x));
  v.forEach((x) => queue.v.delete(x));
  if (queue.s.size || queue.v.size) timer = setTimeout(flush, 0);
  if (!s.length && !v.length) return;
  const q = new URLSearchParams();
  s.forEach((x) => q.append("s", x));
  v.forEach((x) => q.append("v", x));
  const owner = who;
  try {
    const r = await fetch(`/api/counts?${q}`, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok || owner !== who) return;
    const d = (await r.json()) as Record<Kind, Record<string, number>>;
    (Object.keys(data) as Kind[]).forEach((k) => Object.entries(d[k] ?? {}).forEach(([id, n]) => data[k].set(id, n)));
    tick++;
    listeners.forEach((l) => l());
  } catch {
    /* 拿不到就繼續顯示 HTML 裡的數字 */
  }
}

function ask(bucket: "s" | "v", id: string) {
  if (asked[bucket].has(id)) return;
  asked[bucket].add(id);
  queue[bucket].add(id);
  if (!timer) timer = setTimeout(flush, 30);
}

/** 別人的人數（扣掉自己）；還沒拿到回 undefined */
export function useFreshCount(kind: Kind, id: string | number): number | undefined {
  const { ready, me } = useAppState();
  const key = String(id);
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tick,
    () => 0,
  );
  const current = me?.id ?? "anon";
  useEffect(() => {
    if (!ready) return;
    if (who !== current) reset(current);
    ask(kind === "likes" ? "s" : "v", key);
  }, [ready, current, kind, key]);
  if (!ready || who !== current) return undefined;
  return data[kind].get(key);
}

/** 顯示用：拿到新數字就「別人＋自己」，還沒拿到就用 HTML 的總數換算 */
export function useShownCount(kind: Kind, id: string | number, base: number, on: boolean): number {
  const live = useLiveCount(base, on);
  const fresh = useFreshCount(kind, id);
  return fresh === undefined ? live : fresh + (on ? 1 : 0);
}
