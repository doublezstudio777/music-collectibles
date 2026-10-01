// 金曲金音「類型或地區待確認」的 109 位：先用 Wikidata 補類型（男歌手／女歌手／團體）與地區（國內／國外）。
// 2026-10-01 自動補資料第 3 層。只讀網路、不寫資料庫；結果給 scripts/import-pending-artists.mjs 用。
//
// 規則（有疑義就不填）：
//   1. 找 Wikidata 項目
//      a. 研究的維基簡介有中文維基條目 → 用條目標題反查（sitelinks＝同一篇，就是同一位）
//      b. 沒有條目 → 用名字搜（中、英各搜一次）；中英連寫的名字（Acid Brain酸腦、ERIKA劉艾立）拆開各搜一次，
//         「／」分隔的（林煒翔／Roger Lin）也拆開。候選的標籤或別名要跟其中一個名字「完全相同」才算
//   2. 證據：同名之外，候選還要「是音樂人或樂團」（職業、項目類型或描述）而且「跟台灣有關」（國籍、來源國、成團地、出生地在台灣，或描述寫台灣）。
//      恰好一位同時符合 → 成功；同名的音樂人不只一位，或只有同名、沒有台灣的關聯 → 疑義（不填）；連同名都沒有 → 失敗
//      （1a 用維基條目對上的，條目相同本身就是證據，不再要求台灣關聯）
//   3. 成功的才填：類型看項目類型（樂團類→團體；人→性別），地區看國家（只有台灣→國內、只有其他國家→國外、兩邊都有→不填；
//      完全沒有國家屬性、描述寫台灣→國內）。2020 年以前過世的同名者不算；研究填的維基條目不是本人（是所屬樂團）→ 疑義
// Wikidata 每秒最多 1 次，User-Agent 用網站網址；回應快取在 網站/.cache/wikidata/（已在 .gitignore 的 .cache 底下）
//
// 用法（在 網站/ 底下）：node scripts/wikidata-pending.mjs [--out <json>]
// 產出：.cache/wikidata/pending-result.json（給匯入腳本）；--out 另存一份到指定路徑（報告用）

import { createHash } from "node:crypto";
import dns from "node:dns";
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily(false);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const research = join(root, "..", "研究");
const CACHE = join(root, ".cache", "wikidata");
const UA = "Lemibox/0.1 ( https://lemibox.com )";
const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out") >= 0 ? argv[argv.indexOf("--out") + 1] : null;

/* ---------- CSV（同 import-artists.mjs） ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const readCsv = (...p) => parseCsv(readFileSync(join(research, ...p), "utf8"));

/** 金曲金音名單裡類型或地區待確認、而且不在顏社本色名單的（＝站上沒有的 109 位） */
export function pendingRows() {
  const v2 = readCsv("20260927_金曲金音近三屆入圍藝人", "藝人名單_v2.csv");
  const label = new Set(readCsv("20260927_顏社本色音樂", "藝人.csv").map((r) => r["網址識別碼"]));
  return v2.filter((r) => (r["類型"] === "待確認" || r["地區"] === "待確認") && !label.has(r["網址識別碼"]));
}

