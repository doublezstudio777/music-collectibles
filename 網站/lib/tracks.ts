// 曲目（2026-09-28）：版本上的曲目清單。前後端、匯入腳本共用同一套行格式。
//
// 存法：string[]，一行一首「序. 歌名 (m:ss)」，時長可省略；多碟用「【第 2 碟 CD】」這種整行標題分段。
// 維基式編輯也是編這份行清單（一行一首），歷史頁逐行比對差異。

export type Track = { no: string; title: string; length: string };
export type Disc = { title: string; tracks: Track[] };

const HEAD = /^【(.+)】$/;
const LINE = /^([A-Za-z]?\d{1,3}[a-z]?)\s*[.．、]\s*(.+?)(?:\s*[(（](\d{1,3}:\d{2})[)）])?$/;

/** 行清單 → 各碟 */
export function parseTracks(lines: string[]): Disc[] {
  const discs: Disc[] = [];
  let cur: Disc | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(HEAD);
    if (h) {
      cur = { title: h[1].trim(), tracks: [] };
      discs.push(cur);
      continue;
    }
    if (!cur) {
      cur = { title: "", tracks: [] };
      discs.push(cur);
    }
    const m = line.match(LINE);
    if (m) cur.tracks.push({ no: m[1], title: m[2].trim(), length: m[3] ?? "" });
    else {
      const t = line.match(/^(.+?)(?:\s*[(（](\d{1,3}:\d{2})[)）])?$/);
      cur.tracks.push({ no: String(cur.tracks.length + 1), title: (t?.[1] ?? line).trim(), length: t?.[2] ?? "" });
    }
  }
  return discs.filter((d) => d.tracks.length);
}

export const trackCount = (lines: string[]) => parseTracks(lines).reduce((n, d) => n + d.tracks.length, 0);

/** 毫秒 → m:ss */
export const fmtLength = (ms: number | null | undefined) => {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// 簡繁視為相同（比對用，不改顯示）：MusicBrainz 同一張專輯有的版本登簡體歌名。表跟 scripts/musicbrainz-fetch.mjs 同一份
const S = "与业东两个么乐乡于们会体兰关内写军净划别办动区发变台号吃后员哑哗唇团国坠娱宝对尔岁岩岳师帮干床开张弥当彦戏托护拨摇敛断时术来桦梦楼毕气没满点烟烦热爱独电种秘约经绑给绝绿脏艺补袭见觉计让记诗话说谁贪赌过这进远里钢钱键长门问间陈难雾静韩题飞马验";
const T = "與業東兩個麼樂鄉於們會體蘭關內寫軍淨劃別辦動區發變臺號喫後員啞譁脣團國墜娛寶對爾歲巖嶽師幫幹牀開張彌當彥戲託護撥搖斂斷時術來樺夢樓畢氣沒滿點煙煩熱愛獨電種祕約經綁給絕綠髒藝補襲見覺計讓記詩話說誰貪賭過這進遠裏鋼錢鍵長門問間陳難霧靜韓題飛馬驗";
const S2T = new Map([...S].map((c, i) => [c, [...T][i]]));

/** 比對用：簡轉繁、去空白、標點、全形半形與大小寫 */
const key = (t: string) =>
  [...t]
    .map((c) => S2T.get(c) ?? (c === "台" ? "臺" : c))
    .join("")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

export type TrackDiff = { same: boolean; added: { pos: number; title: string }[]; missing: string[] };

const secs = (len: string) => {
  const m = len.match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * 版本 v 跟基準版本比：多了哪幾首（v 裡的第幾首）、少了哪幾首。
 * 先比歌名（去標點、大小寫）；歌名對不上的再用時長配對（差 2 秒內，照順序），
 * 因為 MusicBrainz 同一張專輯的不同版本常一版登中文歌名、一版登英文歌名
 */
export function diffTracks(base: string[], v: string[]): TrackDiff {
  const b = parseTracks(base).flatMap((d) => d.tracks);
  const t = parseTracks(v).flatMap((d) => d.tracks);
  const bUsed = new Array<boolean>(b.length).fill(false);
  const tUsed = new Array<boolean>(t.length).fill(false);
  t.forEach((x, i) => {
    const j = b.findIndex((y, k) => !bUsed[k] && key(y.title) === key(x.title));
    if (j >= 0) {
      bUsed[j] = true;
      tUsed[i] = true;
    }
  });
  t.forEach((x, i) => {
    if (tUsed[i]) return;
    const sx = secs(x.length);
    if (sx === null) return;
    const j = b.findIndex((y, k) => {
      const sy = secs(y.length);
      return !bUsed[k] && sy !== null && Math.abs(sy - sx) <= 2;
    });
    if (j >= 0) {
      bUsed[j] = true;
      tUsed[i] = true;
    }
  });
  const added = t.flatMap((x, i) => (tUsed[i] ? [] : [{ pos: i + 1, title: x.title }]));
  const missing = b.flatMap((x, k) => (bUsed[k] ? [] : [x.title]));
  return { same: !added.length && !missing.length, added, missing };
}

/** 比較表「曲目差異」那一格的文字；超過 3 首只列前 3 首歌名，連號的位置合併成「第 11～20 首」 */
export function diffText(d: TrackDiff) {
  if (d.same) return "相同";
  const names = (xs: string[]) => xs.slice(0, 3).map((x) => `〈${x}〉`).join("") + (xs.length > 3 ? `等 ${xs.length} 首` : "");
  const parts: string[] = [];
  if (d.added.length === 1) parts.push(`多了第 ${d.added[0].pos} 首〈${d.added[0].title}〉`);
  else if (d.added.length > 1) {
    const pos = d.added.map((a) => a.pos);
    const run = pos.every((p, i) => i === 0 || p === pos[i - 1] + 1);
    parts.push(`多了${run ? `第 ${pos[0]}～${pos[pos.length - 1]} 首` : ""}${names(d.added.map((a) => a.title))}`);
  }
  if (d.missing.length) parts.push(`少了${names(d.missing)}`);
  return parts.join("；");
}

/** 一般版的判斷字 */
export const REGULAR_EDITION = /一般版|標準版|普通版|通常盤|regular|standard/i;
