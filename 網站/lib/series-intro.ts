// 系列頁的自動介紹句、版本一覽、站上行情（2026-10-01 系列頁全部收錄）。
//
// 全部用站上現有資料組出來，不呼叫 AI、不抄維基。純函式，伺服器頁面、後台 SEO 預覽、meta description 共用。
// 句型依資料有無分支（專輯／EP／單曲、有沒有發行年、一個或多個版本、有沒有人收藏），
// 同一種情況再用系列鍵算雜湊挑寫法，避免每頁都是同一句罐頭句；同一頁每次渲染結果固定。
// 不寫破折號，不寫價格（價格只在頁面上的「站上行情」，那塊加 data-nosnippet，搜尋結果不顯示）。

import type { SeriesKind } from "@/lib/data";

export type VersionFact = {
  anchor: string;
  edition: string;
  /** 品項類型：CD、黑膠、卡帶… */
  kind: string;
  year: string;
  region: string;
  label: string;
  /** 格式：內容物拆出來的媒體（CD＋DVD），沒寫就是品項類型 */
  format: string;
  /** 片數；查不到是 0 */
  discs: number;
  packaging: string;
};

export type SeriesFacts = {
  key: string;
  who: string;
  title: string;
  kind: SeriesKind;
  /** YYYY；沒有就空字串 */
  year: string;
  /** 發行月份（有完整發行日期、而且跟系列年份同一年時才有） */
  month: number;
  tracks: number;
  /** 代表曲目的碟數 */
  trackDiscs: number;
  versions: VersionFact[];
  owners: number;
  wanted: number;
  shares: number;
  onSale: number;
};

export type MarketFacts = {
  /** 出售中（定價出售＋開放出價，被鎖的不算） */
  onSale: number;
  /** 定價出售的開價區間 */
  asks: [number, number] | null;
  /** 最近一筆成交 */
  lastSold: { price: number; date: string } | null;
};

/** 欄位沒值的寫法（匯入或會員填的佔位字） */
export const hasValue = (x: string | undefined | null): x is string => Boolean(x && x !== "—" && x !== "待查證" && x !== "無條碼" && x !== "Other");

const MEDIA = /(\d+)?\s*(?:張|片)?\s*(SACD|CD|DVD|LP|黑膠|卡帶|藍光|Blu-?ray|BD|VCD)/gi;

/** 內容物「2CD＋DVD」→ 格式「CD＋DVD」、片數 3；拆不出來回 null */
export function parseContents(contents: string): { format: string; discs: number } | null {
  if (!hasValue(contents)) return null;
  const media: string[] = [];
  let discs = 0;
  for (const m of contents.matchAll(MEDIA)) {
    const name = m[2].toUpperCase() === "BLU-RAY" || m[2].toUpperCase() === "BLURAY" || m[2].toUpperCase() === "BD" ? "藍光" : m[2].toUpperCase() === "LP" ? "黑膠" : m[2].toUpperCase();
    if (!media.includes(name)) media.push(name);
    discs += m[1] ? Number(m[1]) : 1;
  }
  return media.length ? { format: media.join("＋"), discs } : null;
}

/** FNV-1a，挑句型用（同一頁每次都一樣） */
function hash(s: string) {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
const choose = <T,>(key: string, slot: string, list: T[]) => list[hash(`${key}|${slot}`) % list.length];

/** 依出現次數排，多的在前 */
function ranked(xs: string[]) {
  const m = new Map<string, number>();
  xs.filter(hasValue).forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([x]) => x);
}

