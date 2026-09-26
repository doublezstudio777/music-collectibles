// 音藏 — 資料型別與不需要查資料庫的純函式（網址、鍵、標籤文字）。
//
// 第 2b 階段起內容全部在 D1：伺服器端由 lib/server/content.ts 讀出來組成 lib/catalog.ts 的 Catalog，
// 頁面用 Catalog 查；示範內容只在 scripts/demo-data.ts，只有本機 seed 會用，網站程式不 import。
//
// 結構：藝人（含發行單位）→ 系列（一次發行或一場活動；網址掛在發行方底下，流水號）
//   → 品項（CD、卡帶、毛巾…，系列頁錨點 #cd）→ 版本（錨點 #cd-v1）→ 個人收藏（炫收藏）
// 讚數、我有、想要是資料庫實際計數；頁面拿到的是「其他人」的量，登入者自己那一下由前端疊上去。

export type DataStatus = "已確認" | "待確認" | "有爭議";

export type ArtistGender = "male" | "female" | "group";
export type ArtistRegion = "domestic" | "overseas";
export const GENDER_LABEL: Record<ArtistGender, string> = { male: "男歌手", female: "女歌手", group: "團體" };
export const REGION_LABEL: Record<ArtistRegion, string> = { domestic: "國內", overseas: "國外" };

/*
 * 物件類型（2026-09-26 定案改點選）：表單、商品卡、單則頁用同一套名字。
 * 示範資料裡原本自由填的類型，由 normKind 對到這一套；對不到的歸「其他周邊」並保留原字當補充。
 */
export const KINDS = ["CD", "黑膠", "卡帶", "藍光／DVD", "毛巾", "T 恤", "海報", "場刊", "其他周邊"] as const;
export type Kind = (typeof KINDS)[number];
const KIND_ALIAS: Record<string, Kind> = {
  "CD-R": "CD", 藍光: "藍光／DVD", "Blu-ray": "藍光／DVD", DVD: "藍光／DVD", T恤: "T 恤",
};
export const normKind = (raw: string): { kind: Kind; note?: string } => {
  if (!raw) return { kind: "其他周邊" };
  if ((KINDS as readonly string[]).includes(raw)) return { kind: raw as Kind };
  if (KIND_ALIAS[raw]) return { kind: KIND_ALIAS[raw], note: raw === "CD-R" ? raw : undefined };
  return { kind: "其他周邊", note: raw };
};

/** og:description 沒有故事時的物件類型預設字 */
export const KIND_LABEL_FALLBACK = "收藏";

export type Artist = {
  /** 網址識別碼：英文名或音譯，小寫、連字號 */
  slug: string;
  name: string;
  /** 撞名比對用：英文名、常見寫法 */
  aliases: string[];
  kind: "藝人" | "發行單位";
  /** 表單分類用：男歌手／女歌手／團體；發行單位不分 */
  gender?: ArtistGender;
  /** 表單分類用：國內／國外 */
  region?: ArtistRegion;
  /** 名字下面那一行定位 */
  tagline: string;
  intro: string[];
  awards: { year: string; award: string; category: string; result: "入圍" | "得獎" }[];
  lastEdit: { by: string; date: string };
  /** 簡介取自維基百科時的來源（CC BY-SA 4.0） */
  wiki?: { url: string; license: string };
  /** 藝人頁顯示：auto＝有系列或收藏才顯示；on／off＝管理員強制 */
  display?: "auto" | "on" | "off";
};

export type Version = {
  /** 品項內的編號，v1、v2…；錨點是 #{品項}-{v1} */
  id: string;
  edition: string;
  year: string;
  region: string;
  label: string;
  catalog: string;
  barcode: string;
  packaging: string;
  contents: string;
  tracks: string;
  /** 辨識特徵，比較表第一列 */
  identifyBy: string;
  /** 正版辨識：逐項特徵，photo 是照片說明（示範用灰色塊代替） */
  marks?: Mark[];
  /** 已知仿冒 */
  fakes?: Fake[];
  status: DataStatus;
  /** 其他人的我有／想要人數 */
  owners: number;
  wanted: number;
  color: string;
};

