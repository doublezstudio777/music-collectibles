// 樂迷藏 — 資料型別與不需要查資料庫的純函式（網址、鍵、標籤文字）。
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

/** 唱片類／周邊類（2026-09-28 周邊選擇流程）：炫收藏表單先選品項，再依這兩類列「屬於哪裡」 */
export const RECORD_KINDS: readonly Kind[] = ["CD", "黑膠", "卡帶", "藍光／DVD"];
export const isRecordKind = (k: string) => (RECORD_KINDS as readonly string[]).includes(k);

/**
 * 系列類型：album｜ep｜single｜tour｜brand｜misc。
 * misc＝每位藝人自動有一個「周邊與其他」，放不屬於專輯、也不屬於演唱會的周邊；第一次有人用到才建，藝人頁排最後。
 */
export const SERIES_KINDS = ["album", "ep", "single", "tour", "brand", "misc"] as const;
export type SeriesKind = (typeof SERIES_KINDS)[number];
export const SERIES_KIND_LABEL: Record<SeriesKind, string> = {
  album: "專輯",
  ep: "EP",
  single: "單曲",
  tour: "巡迴",
  brand: "自有品牌",
  misc: "周邊",
};
/** 新增系列時組全名用的類型字（沿用既有「年份《名稱》類型」的寫法） */
export const SERIES_KIND_TYPE: Record<Exclude<SeriesKind, "misc">, string> = {
  album: "專輯發行",
  ep: "EP 發行",
  single: "單曲發行",
  tour: "演唱會巡迴",
  brand: "自有品牌",
};
export const asSeriesKind = (v: unknown): SeriesKind =>
  (SERIES_KINDS as readonly string[]).includes(String(v)) ? (v as SeriesKind) : "album";
export const MISC_SERIES_TITLE = "周邊與其他";
/** 表單送出時指「這位藝人的周邊與其他」（還沒建立也可以送，伺服器第一次用到才建） */
export const miscSeriesRef = (artistSlug: string) => `misc:${artistSlug}`;

/** og:description 沒有故事時的物件類型預設字 */
export const KIND_LABEL_FALLBACK = "收藏";

/** 站方描述：首頁、被鎖定內容的連結預覽共用 */
/** 站名只在這裡設定一處：標題、頁首、浮水印、連結預覽圖、寄信都讀這個，改名時全站一起變（照片浮水印已燒進檔案，要另外跑重燒腳本） */
export const SITE_NAME = "樂迷藏";
/**
 * 會員上傳照片（收藏照片、藝人照片投稿）的授權（2026-09-30 使用者核准）：可分享、須標示原拍攝者與樂迷藏出處、
 * 不得商業使用、不得修改。舊的藝人照片投稿已用 CC BY-SA 4.0 授權，授權存在每張照片那一列，不改
 */
export const PHOTO_LICENSE = "CC BY-NC-ND 4.0";
export const PHOTO_LICENSE_URL = "https://creativecommons.org/licenses/by-nc-nd/4.0/deed.zh-hant";
export const SITE_TAGLINE = "樂迷的收藏分享";
export const SITE_TITLE = `${SITE_NAME}｜${SITE_TAGLINE}`;
/**
 * 照片浮水印（上傳時燒進主圖、縮圖、預覽圖，2026-09-29）。改站名後要跑 scripts/reburn-watermark.py 重燒
 * - corner：右下角「© @帳號 · 站名 #查證碼」
 * - center：中間斜字「站名 #查證碼」
 */
export type WatermarkMark = { corner: string; center: string };
export const watermarkMark = (handle: string, code: string): WatermarkMark => ({
  corner: `© @${handle} · ${SITE_NAME} #${code}`,
  center: `${SITE_NAME} #${code}`,
});