/** 「台灣、香港和日本」 */
function joinAnd(xs: string[]) {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join("、")}和${xs[xs.length - 1]}`;
}

const NUM_ZH = ["零", "一", "兩", "三", "四", "五", "六", "七", "八", "九", "十"];
const zh = (n: number) => (n <= 10 ? NUM_ZH[n] : String(n));

/** 版本名去掉開頭年份：「2017 台灣首版 CD」→「台灣首版 CD」 */
const shortEdition = (v: VersionFact) => v.edition.replace(/^\d{4}\s*/, "").trim() || [v.region, v.kind].filter(hasValue).join("");

/**
 * 句子組字：樣板裡的字一律不留空白（全站規則：中文與數字、英文之間不空格），
 * 只有兩邊都是英數時才補一個空白（「Hyukoh 2017年」）。資料本身（藝人名「路壹 Lu1」、版本名、唱片公司）原樣保留
 */
const ALNUM_END = /[A-Za-z0-9.)’'!?]$/;
const ALNUM_START = /^[A-Za-z0-9(]/;
const glue = (a: string, b: string) => (a && b && ALNUM_END.test(a) && ALNUM_START.test(b) ? `${a} ${b}` : a + b);
function z(strs: TemplateStringsArray, ...vals: (string | number)[]) {
  let out = strs[0];
  vals.forEach((v, i) => {
    out = glue(glue(out, String(v)), strs[i + 1]);
  });
  return out;
}

const KIND_WORD: Record<SeriesKind, string> = { album: "專輯", ep: "EP", single: "單曲", tour: "巡迴演唱會", brand: "自有品牌", misc: "周邊" };

/** 第一句：這是誰、哪一年的什麼、幾首歌 */
function identity(f: SeriesFacts) {
  const { key, who, title: t, year: y, month: m, tracks: n } = f;
  const kw = KIND_WORD[f.kind];
  if (f.kind === "misc") return choose(key, "misc", [z`這裡整理${who}不屬於專輯、也不屬於演唱會的周邊`, z`${who}專輯和演唱會以外的周邊，都收在這一頁`]);
  if (f.kind === "tour" || f.kind === "brand") {
    return y ? choose(key, "tour", [z`《${t}》是${who}${y}年的${kw}`, z`${who}在${y}年推出${kw}《${t}》`]) : z`《${t}》是${who}的${kw}`;
  }
  const ep = f.kind === "ep";
  // EP 不加「發行的」比較順：「2019年的EP」
  const head = y
    ? choose(key, "id", [
        ep ? z`《${t}》是${who}${y}年的EP` : z`《${t}》是${who}${y}年發行的${kw}`,
        z`${who}在${y}年推出${kw}《${t}》`,
        z`《${t}》是${who}的${kw}，${y}年發行`,
        ...(m ? [z`${who}的${kw}《${t}》在${y}年${m}月發行`, z`《${t}》是${who}在${y}年${m}月推出的${kw}`] : []),
      ])
    : choose(key, "id-noyear", [z`《${t}》是${who}的${kw}，發行年份還沒有人補上`, z`${who}的${kw}《${t}》，目前查不到發行年份`, z`《${t}》是${who}的${kw}，還缺發行年份的資料`]);
  if (!n) return head;
  let tracks: string;
  if (f.kind === "single") tracks = n === 1 ? choose(key, "tr1", ["只有一首歌", "就收這一首歌"]) : choose(key, "trs", [z`收錄${n}首歌`, z`裡面有${n}首歌`]);
  else if (f.trackDiscs > 1) tracks = choose(key, "trd", [z`分成${zh(f.trackDiscs)}張碟，共${n}首歌`, z`${zh(f.trackDiscs)}張碟一共${n}首`]);
  else tracks = choose(key, "tr", [z`共${n}首歌`, z`收錄${n}首歌`, z`一共${n}首`, z`全${ep ? "張" : "輯"}${n}首歌`]);
  return `${head}，${tracks}`;
}

/** 第二句：版本 */
function versionLine(f: SeriesFacts, short: boolean) {
  const { key, versions: vs } = f;
  if (f.kind === "misc") return "";
  if (!vs.length) return choose(key, "v0", ["版本資料還沒有人補上", "目前還沒有人登記版本"]);
  if (vs.length === 1) {
    const v = vs[0];
    const what = /^\d{4}$/.test(v.year) ? z`${v.year}年${shortEdition(v)}` : shortEdition(v);
    if (short) return hasValue(v.label) ? z`版本是${what}，${v.label}發行` : z`版本是${what}`;
    const by = hasValue(v.label) ? z`，由${v.label}發行` : "";
    return choose(key, "v1", [z`樂迷藏目前只登記一個版本，是${what}${by}`, z`站上目前只有一個版本，${what}${by}`, z`目前收錄的版本是${what}${by}`]);
  }
  const n = vs.length;
  const regions = ranked(vs.map((v) => v.region)).filter((r) => r !== "全球");
  // 格式只算唱片類（T 恤、隨身碟這類周邊不算「格式」）
  const formats = ranked(vs.map((v) => v.format));
  const labels = ranked(vs.map((v) => v.label));
  const years = vs.map((v) => v.year).filter((y) => /^\d{4}$/.test(y)).map(Number);
  const lo = years.length ? Math.min(...years) : 0;
  const hi = years.length ? Math.max(...years) : 0;
  if (short) {
    const extra = [regions.slice(0, 3).join("、"), formats.length > 1 ? formats.slice(0, 3).join("、") : ""].filter(Boolean).join("；");
    return z`樂迷藏整理${n}個版本${extra ? `（${extra}）` : ""}`;
  }
  const base = choose(key, "vn", [z`樂迷藏收錄${n}個版本`, z`站上整理了${n}個版本`, z`目前登記的版本有${n}個`]);
  const details: string[] = [];
  if (regions.length > 1) {
    const list = regions.length > 4 ? z`${regions.slice(0, 3).join("、")}等${regions.length}個地區` : joinAnd(regions);
    details.push(choose(key, "vr", [z`在${list}都有發行`, z`發行地區包括${list}`]));
  } else if (regions.length === 1) details.push(choose(key, "vr1", [z`都是${regions[0]}發行`, z`全是${regions[0]}版`]));
  if (formats.length > 1) details.push(choose(key, "vf", [z`${joinAnd(formats.slice(0, 4))}都有`, z`格式有${joinAnd(formats.slice(0, 4))}`]));
  if (lo && hi > lo) details.push(choose(key, "vy", [z`從${lo}年一路出到${hi}年`, z`最早${lo}年，最新一版是${hi}年`]));
  if (details.length < 2 && labels.length === 1) details.push(z`唱片公司是${labels[0]}`);
  else if (details.length < 2 && labels.length > 1) details.push(z`經手的唱片公司有${joinAnd(labels.slice(0, 3))}${labels.length > 3 ? "等" : ""}`);
  return [base, ...details.slice(0, 2)].join("，");
}

/** 第三句：收藏、想要、炫收藏（全部 0 就不寫） */
function peopleLine(f: SeriesFacts, short: boolean) {
  const { key, owners, wanted, shares } = f;
  const people = [owners ? z`${owners}人登記擁有` : "", wanted ? z`${wanted}人想要` : ""].filter(Boolean).join("、");
  if (short) return [people, shares ? z`${shares}則樂迷收藏` : "", f.onSale ? z`${f.onSale}件出售中` : ""].filter(Boolean).join("、");
  if (!people && !shares) return "";
  if (!people) return choose(key, "p-s", [z`已經有${shares}則樂迷的炫收藏`, z`站上有${shares}則樂迷分享的實體照片`, z`樂迷分享的炫收藏有${shares}則`]);
  const s = shares ? choose(key, "p-s2", [z`，也有${shares}則炫收藏可以看`, z`，炫收藏${shares}則`]) : "";
  return z`${choose(key, "p", ["目前", "到現在", "樂迷藏裡"])}有${people}${s}`;
}

/** 頁面上的介紹句 */
export function seriesIntro(f: SeriesFacts) {
  const v = versionLine(f, false);
  let p = peopleLine(f, false);
  // 第二、三句開頭撞同一個詞（「站上整理了…。站上有…」「目前…。目前…」）就換一種寫法
  for (let salt = 1; p && v && p.slice(0, 2) === v.slice(0, 2) && salt < 8; salt++) p = peopleLine({ ...f, key: `${f.key}#${salt}` }, false);
  return [identity(f), v, p].filter(Boolean).map((s) => `${s}。`).join("");
}

/** meta description 用的事實句（短版，不含價格），一句一個元素；呼叫端依字數上限從前面挑 */
export function seriesSummaryParts(f: SeriesFacts) {
  return [identity(f), versionLine(f, true), peopleLine(f, true)].filter(Boolean).map((s) => `${s}。`);
}

/** 包裝欄只留包裝：「塑膠盒，2CD」→「塑膠盒」；整欄只寫「2CD」（匯入時填錯欄）→ 空 */
export function packagingOnly(p: string) {
  if (!hasValue(p)) return "";
  const rest = p.replace(MEDIA, "").replace(/[，,＋+\s]/g, "");
  if (!rest) return "";
  return p.replace(/[，,]\s*[^，,]*?(?:SA)?CD[^，,]*$/i, "").trim();
}