export type Mark = { label: string; text: string; photo?: string };
export type Fake = {
  name: string;
  /** 在哪裡出現過 */
  seen: string;
  rows: { label: string; genuine: string; fake: string }[];
};

/** 品項：同一系列裡的一種東西（CD、卡帶、毛巾…），錨點 #cd */
export type Item = {
  id: string;
  kind: Kind;
  versions: Version[];
};

/** 系列：一次發行或一場活動。網址 /artist/{發行方}/{流水號}，品項與版本用錨點 */
export type Series = {
  /** 網址掛在誰底下：發行方 */
  artistSlug: string;
  /** 發行方底下的流水號，永不重用 */
  no: number;
  /** 短名，卡片與連結用 */
  title: string;
  /** 全名：2018《夜行採集》專輯發行 */
  name: string;
  /** 專輯發行、巡迴演唱會、音樂祭… */
  seriesType: string;
  /** 共同署名：每位都列主要系列 */
  credits: string[];
  year: string;
  body: string[];
  /** 合作與客串：不算對方的主要系列 */
  guests: { artistSlug: string; role: string; track: string }[];
  /** 合輯收錄 */
  compilation: { artistSlug: string; track: string }[];
  items: Item[];
  lastEdit: { by: string; date: string };
};

/** 出售狀態：純分享（預設）／開放出價／定價出售／已售出。錢貨不經過平台，成交後雙方自己約 */
export type SaleState = "share" | "offer" | "sale" | "sold";

export type Sale = {
  state: SaleState;
  /** 定價出售的價格；已售出時是原本的標價 */
  price?: number;
  /** 已售出：成交價、成交對象、成交時間 */
  soldPrice?: number;
  soldTo?: string;
  soldAt?: string;
};

export type Share = {
  n: number;
  author: string;
  time: string;
  /** 越大越新，排序用 */
  order: number;
  /** 是什麼東西（必填） */
  what: string;
  /** 物件類型，自由字串，封面色塊右下角那個字 */
  kind: string;
  story: string;
  /** 跟誰有關（必填，至少一個） */
  about: string[];
  tags: string[];
  /** 其他人的讚數 */
  likes: number;
  color: string;
  image?: string;
  /** 縮圖網址；D1 讀出來的才有 */
  thumb?: string;
  /** 作者顯示名稱；D1 讀出來的才有 */
  authorName?: string;
  link?: { series: string; item?: string; version?: string };
  sale?: Sale;
  /** 發文者同意照片當辨識參考 */
  refPhoto?: boolean;
};

/** 示範資料用的使用者形狀（scripts/demo-data.ts）；網站本身的帳號在 D1 users 表 */
export type User = {
  handle: string;
  name: string;
  initials: string;
  bio: string;
  /** 版本鍵：`{藝人}/{流水號}#v1` */
  owned: string[];
  wanted: string[];
  liked: number[];
  /** 認證帳號才能檢舉 */
  verified: boolean;
  /** 追蹤的藝人 slug */
  follows: string[];
};



export type OfferKind = "offer" | "buy";
/** open 等賣家回；accepted 賣家接受、還沒成交；rejected 賣家拒絕；withdrawn 買家自己撤回；sold 成交的那一筆 */
export type OfferStatus = "open" | "accepted" | "rejected" | "withdrawn" | "sold";

export type Message = {
  id: string;
  /** 使用者帳號；"system" 是狀態變化的灰字 */
  from: string;
  time: string;
  text?: string;
  offer?: { kind: OfferKind; price: number; status: OfferStatus };
};

export type Thread = { id: string; n: number; buyer: string; messages: Message[] };

export const priceText = (p: number) => `NT$ ${p.toLocaleString("en-US")}`;

