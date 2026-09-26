"use client";

// 登入狀態＋存在 D1 的個人狀態（點讚、我有、想要、追蹤）。
// 全部經 /api/...（App 之後打同一組端點）。未登入按這四種按鈕 → 開登入小面板，
// 登入成功後把剛剛那個動作補做，留在原頁。
//
// 寫入走樂觀更新：先改畫面再送 API，失敗就退回並提示。

import { useSyncExternalStore } from "react";

export type Me = {
  id: string;
  email: string;
  handle: string;
  name: string;
  bio: string;
  role: string;
  verified: boolean;
};

export type PanelMode = "login" | "register" | "verify" | "forgot" | "reset";

type Account = {
  status: "loading" | "anon" | "user";
  me: Me | null;
  liked: number[];
  owned: string[];
  wanted: string[];
  follows: string[];
  /** 登入小面板：開著時的模式與一句原因（「登入後才能點讚」） */
  panel: { mode: PanelMode; reason?: string; email?: string } | null;
  /** 最近一次寫入失敗的訊息 */
  error: string | null;
};

const EMPTY: Account = {
  status: "loading", me: null, liked: [], owned: [], wanted: [], follows: [], panel: null, error: null,
};

let acc: Account = EMPTY;
let started = false;
let pending: ((afterLogin: boolean) => void) | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<Account>) => {
  acc = { ...acc, ...patch };
  listeners.forEach((l) => l());
};

type ApiError = { code: string; message: string; email?: string; wait?: number };
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError };

/** 同站呼叫：cookie 自動帶，錯誤統一成 { code, message } */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: ApiError };
    if (!res.ok) return { ok: false, status: res.status, error: data.error ?? { code: "HTTP", message: "出了點問題，再試一次" } };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: { code: "NETWORK", message: "連不上網站，檢查網路再試" } };
  }
}

type MeResponse = {
  user: Me | null;
  state: { liked: number[]; owned: string[]; wanted: string[]; follows: string[] } | null;
};

export async function refreshAccount() {
  const r = await api<MeResponse>("/api/me");
  if (!r.ok || !r.data.user || !r.data.state) {
    set({ status: "anon", me: null, liked: [], owned: [], wanted: [], follows: [] });
    return;
  }
  set({ status: "user", me: r.data.user, ...r.data.state });
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (!started) {
    started = true;
    void refreshAccount();
  }
  return () => {
    listeners.delete(l);
  };
}

export function useAccount() {
  return useSyncExternalStore(subscribe, () => acc, () => EMPTY);
}

/* ---------- 登入面板 ---------- */

export function openPanel(mode: PanelMode, reason?: string, email?: string) {
  set({ panel: { mode, reason, email } });
}

export function clearError() {
  set({ error: null });
}

export function closePanel() {
  pending = null;
  set({ panel: null });
}

/**
 * 已登入就直接做；沒登入先開面板，登入成功再做。
 * 登入後補做時 afterLogin=true：訪客看到的按鈕都是「沒按」，所以補做一律是「打開」，
 * 不會把帳號裡本來就按過的反而取消掉。
 */
export function requireLogin(reason: string, action: (afterLogin: boolean) => void) {
  if (acc.status === "user") return action(false);
  pending = action;
  set({ panel: { mode: "login", reason } });
}

/** 面板登入／驗證成功後呼叫：載入個人狀態，再補做剛剛的動作 */
export async function afterLogin() {
  await refreshAccount();
  const run = pending;
  pending = null;
  set({ panel: null });
  run?.(true);
}

export async function logout() {
  await api("/api/auth/logout", { body: {} });
  pending = null;
  set({ status: "anon", me: null, liked: [], owned: [], wanted: [], follows: [], panel: null });
}

/* ---------- 四種個人狀態 ---------- */

const toggled = <T,>(list: T[], item: T, on: boolean) =>
  on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);

async function write<K extends "liked" | "owned" | "wanted" | "follows">(
  field: K,
  item: Account[K][number],
  on: boolean,
  path: string,
  body: unknown,
) {
  const before = acc[field];
  set({ [field]: toggled(before as never[], item as never, on), error: null } as Partial<Account>);
  const r = await api(path, { body });
  if (!r.ok) {
    set({ [field]: before, error: r.error.message } as Partial<Account>);
    if (r.status === 401) await refreshAccount();
  }
}

export function toggleLike(n: number) {
  requireLogin("登入後才能點讚", (late) => {
    const on = late || !acc.liked.includes(n);
    void write("liked", n, on, "/api/me/likes", { share: n, on });
  });
}

export function toggleHolding(bucket: "owned" | "wanted", key: string) {
  requireLogin(bucket === "owned" ? "登入後才能標記我有" : "登入後才能標記想要", (late) => {
    const on = late || !acc[bucket].includes(key);
    void write(bucket, key, on, "/api/me/holdings", { kind: bucket, key, on });
  });
}

export function toggleFollow(slug: string) {
  requireLogin("登入後才能追蹤藝人", (late) => {
    const on = late || !acc.follows.includes(slug);
    void write("follows", slug, on, "/api/me/follows", { artist: slug, on });
  });
}

export async function clearFollows() {
  if (acc.status !== "user") return;
  const before = acc.follows;
  set({ follows: [] });
  const r = await api("/api/me/follows", { method: "DELETE" });
  if (!r.ok) set({ follows: before, error: r.error.message });
}
