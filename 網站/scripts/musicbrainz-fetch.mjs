// MusicBrainz 抓取與藝人對應（import-musicbrainz.mjs 用；也可單獨跑：node scripts/musicbrainz-fetch.mjs）。
//
// API 規則（https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting）：
//   - User-Agent 固定 `Lemicang/0.1 ( zukawork0312@gmail.com )`
//   - 每秒最多 1 次請求（這支每次請求間隔 ≥1.1 秒）；503 退避重試（2、4、8、16、32 秒）
//   - 回應 JSON 存在 網站/.cache/musicbrainz/（已在 .gitignore），重跑時同一個網址直接讀快取，不重抓
//
// 藝人對應規則（有疑義就不配，列進報告）：
//   1. 用中文名、英文名／別名搜尋藝人（artist:"…" OR alias:"…"）
//   2. 候選要「名稱或別名完全相同」＋「國家 TW 或地區在台灣」＋「類型相符」（團體對 Group，男女歌手對 Person）
//   3. 再抓候選的 release-group，跟已知作品（研究的實體發行標題＋維基簡介裡《》括起來的作品）比對有沒有交集
//   3b. 沒有作品交集時，改看 MusicBrainz 關係（跟名單裡其他藝人是團員等關係）或該候選的發行掛在顏社／本色
//   4. 恰好一位候選同時符合 2、3（或 3b） → 對應成功；沒有已知作品可比、但恰好一位符合 2 → 也列「疑義」不配

import { createHash } from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE = join(root, ".cache", "musicbrainz");
const UA = "Lemicang/0.1 ( zukawork0312@gmail.com )";
const API = "https://musicbrainz.org/ws/2/";

// WSL 沒有 IPv6 出口，Node 預設的雙棧競速（250ms）會在 IPv4 還沒連上前就放棄：固定走 IPv4
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

let last = 0;
export const stats = { network: 0, cached: 0, retries: 0 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET MusicBrainz（有快取就讀快取） */
export async function mb(path) {
  const url = `${API}${path}${path.includes("?") ? "&" : "?"}fmt=json`;
  const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) {
    stats.cached++;
    return JSON.parse(readFileSync(file, "utf8")).body;
  }
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    stats.network++;
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      stats.retries++;
      console.error(`  連線失敗（${e.message}），${2 ** (attempt + 1)} 秒後重試：${url}`);
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    if (res.status === 503 || res.status === 429 || res.status >= 500) {
      stats.retries++;
      console.error(`  ${res.status}，${2 ** (attempt + 1)} 秒後重試：${url}`);
      await sleep(2 ** (attempt + 1) * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`MusicBrainz ${res.status}：${url}`);
    const body = await res.json();
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
    return body;
  }
  throw new Error(`MusicBrainz 重試 6 次仍失敗：${url}`);
}

/** 分頁抓完 browse 結果 */
async function browseAll(entity, params, key) {
  const out = [];
  for (let offset = 0; ; ) {
    const b = await mb(`${entity}?${params}&limit=100&offset=${offset}`);
    const list = b[key] ?? [];
    out.push(...list);
    offset += list.length;
    const total = b[`${entity}-count`] ?? 0;
    if (!list.length || offset >= total) break;
  }
  return out;
}

// 簡轉繁（只供比對用，不改寫標題）：MusicBrainz 有些台灣發行的標題是簡體（例：內部整修→内部整修）。
// 這張表是 2026-09-28 用 OpenCC s2t 對快取裡出現過的 1,020 個漢字轉出來的 120 個，兩邊都轉，所以「台→臺」這種過度轉換不影響比對
const S = "与业东两个么乐乡于们会体兰关内写军净划别办动区发变台号吃后员哑哗唇团国坠娱宝对尔岁岩岳师帮干床开张弥当彦戏托护拨摇敛断时术来桦梦楼毕气没满点烟烦热爱独电种秘约经绑给绝绿脏艺补袭见觉计让记诗话说谁贪赌过这进远里钢钱键长门问间陈难雾静韩题飞马验";
const T = "與業東兩個麼樂鄉於們會體蘭關內寫軍淨劃別辦動區發變臺號喫後員啞譁脣團國墜娛寶對爾歲巖嶽師幫幹牀開張彌當彥戲託護撥搖斂斷時術來樺夢樓畢氣沒滿點煙煩熱愛獨電種祕約經綁給絕綠髒藝補襲見覺計讓記詩話說誰貪賭過這進遠裏鋼錢鍵長門問間陳難霧靜韓題飛馬驗";
const S2T = new Map([...S].map((c, i) => [c, [...T][i]]));
const toT = (s) => [...s].map((c) => S2T.get(c) ?? (c === "台" ? "臺" : c)).join("");

export const norm = (s) =>
  toT(String(s ?? ""))
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