/** 查證碼：5 碼大寫英數，不用容易看錯的 0 O 1 I L（31 個字元） */
export const VERIFY_CODE_CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const VERIFY_CODE_LEN = 5;
export const VERIFY_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
/** 使用者輸入的碼：去掉 #、空白，轉大寫；格式不對回空字串 */
export const normVerifyCode = (v: unknown) => {
  const c = String(v ?? "").replace(/[#\s]/g, "").toUpperCase();
  return VERIFY_CODE_RE.test(c) ? c : "";
};
export const verifyHref = (code: string) => `/verify?c=${code}`;

export const SITE_DESC = "看樂迷收了什麼、炫自己的收藏，沿著藝人、系列、版本與標籤找下去。";

/** 分享用的四段字（Catalog.shareParts 算出來） */
export type ShareParts = { artist: string; series: string; item: string; version: string };

/**
 * 版本名稱已經包含品項名（「2016 CD」含「CD」）就不再加品項，避免「… CD 2016 CD」。
 * 英數品項要整個字對到（「CD」不算在「SACD」裡），中文品項（黑膠、寫真書）直接找子字串。
 */
export function itemInVersion(item: string, version: string) {
  const i = item.trim().toLowerCase();
  const v = version.trim().toLowerCase();
  if (!i || !v) return false;
  if (/^[a-z0-9]/.test(i)) {
    const esc = i.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(v);
  }
  return v.includes(i);
}

/**
 * 標題與分享文字共用的分段：系列・「版本 品項」（2026-09-29 用字與版本欄）。
 * 版本名稱已含品項就只放版本（「2016 CD」）；只描述地區、批次的版本接上品項（「日版」→「日版 CD」）；沒選版本就只放品項。
 */
export const titleSegments = (series: string, item: string, version: string) => {
  const v = version.trim();
  const i = item.trim();
  return [series.trim(), !v ? i : itemInVersion(i, v) || !i ? v : `${v} ${i}`].filter(Boolean);
};

/**
 * 炫收藏的標題（存進 shares.what）：
 * - 連到系列：「系列・版本 品項」，例「Dr. Paper Vol.3 Sunday Night Slow Jams・2016 CD」「My jinji・日版 CD」
 * - 沒連系列：「跟誰有關・類型」，例「國蛋、Dr. Paper・T 恤」
 */
export const composeWhat = (p: { series?: string; item?: string; version?: string; about?: string[]; kind?: string }) =>
  p.series
    ? titleSegments(p.series, p.item ?? "", p.version ?? "").join("・")
    : [(p.about ?? []).join("、"), p.kind ?? ""].filter(Boolean).join("・");

/** 藝人・系列・品項・版本（品項已在版本名稱裡就省略）；四段都空時退回「某某的收藏」 */
export const shareDesc = (p: ShareParts, author: string) =>
  [p.artist, ...titleSegments(p.series, p.item, p.version)].filter(Boolean).join("・") || `${author} 的${KIND_LABEL_FALLBACK}`;

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
  /** 藝人頁顯示：auto＝有系列或收藏、或有獎項＋維基簡介才顯示；on／off＝管理員強制 */
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
  /** 發行日期（YYYY、YYYY-MM 或 YYYY-MM-DD；空字串＝未填） */
  releaseDate: string;
  /** MusicBrainz release MBID（匯入建立或合併過才有） */
  mbid?: string;
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
  /** 系列類型（album｜ep｜single｜tour｜brand｜misc），頁面標示用 */
  kind: SeriesKind;
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
  /** MusicBrainz release-group MBID */
  mbid?: string;
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
  /** 發文者自訂了標題時，系統自動組的那個（編輯頁「還原成自動標題」用） */
  autoWhat?: string;
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
  /** 主圖像素尺寸（og:image:width／height 用）；舊資料沒記就沒有 */
  imageSize?: { w: number; h: number };
  /** 縮圖網址；D1 讀出來的才有 */
  thumb?: string;
  /** 分享預覽圖網址（1200×630 JPEG，浮水印已燒進去；og:image 用）；沒有就退回縮圖，舊收藏都沒有這欄 */
  og?: string;
  /** 兩張以上才有：全部照片依順序（第一張＝封面，跟 image／thumb 同一張） */
  photos?: SharePhoto[];
  /** 封面的查證碼（2026-09-29）；舊資料補發前沒有 */
  code?: string;
  /** 作者顯示名稱；D1 讀出來的才有 */
  authorName?: string;
  /** 發文者的等級小標籤（「收藏家 Lv.3」／「館長」），目錄建立時算好 */
  authorBadge?: string;
  /** 發文者的大頭貼網址（2026-09-30）；沒有就不帶，前端顯示暱稱首字 */
  authorAvatar?: string;
  link?: { series: string; item?: string; version?: string };
  sale?: Sale;
  /** 管理員標為「辨識參考」的照片（2026-09-28 起改由管理員標記；shares.ref_photo 舊值不再使用） */
  refPhotos?: SharePhoto[];
  /** 照片依順序：哪幾張被管理員標為辨識參考（index，單則頁管理員操作用） */
  refIdx?: number[];
  /** 發文者最後一次編輯內容或照片的時間（ISO）；沒編輯過就沒有 */
  editedAt?: string;
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

/** 一張照片：主圖（1600px，要登入）＋縮圖（公開） */
export type SharePhoto = { image: string; thumb: string; code?: string };

export type ShareView = {
  n: number;
  what: string;
  /** 統一後的物件類型 */
  kind: Kind;
  /** 其他周邊的補充，或 CD-R 這類細分 */
  kindNote?: string;
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
  /** 兩張以上才有：全部照片依順序，第一張是封面 */
  photos?: SharePhoto[];
  /** 封面的查證碼（單則頁照片下方顯示；只有單則頁帶） */
  code?: string;
  author: { handle: string; name: string; initials: string; badge?: string; avatar?: string };
  link?: { href: string; label: string; seriesKey: string; itemId?: string; versionId?: string };
  sale: Sale;
  /** 跟哪些藝人有關（跟誰有關＋標籤撞名），首頁「追蹤中」用 */
  aboutSlugs: string[];
  /** 連到的版本有已知仿冒 */
  hasFakes: boolean;
  /** 伺服器算好的鎖定（跟 API 擋交易同一個判斷） */
  lock: Lock | null;
  /** 對應到公開藝人頁的標籤 → 藝人頁網址（其餘標籤連 /tag/） */
  tagLinks?: Record<string, string>;
  /** 單則頁才有：哪幾張照片被管理員標為辨識參考（照片順序的 index） */
  refIdx?: number[];
  /** 單則頁才有：發文者最後編輯時間（ISO） */
  editedAt?: string;
};

/** 我有／想要清單列（個人頁用） */
export type HoldingView = {
  key: string;
  title: string;
  artists: string;
  edition: string;
  year: string;
  format: string;
  /** 不再公開（目錄號屬辨識細節，登入才看得到，2026-09-28）；留欄位給 App 相容，一律空字串 */
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
 * - 被鎖的發文者向樂迷藏申訴，管理者看過才解鎖，不自動解鎖
 */

export type ReportReason = "fake" | "scam" | "never" | "improper" | "other";

/** 對象鍵：`share:8`、`item:tide-highway/3#towel`、`version:faint-signal/1#cd-v1` */
export type TargetKey = `share:${number}` | `item:${string}` | `version:${string}` | `avatar:${string}`;
/** avatar＝大頭貼（2026-09-28）：走同一張檢舉表，但不鎖交易，管理員看過決定移除或保留 */
export type TargetLevel = "share" | "item" | "version" | "avatar";
export const shareTarget = (n: number): TargetKey => `share:${n}`;
export const itemTarget = (key: string): TargetKey => `item:${key}`;
export const versionTarget = (key: string): TargetKey => `version:${key}`;
export const targetLevel = (t: TargetKey): TargetLevel => t.slice(0, t.indexOf(":")) as TargetLevel;

/** 各層可選的理由 */
export const avatarTarget = (photoId: string): TargetKey => `avatar:${photoId}`;

export const reasonsFor = (level: TargetLevel): { key: ReportReason; label: string }[] =>
  level === "avatar"
    ? [
        { key: "improper", label: "不當圖片或冒用他人" },
        { key: "other", label: "其他" },
      ]
    : level === "share"
    ? [
        // 2026-09-28 回報入口：單則頁的「檢舉」只剩這三種；資料有誤、不是這位藝人、重複、其他改走錯誤回報（不計門檻）。
        // 舊資料裡 share 的 other 仍算檢舉，後台照舊顯示
        { key: "fake", label: "疑似盜版或仿冒品" },
        { key: "scam", label: "疑似詐騙" },
        { key: "improper", label: "照片或文字不妥" },
      ]
    : [
        { key: "never", label: level === "item" ? "官方沒出過這個品項" : "官方沒出過這個版本" },
        { key: "other", label: "其他" },
      ];

export const reasonLabel = (level: TargetLevel, r: ReportReason) =>
  reasonsFor(level).find((x) => x.key === r)?.label ?? "其他";

/**
 * 單則頁「對這則收藏有疑問嗎？」的七個原因（2026-09-28）。
 * kind＝report 走檢舉（計門檻、只收已驗證 Email、一人一次）；kind＝error 走錯誤回報（只進後台佇列，不計門檻、不算分）。
 */
export type ErrorReason = "wrong_info" | "not_artist" | "duplicate" | "other";
export const QUESTION_REASONS: (
  | { key: "fake" | "scam" | "improper"; kind: "report"; label: string }
  | { key: ErrorReason; kind: "error"; label: string }
)[] = [
  { key: "fake", kind: "report", label: "疑似盜版或仿冒品" },
  { key: "wrong_info", kind: "error", label: "資料有誤（版本、年份、藝人寫錯）" },
  { key: "not_artist", kind: "error", label: "其實不是這位藝人的東西" },
  { key: "duplicate", kind: "error", label: "重複發文" },
  { key: "scam", kind: "report", label: "疑似詐騙（例如要求私下匯款、站外交易）" },
  { key: "improper", kind: "report", label: "照片或文字不妥" },
  { key: "other", kind: "error", label: "其他" },
];
export const ERROR_REASON_LABEL: Record<ErrorReason, string> = {
  wrong_info: "資料有誤",
  not_artist: "不是這位藝人",
  duplicate: "重複發文",
  other: "其他",
};

/** 達門檻後的醒目標示 */
export const lockLabel = (level: TargetLevel) =>
  level === "avatar" ? "大頭貼被檢舉" : level === "share" ? "多人檢舉：疑似盜版" : level === "item" ? "爭議品項：官方未證實發行" : "爭議版本：官方未證實發行";

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
  if (t.startsWith("avatar:")) return false;
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