export const seriesKey = (w: Series) => `${w.artistSlug}/${w.no}`;
export const getItem = (w: Series, itemId?: string) => (itemId ? w.items.find((i) => i.id === itemId) : undefined);
export const versionCount = (w: Series) => w.items.reduce((n, i) => n + i.versions.length, 0);

export const artistHref = (slug: string) => `/artist/${slug}`;
export const seriesHref = (w: Series) => `/artist/${w.artistSlug}/${w.no}`;
/** 錨點：品項 #cd、版本 #cd-v1 */
export const itemAnchor = (item: Item) => item.id;
export const versionAnchor = (item: Item, v: Version) => `${item.id}-${v.id}`;
export const itemHref = (w: Series, item: Item) => `${seriesHref(w)}#${itemAnchor(item)}`;
export const versionHref = (w: Series, item: Item, v: Version) => `${seriesHref(w)}#${versionAnchor(item, v)}`;
export const tagHref = (tag: string) => `/tag/${encodeURIComponent(tag)}`;
export const shareHref = (n: number) => `/share/${n}`;
export const userHref = (handle: string) => `/u/${handle}`;

/** 版本鍵 `{發行方}/{流水號}#cd-v1`，我有／想要、檢舉用 */
export const versionKey = (w: Series, item: Item, v: Version) => `${seriesKey(w)}#${versionAnchor(item, v)}`;
/** 品項鍵 `{發行方}/{流水號}#cd`，檢舉用 */
export const itemKey = (w: Series, item: Item) => `${seriesKey(w)}#${itemAnchor(item)}`;

export const norm = (s: string) => s.trim().toLowerCase();

/* ---------- 給畫面的平面資料（可以傳進 client component） ---------- */

export type Lock = { target: TargetKey; level: TargetLevel; label: string };

export type ShareView = {
  n: number;
  what: string;
  /** 統一後的物件類型 */
  kind: Kind;
  /** 其他周邊的補充，或 CD-R 這類細分 */
  kindNote?: string;
  refPhoto?: boolean;
  story: string;
  time: string;
  order: number;
  about: string[];
  tags: string[];
  /** 其他人的讚數（資料庫計數扣掉目前登入者自己那一下） */
  likes: number;
  color: string;
  /** 主圖、縮圖網址（/img/...） */
  image?: string;
  thumb?: string;
  author: { handle: string; name: string; initials: string };
  link?: { href: string; label: string; seriesKey: string; itemId?: string; versionId?: string };
  sale: Sale;
  /** 跟哪些藝人有關（跟誰有關＋標籤撞名），首頁「追蹤中」用 */
  aboutSlugs: string[];
  /** 連到的版本有已知仿冒 */
  hasFakes: boolean;
  /** 伺服器算好的鎖定（跟 API 擋交易同一個判斷） */
  lock: Lock | null;
};

/** 我有／想要清單列（個人頁用） */
export type HoldingView = {
  key: string;
  title: string;
  artists: string;
  edition: string;
  year: string;
  format: string;
  catalog: string;
  href: string;
  color: string;
};

/* ---------- 檢舉、鎖定、申訴 ----------
 * 2026-09-26 定案：
 * - 單則收藏檢舉「盜版／仿冒」；系列裡的某個品項或版本檢舉「官方沒出過」（系列層定案）
 * - 只有認證帳號可檢舉，每個帳號對同一對象一次
 * - 達門檻（預設 10，可在管理後台調）＝醒目標示＋不能定價與出價＋既有出價凍結，內容照常可看
 * - 品項或版本被鎖，底下所有收藏都不能交易
 * - 被鎖的發文者向音藏申訴，管理者看過才解鎖，不自動解鎖
 */

export type ReportReason = "fake" | "never" | "other";