const isTaiwan = (a) =>
  a.country === "TW" ||
  /taiwan|臺灣|台灣|taipei|kaohsiung|tainan|taichung/i.test([a.area?.name, a["begin-area"]?.name].filter(Boolean).join(" "));
const typeOk = (want, got) => (want === "group" ? got === "Group" : want === "male" || want === "female" ? got === "Person" : true);

/** 已知作品是否有交集：標題正規化後相等，或一方包含另一方（至少 2 字） */
export function titleHit(known, titles) {
  const k = known.map(norm).filter((x) => x.length >= 2);
  return titles.filter((t) => {
    const n = norm(t);
    return n.length >= 2 && k.some((x) => x === n || (x.length >= 3 && n.includes(x)) || (n.length >= 3 && x.includes(n)));
  });
}

/**
 * 對應一位藝人。person：{ slug, name, en: string[], gender, known: string[], peers: string[]（名單裡其他藝人的名字） }
 * 回傳 { status: "ok"|"doubt"|"none", mbid?, candidates, reason }
 */
export async function matchArtist(person) {
  const names = [person.name, ...person.en].filter(Boolean);
  const terms = names.map((n) => `artist:"${n.replace(/"/g, "")}" OR alias:"${n.replace(/"/g, "")}"`).join(" OR ");
  const res = await mb(`artist?query=${encodeURIComponent(terms)}&limit=15`);
  const wanted = new Set(names.map(norm));
  const exact = (res.artists ?? []).filter((a) => [a.name, a["sort-name"], ...(a.aliases ?? []).map((x) => x.name)].some((n) => wanted.has(norm(n))));
  const cands = [];
  for (const a of exact.slice(0, 5)) {
    const tw = isTaiwan(a);
    const typ = typeOk(person.gender, a.type);
    let hits = [];
    if (tw && typ && person.known.length) {
      const rgs = await browseAll("release-group", `artist=${a.id}`, "release-groups");
      hits = titleHit(person.known, rgs.map((g) => g.title));
    }
    cands.push({ mbid: a.id, name: a.name, country: a.country ?? a.area?.name ?? "", type: a.type ?? "", disambiguation: a.disambiguation ?? "", tw, typ, hits });
  }
  // 第二層佐證（沒有作品交集時）：跟名單裡其他藝人有 MusicBrainz 關係（例：團員），或自己的發行掛在顏社／本色
  for (const c of cands.filter((x) => x.tw && x.typ && !x.hits.length)) {
    const a = await mb(`artist/${c.mbid}?inc=artist-rels`);
    const peers = new Set((person.peers ?? []).map(norm));
    const rel = (a.relations ?? []).find((r) => r.artist && [r.artist.name, r.artist["sort-name"]].some((n) => peers.has(norm(n))));
    if (rel) c.hits.push(`關係：${rel.type} ${rel.artist.name}`);
    else {
      const rs = await releasesOf(c.mbid);
      const lab = rs.flatMap((r) => (r["label-info"] ?? []).map((l) => l.label?.name ?? "")).find((n) => /顏社|KAO!?\s*INC|本色/i.test(n));
      if (lab) c.hits.push(`發行廠牌：${lab}`);
    }
  }
  const strong = cands.filter((c) => c.tw && c.typ && c.hits.length);
  const weak = cands.filter((c) => c.tw && c.typ);
  if (strong.length === 1) return { status: "ok", mbid: strong[0].mbid, candidates: cands, reason: `名稱相符、台灣、類型相符，佐證：${strong[0].hits.slice(0, 3).join("、")}` };
  if (strong.length > 1) return { status: "doubt", candidates: cands, reason: `多位候選都符合（${strong.map((c) => c.mbid).join("、")}）` };
  if (weak.length && !person.known.length) return { status: "doubt", candidates: cands, reason: "名稱、國家、類型相符，但沒有已知作品、團員關係或顏社／本色發行可交叉比對" };
  if (weak.length) return { status: "doubt", candidates: cands, reason: "名稱、國家、類型相符，但作品、團員關係、發行廠牌都沒有交集" };
  if (cands.length) return { status: "doubt", candidates: cands, reason: "名稱相符，但國家或類型對不上" };
  return { status: "none", candidates: [], reason: "MusicBrainz 查無同名藝人" };
}

/** 抓一位藝人的全部 release（含 media、曲目、廠牌、release-group、artist-credit） */
export const releasesOf = (mbid) =>
  browseAll("release", `artist=${mbid}&inc=${encodeURIComponent("media+recordings+labels+release-groups+artist-credits")}`, "releases");

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const q = process.argv[2] ?? "國蛋";
  console.log(JSON.stringify(await matchArtist({ slug: "x", name: q, en: [], gender: null, known: [] }), null, 2));
}
