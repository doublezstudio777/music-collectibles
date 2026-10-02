// 我的頁面（2026-09-30）：自我介紹、社群連結、最喜歡的藝人。前後端共用，只放純函式。
//
// - 自我介紹：200 字（字元算，emoji、中文都算一個），保留換行；整理規則跟留言一樣（cleanComment），
//   站外交易字眼（連結、LINE、匯款…）跟留言用同一份 looksOffsite，但自我介紹不給過：
//   留言有「小心站外交易」提醒可以掛，個人頁的自介沒有，社群連結另外有欄位
// - 社群連結：只收 IG、Threads、YouTube、Facebook 四欄，各自只收自己的網域（含子網域 www.／m.），只收 https
// - 最喜歡的藝人：最多 5 位，只能選前台看得到的藝人（伺服器存之前查）

import { charCount, cleanComment, looksOffsite } from "@/lib/comment-rules";

export const BIO_MAX = 200;
export const FAV_MAX = 5;
export const LINK_MAX = 300;

export const SOCIALS = [
  { key: "ig", label: "Instagram", hosts: ["instagram.com"], example: "https://www.instagram.com/帳號" },
  { key: "threads", label: "Threads", hosts: ["threads.net", "threads.com"], example: "https://www.threads.com/@帳號" },
  { key: "youtube", label: "YouTube", hosts: ["youtube.com", "youtu.be"], example: "https://www.youtube.com/@頻道" },
  { key: "facebook", label: "Facebook", hosts: ["facebook.com", "fb.com"], example: "https://www.facebook.com/帳號" },
] as const;
export type SocialKey = (typeof SOCIALS)[number]["key"];
export type Links = Partial<Record<SocialKey, string>>;

/** 自我介紹：整理後的字，或錯誤訊息 */
export function checkBio(raw: string): { ok: true; bio: string } | { ok: false; message: string } {
  const bio = cleanComment(raw);
  if (charCount(bio) > BIO_MAX) return { ok: false, message: `自我介紹最多 ${BIO_MAX} 字` };
  if (bio && looksOffsite(bio)) {
    return { ok: false, message: "自我介紹不能放網址、通訊軟體帳號或匯款字眼，社群連結請填在下面的欄位" };
  }
  return { ok: true, bio };
}

/**
 * 一個社群連結：空字串＝清掉；沒寫 https:// 自動補上；http:// 或其他協定一律擋。
 * 網域要是這一欄自己的（IG 欄不收 YouTube），不能帶帳密、不能指定連接埠，要有路徑（只貼網域首頁不算）
 */
export function checkLink(key: SocialKey, raw: string): { ok: true; url: string } | { ok: false; message: string } {
  const s = SOCIALS.find((x) => x.key === key)!;
  const v = raw.trim();
  if (!v) return { ok: true, url: "" };
  if (v.length > LINK_MAX) return { ok: false, message: `${s.label} 網址太長` };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, message: `${s.label} 網址格式不對` };
  }
  if (u.protocol !== "https:") return { ok: false, message: `${s.label} 只收 https:// 開頭的網址` };
  if (u.username || u.password || u.port) return { ok: false, message: `${s.label} 網址格式不對` };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, message: `${s.label} 欄只收 ${s.hosts.join("、")} 的網址` };
  }
  // 平台自己的轉址頁不收（2026-10-02 總檢 L8）：l.facebook.com/l.php?u=…、l.instagram.com、youtube.com/redirect 這類會把人帶到站外
  const sub = host.split(".")[0];
  if (/^(l|lm|link|links|redirect|out)$/.test(sub) && host !== s.hosts[0]) return { ok: false, message: `${s.label} 要貼個人頁面的網址，不是轉址連結` };
  if (/^\/(l\.php|redirect|linkshim|away|out)(\/|$)/i.test(u.pathname) || u.searchParams.has("u") || u.searchParams.has("q") && u.pathname.includes("redirect")) {
    return { ok: false, message: `${s.label} 要貼個人頁面的網址，不是轉址連結` };
  }
  if (u.pathname.replace(/\/+$/, "") === "" && !u.search) return { ok: false, message: `${s.label} 要貼個人頁面的網址，不是首頁` };
  u.hash = "";
  return { ok: true, url: u.href };
}

/** 資料庫的 JSON 讀回來（壞掉或不是白名單的一律丟掉，不讓舊資料繞過驗證） */
export function parseLinks(json: string | null | undefined): Links {
  let o: unknown;
  try {
    o = JSON.parse(json || "{}");
  } catch {
    return {};
  }
  const out: Links = {};
  if (!o || typeof o !== "object") return out;
  for (const s of SOCIALS) {
    const v = (o as Record<string, unknown>)[s.key];
    if (typeof v !== "string" || !v) continue;
    const r = checkLink(s.key, v);
    if (r.ok && r.url) out[s.key] = r.url;
  }
  return out;
}

export function parseFavs(json: string | null | undefined): string[] {
  try {
    const a = JSON.parse(json || "[]");
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string").slice(0, FAV_MAX) : [];
  } catch {
    return [];
  }
}