/** 名字拆開：「／」分隔、中英連寫（拉丁字母段與漢字段分開），去掉太短的 */
export function splitNames(name, en = "") {
  const out = new Set([name.trim(), ...en.split("/").map((x) => x.trim())]);
  for (const part of name.split(/[／/]/).map((x) => x.trim())) {
    out.add(part);
    const latin = part.match(/[A-Za-z0-9][A-Za-z0-9 .'’_&!\-]*[A-Za-z0-9.!]?/g) ?? [];
    const cjk = part.match(/[\p{Script=Han}][\p{Script=Han}．・·]*/gu) ?? [];
    if (latin.length && cjk.length) [...latin, ...cjk].forEach((x) => out.add(x.trim()));
  }
  return [...out].filter((x) => x && x.replace(/[\s.]/g, "").length >= 2);
}

/* ---------- 比對用正規化（同 musicbrainz-fetch.mjs 的 norm，只做大小寫、全半形、去標點空白） ---------- */
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

/* ---------- Wikidata（快取、每秒 1 次） ---------- */
let last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stats = { network: 0, cached: 0 };
async function wd(url) {
  const file = join(CACHE, `${createHash("sha1").update(url).digest("hex")}.json`);
  if (existsSync(file)) {
    stats.cached++;
    return JSON.parse(readFileSync(file, "utf8")).body;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    stats.network++;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) throw new Error(String(res.status));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify({ url, fetchedAt: new Date().toISOString(), body }));
      return body;
    } catch (e) {
      console.error(`  Wikidata 失敗（${e.message}），${2 ** (attempt + 1)} 秒後重試`);
      await sleep(2 ** (attempt + 1) * 1000);
    }
  }
  throw new Error(`Wikidata 重試 5 次仍失敗：${url}`);
}
const API = "https://www.wikidata.org/w/api.php?format=json&";
const search = (q, lang) => wd(`${API}action=wbsearchentities&search=${encodeURIComponent(q)}&language=${lang}&uselang=${lang}&type=item&limit=10&strictlanguage=0`);
async function entities(ids, props = "labels|aliases|descriptions|claims|sitelinks") {
  const out = {};
  for (let i = 0; i < ids.length; i += 40) {
    const part = ids.slice(i, i + 40);
    const b = await wd(`${API}action=wbgetentities&ids=${part.join("|")}&props=${props}&languages=zh-tw|zh-hant|zh|en&sitefilter=zhwiki`);
    Object.assign(out, b.entities ?? {});
  }
  return out;
}
const claimIds = (e, p) => (e?.claims?.[p] ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

/* ---------- 判斷 ---------- */
const TAIWAN = "Q865";
const GROUP_Q = new Set(["Q215380", "Q5741069", "Q2088357", "Q9212979", "Q641066", "Q56816954", "Q281643", "Q216337", "Q1140262", "Q105543609", "Q2281119"]);
const MUSIC_JOB = new Set([
  "Q177220", "Q639669", "Q488205", "Q36834", "Q2252262", "Q183945", "Q130857", "Q855091", "Q486748", "Q753110", "Q822146", "Q386854",
  "Q15981151", "Q584301", "Q66763670", "Q1327329", "Q12800682", "Q1259917", "Q13219637", "Q158852", "Q1075651", "Q1198887", "Q806349",
  "Q2490358", "Q3922505", "Q5716684", "Q16145150", "Q1028181",
]);
const MUSIC_DESC = /歌手|樂團|乐团|樂隊|乐队|音樂|音乐|饒舌|說唱|嘻哈|作曲|製作人|唱作|DJ|singer|musician|band|rapper|composer|producer|songwriter|music|duo|group/i;
const TAIWAN_DESC = /台灣|臺灣|台湾|Taiwan/i;

function facts(e, places) {
  const inst = new Set(claimIds(e, "P31"));
  const jobs = new Set(claimIds(e, "P106"));
  const desc = Object.values(e?.descriptions ?? {}).map((d) => d.value).join("｜");
  const countries = new Set([...claimIds(e, "P27"), ...claimIds(e, "P495"), ...claimIds(e, "P17")]);
  for (const p of [...claimIds(e, "P740"), ...claimIds(e, "P19")]) for (const c of places.get(p) ?? []) countries.add(c);
  const group = [...inst].some((q) => GROUP_Q.has(q));
  const human = inst.has("Q5");
  const music = group || [...jobs].some((q) => MUSIC_JOB.has(q)) || MUSIC_DESC.test(desc);
  const tw = countries.has(TAIWAN) || TAIWAN_DESC.test(desc);
  const other = [...countries].some((c) => c !== TAIWAN);
  const g = claimIds(e, "P21");
  const gender = group ? "group" : human && g.includes("Q6581097") ? "male" : human && g.includes("Q6581072") ? "female" : null;
  // 地區只看國家屬性（描述裡的「台灣」只當關聯證據，不拿來定國內外）
  const twC = countries.has(TAIWAN);
  // 完全沒有國家屬性時，描述寫台灣（「台灣創作歌手」）也算國內
  const region = twC && !other ? "domestic" : !twC && other ? "overseas" : !countries.size && TAIWAN_DESC.test(desc) ? "domestic" : null;
  // 2020 年以前過世的不可能是 2024～2026 金曲金音的入圍者（例：搜「葉俊麟」會找到 1998 年過世的作詞家，入圍金音的是另一位樂手）
  const died = (e?.claims?.P570 ?? []).map((c) => c.mainsnak?.datavalue?.value?.time ?? "").find(Boolean) ?? "";
  const dead = /^[+-]?(\d{4})/.test(died) && Number(died.match(/(\d{4})/)[1]) < 2020;
  return { music, tw, gender, region, desc, dead, countries: [...countries], zhwiki: e?.sitelinks?.zhwiki?.title ?? "" };
}
const labelsOf = (e) => [
  ...Object.values(e?.labels ?? {}).map((x) => x.value),
  ...Object.values(e?.aliases ?? {}).flatMap((xs) => xs.map((x) => x.value)),
];

export async function resolve(row, wikiUrl) {
  const names = splitNames(row["藝人中文名"], row["藝人英文名"]);
  const wanted = new Set(names.map(norm));
  let ids = [];
  let via = "";
  if (wikiUrl) {
    const title = decodeURIComponent(wikiUrl.split("/wiki/")[1] ?? "").replace(/_/g, " ");
    const b = await wd(`${API}action=wbgetentities&sites=zhwiki&titles=${encodeURIComponent(title)}&props=info`);
    ids = Object.keys(b.entities ?? {}).filter((q) => /^Q\d+$/.test(q));
    if (ids.length) via = `中文維基條目「${title}」`;
  }
  if (!ids.length) {
    const found = new Set();
    for (const n of names) for (const lang of /[\p{Script=Han}]/u.test(n) ? ["zh", "en"] : ["en", "zh"]) for (const x of (await search(n, lang)).search ?? []) found.add(x.id);
    ids = [...found];
  }
  if (!ids.length) return { status: "失敗", reason: "Wikidata 查無同名項目", names, candidates: [] };
  const ents = await entities(ids);
  // 地點（成團地、出生地）→ 國家
  const placeIds = [...new Set(ids.flatMap((q) => [...claimIds(ents[q], "P740"), ...claimIds(ents[q], "P19")]))];
  const placeEnts = placeIds.length ? await entities(placeIds, "claims") : {};
  const places = new Map(placeIds.map((p) => [p, claimIds(placeEnts[p], "P17")]));
  const cands = ids
    .map((q) => ({ qid: q, label: labelsOf(ents[q])[0] ?? q, exact: via ? true : labelsOf(ents[q]).some((l) => wanted.has(norm(l))), ...facts(ents[q], places) }))
    .filter((c) => c.exact);
  const brief = (c) => ({ qid: c.qid, label: c.label, desc: c.desc.slice(0, 80), music: c.music, tw: c.tw, dead: c.dead, gender: c.gender, region: c.region, countries: c.countries });
  if (via) {
    const c = cands[0];
    // 研究填的維基條目是別人的（例：林以樂填的是「雀斑樂團」條目）→ 條目相同不能當同一人的證據
    if (!c.zhwiki || !wanted.has(norm(c.zhwiki)))
      return { status: "疑義", reason: `研究填的中文維基條目是「${c.zhwiki || "?"}」，不是本人的條目（可能是所屬樂團）`, names, candidates: cands.map(brief) };
    return { status: "成功", qid: c.qid, evidence: via, gender: c.gender, region: c.region, names, candidates: cands.map(brief) };
  }
  if (!cands.length) return { status: "失敗", reason: "Wikidata 有搜尋結果，但沒有名字完全相同的", names, candidates: [] };
  const musicTw = cands.filter((c) => c.music && c.tw && !c.dead);
  if (musicTw.length === 1) {
    const c = musicTw[0];
    const ev = [`名稱相同（${names.filter((n) => labelsOf(ents[c.qid]).some((l) => norm(l) === norm(n))).join("、")}）`, "音樂人／樂團", c.countries.includes(TAIWAN) ? "國家台灣" : "描述寫台灣"];
    return { status: "成功", qid: c.qid, evidence: ev.join("、"), gender: c.gender, region: c.region, names, candidates: cands.map(brief) };
  }
  if (musicTw.length > 1) return { status: "疑義", reason: `同名而且跟台灣有關的音樂人有 ${musicTw.length} 位`, names, candidates: cands.map(brief) };
  if (cands.some((c) => c.music && c.tw && c.dead)) return { status: "疑義", reason: "同名的台灣音樂人在 2020 年以前就過世了，不是這次入圍的人", names, candidates: cands.map(brief) };
  if (cands.some((c) => c.music)) return { status: "疑義", reason: "同名的音樂人，但看不出跟台灣有關", names, candidates: cands.map(brief) };
  return { status: "疑義", reason: "同名項目都不是音樂人", names, candidates: cands.map(brief) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wiki = new Map(
    readCsv("20260927_金曲金音近三屆入圍藝人", "維基簡介.csv")
      .filter((w) => w["狀態"] === "已取得" && w["維基條目網址"])
      .map((w) => [w["藝人中文名"], w["維基條目網址"]]),
  );
  const rows = pendingRows();
  console.log(`== Wikidata 補類型地區（${rows.length} 位） ==`);
  const out = [];
  for (const r of rows) {
    const x = await resolve(r, wiki.get(r["藝人中文名"]));
    out.push({ slug: r["網址識別碼"], name: r["藝人中文名"], csvType: r["類型"], csvRegion: r["地區"], ...x });
    console.log(`  ${x.status} ${r["藝人中文名"]}（${r["網址識別碼"]}）${x.qid ?? ""} ${x.gender ?? ""} ${x.region ?? ""}：${x.evidence ?? x.reason}`);
  }
  const sum = { 成功: 0, 疑義: 0, 失敗: 0 };
  out.forEach((x) => sum[x.status]++);
  const result = { generatedAt: new Date().toISOString(), 總數: out.length, ...sum, 請求: stats, list: out };
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(join(CACHE, "pending-result.json"), JSON.stringify(result, null, 2));
  if (outArg) writeFileSync(outArg, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...sum, 請求: stats }));
}
