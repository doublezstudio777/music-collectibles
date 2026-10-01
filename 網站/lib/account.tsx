"use client";

// 登入狀態＋存在 D1 的個人狀態（點讚、我有、想要、追蹤）。
// 全部經 /api/...（App 之後打同一組端點）。未登入按這四種按鈕 → 開登入小面板，
// 登入成功後把剛剛那個動作補做，留在原頁。
//
// 寫入走樂觀更新：先改畫面再送 API，失敗就退回並提示。

import { useSyncExternalStore } from "react";
import { track } from "@/lib/analytics";

export type Me = {
  id: string;
  email: string;
  handle: string;
  name: string;
  bio: string;
  role: string;
  verified: boolean;
  admin: boolean;
  deletionRequested: boolean;
  /** 大頭貼網址（沒有是 null） */
  avatar?: string | null;
  /** 下次可以改暱稱的時間（ISO）；現在就能改是 null */
  nameNextAt?: string | null;
  /** 已同意現行版使用條款與隱私權政策（2026-10-01） */
  termsOk?: boolean;
};

export type PanelMode = "login" | "register" | "verify" | "forgot" | "reset";

type Account = {
  status: "loading" | "anon" | "user";
  me: Me | null;
  liked: number[];
  owned: string[];
  wanted: string[];
  follows: string[];
  /** 自己檢舉過的對象 */
  reported: string[];
  /** 自己的申訴 */
  appeals: { target: string; status: string }[];
  /** 有未讀的對話數 */
  unread: number;
  /** 熱門藝人按過「不感興趣」的 */
  dismissed: string[];
  /** 登入小面板：開著時的模式與一句原因（「登入後才能點讚」） */
  panel: { mode: PanelMode; reason?: string; email?: string } | null;
  /** 最近一次寫入失敗的訊息 */
  error: string | null;
  /** 條款補同意視窗開著（登入後發現沒同意現行版、或寫入 API 回 TERMS_REQUIRED 時打開） */
  consent: boolean;
  /** 當下連線國家與能不能交易（交易只限台灣）；讀到之前當作可以，避免台灣使用者閃一下提示 */
  geo: { country: string; canTrade: boolean };
};

const EMPTY: Account = {
  status: "loading", me: null, liked: [], owned: [], wanted: [], follows: [], reported: [], appeals: [], unread: 0, dismissed: [],
  panel: null, error: null, consent: false, geo: { country: "", canTrade: true },
};
const SIGNED_OUT = { status: "anon" as const, me: null, liked: [], owned: [], wanted: [], follows: [], reported: [], appeals: [], unread: 0, dismissed: [], consent: false };

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

/** 同站呼叫：cookie 自動帶，錯誤統一成 { code, message }。body 是 FormData 時原樣送（上傳） */
export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const form = typeof FormData !== "undefined" && init?.body instanceof FormData;
    const res = await fetch(path, {
      method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
      headers: init?.body === undefined || form ? undefined : { "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
      credentials: "same-origin",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: ApiError };
    if (!res.ok) {
      // 條款改版後還沒同意（2026-10-01）：打開補同意視窗，呼叫端照常顯示錯誤訊息
      if (data.error?.code === "TERMS_REQUIRED") set({ consent: true });
      return { ok: false, status: res.status, error: data.error ?? { code: "HTTP", message: "出了點問題，再試一次" } };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, status: 0, error: { code: "NETWORK", message: "連不上網站，檢查網路再試" } };
  }
}

type MeResponse = {
  geo?: Account["geo"];
  user: Me | null;
  state: Pick<Account, "liked" | "owned" | "wanted" | "follows" | "reported" | "appeals" | "unread" | "dismissed"> | null;
};

export async function refreshAccount() {
  const r = await api<MeResponse>("/api/me");
  const geo = r.ok && r.data.geo ? r.data.geo : acc.geo;
  if (!r.ok || !r.data.user || !r.data.state) {
    set({ ...SIGNED_OUT, geo });
    return;
  }
  set({ status: "user", me: r.data.user, ...r.data.state, geo, consent: r.data.user.termsOk === false && !consentDismissed() });
}

/* ---------- 條款補同意（2026-10-01） ---------- */

// 按「稍後再說」後這個分頁不再自動跳（sessionStorage），寫入被擋時照樣會打開
const DISMISS_KEY = "yz_terms_later";
const consentDismissed = () => {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
};

export function closeConsent(later: boolean) {
  if (later) {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* 無痕模式存不了就算了 */
    }
  }
  set({ consent: false });
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
  set({ ...SIGNED_OUT, panel: null });
}

/* ---------- 四種個人狀態 ---------- */

const toggled = <T,>(list: T[], item: T, on: boolean) =>
  on ? (list.includes(item) ? list : [...list, item]) : list.filter((x) => x !== item);

async function write<K extends "liked" | "owned" | "wanted" | "follows" | "dismissed">(
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
    if (on) track("wishlist_add", { type: "收藏" });
    void write("liked", n, on, "/api/me/likes", { share: n, on });
  });
}

export function toggleHolding(bucket: "owned" | "wanted", key: string) {
  requireLogin(bucket === "owned" ? "登入後才能標記我有" : "登入後才能加入願望清單", (late) => {
    const on = late || !acc[bucket].includes(key);
    if (on && bucket === "wanted") track("wishlist_add", { type: "版本" });
    void write(bucket, key, on, "/api/me/holdings", { kind: bucket, key, on });
  });
}

/**
 * 一次登記多個「我有」（2026-10-01 合集「把這些也登記成擁有」）：只加不減。
 * 回傳實際登記的鍵與找不到的鍵；畫面上的我有清單跟著補上
 */
export async function addOwnedMany(keys: string[]): Promise<{ ok: true; added: string[]; missing: string[] } | { ok: false; message: string }> {
  const r = await api<{ added: string[]; missing: string[] }>("/api/me/holdings/batch", { body: { keys } });
  if (!r.ok) {
    if (r.status === 401) await refreshAccount();
    return { ok: false, message: r.error.message };
  }
  set({ owned: Array.from(new Set([...acc.owned, ...r.data.added])) });
  return { ok: true, ...r.data };
}

export function toggleFollow(slug: string) {
  requireLogin("登入後才能追蹤藝人", (late) => {
    const on = late || !acc.follows.includes(slug);
    void write("follows", slug, on, "/api/me/follows", { artist: slug, on });
  });
}

/** 熱門藝人「不感興趣」：之後不再推薦 */
export function dismissArtist(slug: string) {
  requireLogin("登入後才能標記不感興趣", () => {
    void write("dismissed", slug, true, "/api/me/dismissals", { artist: slug, on: true });
  });
}

export async function clearFollows() {
  if (acc.status !== "user") return;
  const before = acc.follows;
  set({ follows: [] });
  const r = await api("/api/me/follows", { method: "DELETE" });
  if (!r.ok) set({ follows: before, error: r.error.message });
}

/** 登入後才能做的動作（出價、發文、檢舉…）：沒登入先開面板 */
export function whenLoggedIn(reason: string, action: () => void) {
  requireLogin(reason, () => action());
}

export function setMe(me: Me) {
  set({ me });
}
