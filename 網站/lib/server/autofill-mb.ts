// 自動補資料用的 MusicBrainz／Wikidata 連線與資料轉換（lib/server/autofill.ts 用）。
// 規則跟 scripts/musicbrainz-fetch.mjs、import-musicbrainz-db.mjs 同一套，只是改成在 Worker 裡跑：
//   - User-Agent 固定 `Lemibox/0.1 ( https://lemibox.com )`，不放任何人的 Email
//   - MusicBrainz 每秒最多 1 次（每次間隔 ≥1.1 秒；上次呼叫時間存 D1，換一個 Worker 執行也接得上）
//   - 503／429 不在這裡等，整批停下，工作排到 2 分鐘後再試
//   - 只取事實欄位（類型、地區、別名、代碼、日期、曲目、廠牌、條碼），不抓任何簡介文字
// 不呼叫任何 AI，不需要金鑰，零費用。

const UA = "Lemibox/0.1 ( https://lemibox.com )";
const MB = "https://musicbrainz.org/ws/2/";

/** 一次執行的額度：對外連線數上限（免費方案每次呼叫 50）、截止時間（waitUntil 最多 30 秒） */
export type Budget = { calls: number; maxCalls: number; deadline: number; mbLast: number };
export class Busy extends Error {}
export class OutOfBudget extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spend(b: Budget, wait = 0) {
  if (b.calls >= b.maxCalls || Date.now() + wait + 1500 > b.deadline) throw new OutOfBudget("這次執行的額度用完");
  b.calls++;
}

/** GET MusicBrainz JSON；404 回 null */
export async function mb<T = Record<string, unknown>>(b: Budget, path: string): Promise<T | null> {
  const wait = Math.max(0, b.mbLast + 1100 - Date.now());
  spend(b, wait);
  if (wait) await sleep(wait);
  b.mbLast = Date.now();
  const url = `${MB}${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  let res: Response | null = null;
  // 503／429 先在這次執行裡等 3 秒重試一次（MusicBrainz 偶發忙線），還是忙才整批停下
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      spend(b, 3000);
      await sleep(3000);
      b.mbLast = Date.now();
    }
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    } catch (e) {
      throw new Busy(`MusicBrainz 連線失敗：${(e as Error).message}`);
    }
    if (res.status !== 503 && res.status !== 429) break;
  }
  if (!res) throw new Busy("MusicBrainz 沒有回應");
  if (res.status === 404) return null;
  if (res.status === 503 || res.status === 429 || res.status >= 500) throw new Busy(`MusicBrainz ${res.status}`);
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}：${path}`);
  return (await res.json()) as T;
}

/** Wikidata（API 或 SPARQL），失敗回 null 不中斷（Wikidata 只是輔助） */
export async function wd<T = Record<string, unknown>>(b: Budget, url: string): Promise<T | null> {
  spend(b);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/sparql-results+json, application/json" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* ---------- 比對用正規化（跟 scripts/musicbrainz-fetch.mjs 同一張簡轉繁表） ---------- */

const S = "与业东两个么乐乡于们会体兰关内写军净划别办动区发变台号吃后员哑哗唇团国坠娱宝对尔岁岩岳师帮干床开张弥当彦戏托护拨摇敛断时术来桦梦楼毕气没满点烟烦热爱独电种秘约经绑给绝绿脏艺补袭见觉计让记诗话说谁贪赌过这进远里钢钱键长门问间陈难雾静韩题飞马验";
const T = "與業東兩個麼樂鄉於們會體蘭關內寫軍淨劃別辦動區發變臺號喫後員啞譁脣團國墜娛寶對爾歲巖嶽師幫幹牀開張彌當彥戲託護撥搖斂斷時術來樺夢樓畢氣沒滿點煙煩熱愛獨電種祕約經綁給絕綠髒藝補襲見覺計讓記詩話說誰貪賭過這進遠裏鋼錢鍵長門問間陳難霧靜韓題飛馬驗";
const S2T = new Map([...S].map((c, i) => [c, [...T][i]]));
const toT = (s: string) => [...s].map((c) => S2T.get(c) ?? (c === "台" ? "臺" : c)).join("");
export const mnorm = (s: unknown) =>
  toT(String(s ?? ""))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

/** 條碼只留數字（8～14 碼才算） */
export const cleanBarcode = (s: unknown) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 8 && d.length <= 14 ? d : "";
};