/** 對象鍵：`share:8`、`item:tide-highway/3#towel`、`version:faint-signal/1#cd-v1` */
export type TargetKey = `share:${number}` | `item:${string}` | `version:${string}`;
export type TargetLevel = "share" | "item" | "version";
export const shareTarget = (n: number): TargetKey => `share:${n}`;
export const itemTarget = (key: string): TargetKey => `item:${key}`;
export const versionTarget = (key: string): TargetKey => `version:${key}`;
export const targetLevel = (t: TargetKey): TargetLevel => t.slice(0, t.indexOf(":")) as TargetLevel;

/** 各層可選的理由 */
export const reasonsFor = (level: TargetLevel): { key: ReportReason; label: string }[] =>
  level === "share"
    ? [
        { key: "fake", label: "盜版／仿冒" },
        { key: "other", label: "其他" },
      ]
    : [
        { key: "never", label: level === "item" ? "官方沒出過這個品項" : "官方沒出過這個版本" },
        { key: "other", label: "其他" },
      ];

export const reasonLabel = (level: TargetLevel, r: ReportReason) =>
  reasonsFor(level).find((x) => x.key === r)?.label ?? "其他";

/** 達門檻後的醒目標示 */
export const lockLabel = (level: TargetLevel) =>
  level === "share" ? "多人檢舉：疑似盜版" : level === "item" ? "爭議品項：官方未證實發行" : "爭議版本：官方未證實發行";

export const DEFAULT_THRESHOLD = 10;

export type AppealStatus = "pending" | "unlocked" | "kept";
export type Appeal = {
  id: string;
  target: TargetKey;
  by: string;
  time: string;
  text: string;
  /** 證據照片網址 */
  photos: string[];
  /** 示範資料沒有真照片，用說明文字畫成灰色塊 */
  photoNotes?: string[];
  status: AppealStatus;
};

/** 一則收藏往上掛的品項與版本對象（版本或品項被鎖，底下收藏都不能交易） */
export const parentTargets = (link?: { seriesKey: string; itemId?: string; versionId?: string }): TargetKey[] => {
  if (!link?.itemId) return [];
  const out: TargetKey[] = [itemTarget(`${link.seriesKey}#${link.itemId}`)];
  if (link.versionId) out.push(versionTarget(`${link.seriesKey}#${link.itemId}-${link.versionId}`));
  return out;
};


/* ---------- 鎖定判斷（頁面與 API 共用，唯一的一份） ---------- */

export type LockData = {
  /** 每個對象的檢舉人數 */
  counts: Record<string, number>;
  /** 管理者裁決：unlocked 優先於門檻，kept 不看門檻 */
  decisions: Record<string, "unlocked" | "kept">;
  threshold: number;
};

export const isTargetLocked = (d: LockData, t: TargetKey) => {
  const decision = d.decisions[t];
  if (decision === "unlocked") return false;
  if (decision === "kept") return true;
  return (d.counts[t] ?? 0) >= d.threshold;
};

/** 一則收藏的鎖：品項、版本被鎖的優先，其次這則本身 */
export const lockFor = (
  d: LockData,
  shareNo: number,
  link?: { seriesKey: string; itemId?: string; versionId?: string },
): Lock | null => {
  const targets: TargetKey[] = [...parentTargets(link), shareTarget(shareNo)];
  const hit = targets.find((t) => isTargetLocked(d, t));
  return hit ? { target: hit, level: targetLevel(hit), label: lockLabel(targetLevel(hit)) } : null;
};

/** ISO 時間 → 「剛剛／3 小時前／昨天／9 月 19 日」 */
export const relTime = (iso: string, nowMs = Date.now()) => {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.floor((nowMs - t) / 60000);
  if (min < 1) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小時前`;
  const d = Math.floor(h / 24);
  if (d === 1) return "昨天";
  if (d < 7) return `${d} 天前`;
  const dt = new Date(t + 8 * 3600_000);
  return `${dt.getUTCMonth() + 1} 月 ${dt.getUTCDate()} 日`;
};