/** Lucene 查詢字串裡的雙引號與反斜線拿掉 */
export const lq = (s: string) => s.replace(/["\\]/g, " ").trim();

/* ---------- 對照表（跟 import-musicbrainz-db.mjs 相同） ---------- */

export const COUNTRY: Record<string, string> = {
  TW: "台灣", HK: "香港", CN: "中國", JP: "日本", US: "美國", KR: "韓國", MY: "馬來西亞", SG: "新加坡",
  XW: "全球", XE: "歐洲", GB: "英國", DE: "德國", FR: "法國", CA: "加拿大", AU: "澳洲", TH: "泰國",
};
/** 會員填的地區（自由文字）→ 國家代碼，只拿來篩候選 */
export function regionCode(s: string) {
  const t = s.trim();
  if (!t) return "";
  if (/台|臺/.test(t)) return "TW";
  if (/日/.test(t)) return "JP";
  if (/韓/.test(t)) return "KR";
  if (/港/.test(t)) return "HK";
  if (/中國|大陸|內地/.test(t)) return "CN";
  if (/美/.test(t)) return "US";
  if (/英/.test(t)) return "GB";
  if (/歐/.test(t)) return "XE";
  if (/馬來/.test(t)) return "MY";
  if (/新加坡|星/.test(t)) return "SG";
  return "";
}
const PACKAGING: Record<string, string> = {
  "Jewel Case": "塑膠盒", "Slim Jewel Case": "薄塑膠盒", Digipak: "紙盒（Digipak）", "Cardboard/Paper Sleeve": "紙套",
  "Keep Case": "DVD 盒", Box: "盒裝", "Gatefold Cover": "對開封套", Book: "書本裝", Digibook: "書本裝（Digibook）",
  Fatbox: "厚塑膠盒", "Super Jewel Box": "Super Jewel Box", "Snap Case": "扣盒", "Plastic Sleeve": "塑膠套",
  Slidepack: "抽拉式紙盒", "Discbox Slider": "抽拉式紙盒", Longbox: "長盒", "Cassette Case": "卡帶盒",
};
export const SERIES_KIND: Record<string, "album" | "ep" | "single"> = { Album: "album", EP: "ep", Single: "single" };

export type ItemDef = { id: string; kind: "CD" | "黑膠" | "卡帶" | "藍光／DVD" | "其他周邊"; sort: number };
const ITEM: Record<string, ItemDef> = {
  cd: { id: "cd", kind: "CD", sort: 0 },
  vinyl: { id: "vinyl", kind: "黑膠", sort: 1 },
  cassette: { id: "cassette", kind: "卡帶", sort: 2 },
  bluray: { id: "bluray", kind: "藍光／DVD", sort: 3 },
  other: { id: "goods", kind: "其他周邊", sort: 9 },
};
export const isDigital = (f?: string | null) => !f || /digital|download|stream/i.test(f);
export function itemOf(f?: string | null): ItemDef | null {
  if (!f || isDigital(f)) return null;
  if (/vinyl|\bLP\b|flexi|shellac/i.test(f)) return ITEM.vinyl;
  if (/cassette/i.test(f)) return ITEM.cassette;
  if (/dvd|blu-?ray|hd-dvd|vhs|laserdisc|vcd|video cd/i.test(f)) return ITEM.bluray;
  if (/cd|sacd/i.test(f)) return ITEM.cd;
  return ITEM.other;
}
function fmtLabel(f: string) {
  if (/^(\d+)" Vinyl$/i.test(f)) return `${f.match(/^(\d+)/)![1]} 吋黑膠`;
  if (/vinyl/i.test(f)) return "黑膠";
  if (/cassette/i.test(f)) return "卡帶";
  if (/blu-?ray/i.test(f)) return "藍光";
  if (/dvd/i.test(f)) return "DVD";
  if (/sacd/i.test(f)) return "SACD";
  if (/cd-r/i.test(f)) return "CD-R";
  if (/cd/i.test(f)) return "CD";
  if (/usb/i.test(f)) return "USB 隨身碟";
  return f;
}
type Media = { format?: string | null; position?: number; title?: string; tracks?: { number?: string; position?: number; title: string; length?: number | null; recording?: { length?: number | null } }[]; "track-count"?: number };
function mediaLabel(media: Media[]) {
  const counts = new Map<string, number>();
  for (const m of media) counts.set(fmtLabel(m.format ?? ""), (counts.get(fmtLabel(m.format ?? "")) ?? 0) + 1);
  return [...counts].map(([f, n]) => (n > 1 ? `${n}${/^[A-Z]/.test(f) ? "" : " 張"}${f}` : f)).join("＋");
}
const fmtLength = (ms?: number | null) => {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** 曲目行清單（格式見 lib/tracks.ts） */
export function trackLines(media: Media[]) {
  const multi = media.length > 1;
  const out: string[] = [];
  media.forEach((m, i) => {
    if (multi) out.push(`【第 ${m.position ?? i + 1} 碟 ${fmtLabel(m.format ?? "")}${m.title ? ` ${m.title}` : ""}】`);
    for (const t of m.tracks ?? []) {
      const len = fmtLength(t.length ?? t.recording?.length);
      out.push(`${t.number || t.position}. ${t.title}${len ? ` (${len})` : ""}`);
    }
  });
  return out;
}
const trackTotal = (media: Media[]) => media.reduce((n, m) => n + (m.tracks?.length ?? m["track-count"] ?? 0), 0);

export type MbRelease = {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  barcode?: string | null;
  packaging?: string | null;
  disambiguation?: string;
  media?: Media[];
  "label-info"?: { "catalog-number"?: string | null; label?: { name?: string } | null }[];
  "release-group"?: { id: string; title: string; "primary-type"?: string | null; "first-release-date"?: string };
  "artist-credit"?: { name?: string; artist?: { id: string; name: string } }[];
};

/** 一個實體 release 轉成版本欄位（沒有實體媒體回 null） */
export function releaseFields(r: MbRelease) {
  const phys = (r.media ?? []).filter((m) => !isDigital(m.format));
  if (!phys.length) return null;
  const item = itemOf(phys[0].format);
  if (!item) return null;
  const d = r.date || "";
  const labels = [...new Set((r["label-info"] ?? []).map((l) => l.label?.name).filter((n): n is string => Boolean(n) && n !== "[no label]"))];
  const cats = [...new Set((r["label-info"] ?? []).map((l) => l["catalog-number"]).filter((c): c is string => Boolean(c) && c !== "[none]"))];
  const lines = trackLines(phys);
  const n = trackTotal(phys);
  const media = mediaLabel(phys);
  return {
    item,
    media,
    multi: phys.length > 1,
    fields: {
      year: /^\d{4}/.test(d) ? d.slice(0, 4) : "",
      release_date: d,
      region: r.country ? (COUNTRY[r.country] ?? r.country) : "",
      label: labels.join("、"),
      catalog: cats.join("、"),
      barcode: cleanBarcode(r.barcode),
      packaging: [PACKAGING[r.packaging ?? ""] ?? (r.packaging && r.packaging !== "None" ? r.packaging : ""), phys.length > 1 ? media : ""].filter(Boolean).join("，"),
      contents: phys.length > 1 ? media : "",
      tracks: n ? `${n} 首` : "",
      track_list: lines.length ? JSON.stringify(lines) : "",
    },
  };
}
export type VersionFill = NonNullable<ReturnType<typeof releaseFields>>["fields"];

/** 版本欄位「空白」的判斷（跟匯入腳本一致） */
export const BLANK: Record<keyof VersionFill, (v: string) => boolean> = {
  year: (v) => !/^\d{4}/.test(v),
  release_date: (v) => v === "",
  region: (v) => v === "",
  label: (v) => v === "",
  catalog: (v) => v === "" || v === "待查證",
  barcode: (v) => v === "" || v === "無條碼",
  packaging: (v) => v === "",
  contents: (v) => v === "" || v === "—",
  tracks: (v) => v === "" || v === "—",
  track_list: (v) => v === "" || v === "[]",
};

export const mbUrl = (entity: "artist" | "release-group" | "release", id: string) => `https://musicbrainz.org/${entity}/${id}`;
export const wdUrl = (qid: string) => `https://www.wikidata.org/wiki/${qid}`;
