// 發布時自動補資料（2026-09-30）：會員在炫收藏表單選「這裡沒有，我要新增」建了藝人、系列、版本，
// 系統在背景去 MusicBrainz、Wikidata 查，把能確定的事實先填好，管理員在後台「待確認的新增」看過按核准。
// 全部在 Worker 裡跑，不呼叫 AI、不用金鑰，零費用。
//
// 觸發：recordAddition（additions.ts）排一筆工作 → waitUntil 背景跑，不卡使用者發布；
//   沒跑完（額度、MusicBrainz 忙線）的由排程 `*/10 * * * *` 接手。一次只有一個執行在跑（D1 鎖），
//   MusicBrainz 每秒最多 1 次（上次呼叫時間存 D1）。
// 先後：藝人剛建時還沒有作品可比對，之後同一位藝人底下新增系列、系列底下新增版本時，上一層沒定案的工作會重排，
//   用新的作品當佐證再查一次。版本在系列還沒查完前先等（最多 30 分鐘）。
//
// 信心分級（有疑義就不配）：
//   高：條碼吻合；或名稱＋年份＋作品（藝人：作品標題與年份；系列：藝人、標題、年份；版本：系列、格式、年份）吻合且只有一個候選
//       → 只補空白欄位，不蓋掉會員填的值；改前的值存 applied，管理員駁回時還原（只還原「還是我們填的值」的欄位）
//   低：只把候選連結列在後台，不預填
//   未查到：MusicBrainz、Wikidata 都沒有同名
//   重複（dup）：跟站上既有的藝人或系列是同一個（同 MBID，或同藝人同標題同年份）→ 不預填，後台核准＝改掛到既有那筆
// 只取事實欄位，不從維基百科抄任何文字（藝人簡介、系列介紹都不碰）。
// 管理員自己新增的也照跑（高信心一樣預填），只是新增紀錄本來就算確認過，不進待確認。

import { env, waitUntil } from "cloudflare:workers";
import {
  BLANK,
  Busy,
  cleanBarcode,
  isDigital,
  lq,
  mb,
  mbUrl,
  mnorm,
  OutOfBudget,
  regionCode,
  releaseFields,
  SERIES_KIND,
  wd,
  wdUrl,
  type Budget,
  type MbRelease,
  type VersionFill,
} from "@/lib/server/autofill-mb";
import { releaseScanStep, scanState } from "@/lib/server/release-scan";

const scanActive = async () => {
  const st = await scanState();
  return Boolean(st && !st.finishedAt);
};

export type AfSource = { label: string; url: string };
export type AfCandidate = { label: string; url: string; note?: string; mbid?: string };
export type AfResult = {
  summary: string;
  fields: { label: string; value: string }[];
  sources: AfSource[];
  candidates: AfCandidate[];
  dup?: { into: string; label: string; url?: string };
};
type Change = { before: Record<string, string | null>; set: Record<string, string | null> };
export type AfApplied = {
  artist?: { slug: string } & Change;
  series?: { id: number } & Change;
  versions?: ({ id: number } & Change)[];
  createdVersions?: number[];
  createdItems?: number[];
  /** 自動建、後來發現跟會員新增的是同一版而收掉的版本 id（還原時恢復） */
  absorbed?: number[];
};
type Outcome = { confidence: "high" | "low" | "none" | "dup"; result: AfResult; applied?: AfApplied; defer?: number };
type Job = { id: number; additionId: number; type: string; ref: string; hint: string | null; applied: string; tries: number; createdAt: string };

const db = () => env.DB!;
const nowIso = () => new Date().toISOString();
const later = (sec: number) => new Date(Date.now() + sec * 1000).toISOString();
const J = <T>(s: string | null | undefined, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAIWAN_QID = "Q865";
/** 版本條碼是人填的（不是自動補資料從 MusicBrainz 帶進來的）：只有這種條碼能當佐證，避免拿自己的結果當證據 */
const human = (col: string) => `COALESCE(v.source, '') <> 'musicbrainz' AND NOT EXISTS (SELECT 1 FROM autofill_jobs j, json_each(j.applied, '$.versions') e
  WHERE json_extract(e.value, '$.id') = v.id AND json_extract(e.value, '$.set.${col}') IS NOT NULL)`;
const HUMAN_BARCODE = human("barcode");

/* =====================================================================
 * 排工作、重排、背景執行
 * ===================================================================== */

/** 新增紀錄建好後呼叫：排一筆工作，並把上一層還沒定案的工作重排（多了作品可以當佐證） */
export async function enqueueAutofill(additionId: number, type: string, ref: string) {
  await db()
    .prepare(`INSERT INTO autofill_jobs (addition_id, type, ref) VALUES (?1, ?2, ?3) ON CONFLICT(addition_id) DO NOTHING`)
    .bind(additionId, type, ref)
    .run();
  if (type === "series") {
    const w = await db().prepare(`SELECT artist_slug AS a FROM series WHERE id = ?1`).bind(Number(ref)).first<{ a: string }>();
    if (w) await requeueRef("artist", w.a);
  }
  if (type === "version") {
    const v = await db()
      .prepare(`SELECT w.id AS sid, w.artist_slug AS a FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = ?1`)
      .bind(Number(ref))
      .first<{ sid: number; a: string }>();
    if (v) {
      await requeueRef("series", String(v.sid));
      await requeueRef("artist", v.a);
    }
  }
  kickAutofill();
}

/** 重排某筆新增的工作：只重排還沒定案（不是高信心、重複，管理員也還沒處理）的 */
export async function requeueRef(type: string, ref: string) {
  await db()
    .prepare(
      `UPDATE autofill_jobs SET status = 'queued', next_at = ?3, updated_at = ?3
       WHERE type = ?1 AND ref = ?2 AND decision IS NULL AND COALESCE(confidence, '') NOT IN ('high', 'dup') AND status <> 'queued'`,
    )
    .bind(type, ref, nowIso())
    .run();
}

/** 背景跑一輪（不等結果）；本機 dev 與正式站都用 cloudflare:workers 的 waitUntil */
export function kickAutofill() {
  try {
    waitUntil(runAutofill({ ms: 25_000, maxCalls: 40 }).catch((e) => console.error("[自動補資料] 執行失敗", e)));
  } catch (e) {
    console.error("[自動補資料] waitUntil 不能用", e);
  }
}

/** 排程鎖（自動補資料、每月補新作品、Spotify 藝人自動比對 2026-10-03 共用）：拿到回 true */
export async function takeLock(ms: number) {
  const r = await db()
    .prepare(
      `INSERT INTO autofill_state (key, value, updated_at) VALUES ('lock', ?1, ?2)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE autofill_state.value < ?2
       RETURNING key`,
    )
    .bind(later(ms / 1000 + 15), nowIso())
    .all();
  return r.results.length > 0;
}
export const dropLock = () => db().prepare(`UPDATE autofill_state SET value = '', updated_at = ?1 WHERE key = 'lock'`).bind(nowIso()).run();

async function nextJob() {
  return db()
    .prepare(
      `SELECT id, addition_id AS additionId, type, ref, hint, applied, tries, created_at AS createdAt FROM autofill_jobs
       WHERE status = 'queued' AND next_at <= ?1 ORDER BY next_at, id LIMIT 1`,
    )
    .bind(nowIso())
    .first<Job>();
}

/** 跑到沒有到期的工作、額度用完或 MusicBrainz 忙線為止。回傳處理了幾筆 */
export async function runAutofill({ ms, maxCalls, scan = false }: { ms: number; maxCalls: number; scan?: boolean }) {
  const start = Date.now();
  let done = 0;
  for (let round = 0; round < 2; round++) {
    if (!(await takeLock(ms))) return { done, locked: true };
    const last = await db().prepare(`SELECT value FROM autofill_state WHERE key = 'mb_last'`).first<{ value: string }>();
    const b: Budget = { calls: 0, maxCalls, deadline: start + ms, mbLast: Number(last?.value) || 0 };
    let stop = false;
    try {
      for (let job = await nextJob(); !stop; job = await nextJob()) {
        if (!job) {
          // 沒有工作了：排程執行時接著跑每月補新作品（一次一位藝人；建了系列就會多出工作，回到迴圈處理）
          if (!scan) break;
          try {
            if (!(await releaseScanStep(b))) break;
          } catch (e) {
            if (e instanceof Busy) console.warn(`[每月補新作品] ${(e as Error).message}，下次排程再查`);
            else if (!(e instanceof OutOfBudget)) console.error("[每月補新作品] 失敗", e);
            stop = true;
          }
          continue;
        }
        try {
          const out = await processJob(b, job);
          if (out.defer) {
            await db().prepare(`UPDATE autofill_jobs SET next_at = ?2, updated_at = ?3 WHERE id = ?1`).bind(job.id, later(out.defer), nowIso()).run();
            continue;
          }
          await db()
            .prepare(`UPDATE autofill_jobs SET status = 'done', confidence = ?2, result = ?3, applied = ?4, updated_at = ?5 WHERE id = ?1`)
            .bind(job.id, out.confidence, JSON.stringify(out.result), JSON.stringify(out.applied ?? {}), nowIso())
            .run();
          done++;
        } catch (e) {
          if (e instanceof OutOfBudget) {
            stop = true;
          } else if (e instanceof Busy) {
            console.warn(`[自動補資料] ${(e as Error).message}，工作 ${job.id} 2 分鐘後再試`);
            await db().prepare(`UPDATE autofill_jobs SET next_at = ?2, updated_at = ?3 WHERE id = ?1`).bind(job.id, later(120), nowIso()).run();
            stop = true;
          } else {
            const tries = job.tries + 1;
            console.error(`[自動補資料] 工作 ${job.id} 失敗`, e);
            await db()
              .prepare(`UPDATE autofill_jobs SET tries = ?2, status = ?3, next_at = ?4, result = ?5, updated_at = ?6 WHERE id = ?1`)
              .bind(
                job.id,
                tries,
                tries >= 4 ? "error" : "queued",
                later(60 * 2 ** tries),
                JSON.stringify({ summary: `查詢出錯：${(e as Error).message}`.slice(0, 300), fields: [], sources: [], candidates: [] }),
                nowIso(),
              )
              .run();
          }
        }
      }
    } finally {
      await db()
        .prepare(`INSERT INTO autofill_state (key, value) VALUES ('mb_last', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?2`)
        .bind(String(b.mbLast), nowIso())
        .run();
      await dropLock();
    }
    // 放鎖前剛好有人排了新工作、又因為鎖在而沒跑：再看一次
    if (stop || Date.now() - start > ms - 5000 || (!(await nextJob()) && !(scan && (await scanActive())))) break;
  }
  return { done, locked: false };
}

async function processJob(b: Budget, job: Job): Promise<Outcome> {
  // 管理員重查：先還原上一次預填的內容再查
  const prev = J<AfApplied>(job.applied, {});
  if (Object.keys(prev).length) {
    await undoApplied(prev);
    await db().prepare(`UPDATE autofill_jobs SET applied = '{}' WHERE id = ?1`).bind(job.id).run();
  }
  if (job.type === "artist") return doArtist(b, job);
  if (job.type === "series") return doSeries(b, job);
  if (job.type === "version") return doVersion(b, job);
  return { confidence: "none", result: empty("不認得的類型") };
}

const empty = (summary: string): AfResult => ({ summary, fields: [], sources: [], candidates: [] });

/* =====================================================================
 * 藝人
 * ===================================================================== */

type MbArtist = {
  id: string;
  name: string;
  "sort-name"?: string;
  type?: string | null;
  gender?: string | null;
  country?: string | null;
  disambiguation?: string;
  area?: { name?: string } | null;
  "begin-area"?: { name?: string } | null;
  aliases?: { name: string; locale?: string | null; primary?: boolean | null; type?: string | null }[];
  relations?: { type: string; url?: { resource: string } }[];
};
type MbRg = { id: string; title: string; "primary-type"?: string | null; "first-release-date"?: string; "artist-credit"?: { name?: string; artist?: { id: string; name: string } }[]; releases?: { id: string; title: string }[] };

const isTaiwanArea = (a: MbArtist) => a.country === "TW" || /taiwan|臺灣|台灣|taipei|kaohsiung|tainan|taichung|hsinchu|keelung|taoyuan/i.test([a.area?.name, a["begin-area"]?.name].filter(Boolean).join(" "));

async function doArtist(b: Budget, job: Job): Promise<Outcome> {
  const a = await db()
    .prepare(`SELECT slug, name, aliases, gender, region, mbid, deleted_at AS deletedAt FROM artists WHERE slug = ?1`)
    .bind(job.ref)
    .first<{ slug: string; name: string; aliases: string; gender: string | null; region: string | null; mbid: string | null; deletedAt: string | null }>();
  if (!a || a.deletedAt) return { confidence: "none", result: empty("這位藝人已經不在了") };
  const aliases = J<string[]>(a.aliases, []);
  // 作品佐證：這位藝人底下的系列（標題、年份）與版本條碼（只看人填的條碼；從 MusicBrainz 建來的版本不算，避免拿自己的結果當證據）
  const works = (
    await db().prepare(`SELECT title, year FROM series WHERE artist_slug = ?1 AND deleted_at IS NULL AND kind <> 'misc'`).bind(a.slug).all<{ title: string; year: string }>()
  ).results;
  const barcodes = (
    await db()
      .prepare(
        `SELECT DISTINCT v.barcode FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
         WHERE w.artist_slug = ?1 AND v.deleted_at IS NULL AND w.deleted_at IS NULL AND ${HUMAN_BARCODE}`,
      )
      .bind(a.slug)
      .all<{ barcode: string }>()
  ).results
    .map((r) => cleanBarcode(r.barcode))
    .filter(Boolean)
    .slice(0, 2);

  const forced = job.hint && UUID.test(job.hint) ? job.hint.toLowerCase() : a.mbid;
  let pick: { id: string; why: string } | null = null;
  const candidates: AfCandidate[] = [];
  let summary = "";

  if (forced) {
    pick = { id: forced, why: job.hint ? "管理員指定" : "已有 MusicBrainz 代碼" };
  } else {
    const names = [a.name, ...aliases].filter(Boolean).slice(0, 4);
    const terms = names.map((n) => `artist:"${lq(n)}" OR alias:"${lq(n)}"`).join(" OR ");
    const res = await mb<{ artists?: MbArtist[] }>(b, `artist?query=${encodeURIComponent(terms)}&limit=10`);
    const wanted = new Set(names.map(mnorm));
    const exact = (res?.artists ?? []).filter((x) => [x.name, x["sort-name"], ...(x.aliases ?? []).map((y) => y.name)].some((n) => wanted.has(mnorm(n))));
    // 條碼佐證：站上這位藝人版本的條碼在 MusicBrainz 掛在誰名下
    const byBarcode = new Map<string, string>();
    for (const bc of barcodes) {
      const r = await mb<{ releases?: MbRelease[] }>(b, `release?query=${encodeURIComponent(`barcode:${bc}`)}&limit=5`);
      for (const rel of r?.releases ?? []) if (cleanBarcode(rel.barcode) === bc) for (const c of rel["artist-credit"] ?? []) if (c.artist) byBarcode.set(c.artist.id, bc);
    }
    const strong: { id: string; why: string }[] = [];
    for (const x of exact.slice(0, 3)) {
      const hits: string[] = [];
      if (byBarcode.has(x.id)) hits.push(`條碼 ${byBarcode.get(x.id)}`);
      if (!hits.length && works.length) {
        const rgs = await mb<{ "release-groups"?: MbRg[] }>(b, `release-group?artist=${x.id}&limit=100`);
        for (const w of works) {
          const t = mnorm(w.title);
          const hit = (rgs?.["release-groups"] ?? []).find((g) => t.length >= 1 && mnorm(g.title) === t);
          if (!hit) continue;
          const y = (hit["first-release-date"] ?? "").slice(0, 4);
          if (/^\d{4}$/.test(w.year) && y && y !== w.year) continue;
          hits.push(`《${w.title}》${/^\d{4}$/.test(w.year) ? ` ${w.year}` : ""}`);
        }
      }
      const where = [x.country, x.area?.name].filter(Boolean).join("・");
      candidates.push({
        label: `${x.name}${x.disambiguation ? `（${x.disambiguation}）` : ""}`,
        url: mbUrl("artist", x.id),
        note: [x.type ?? "類型未標", where || "地區未標", hits.length ? `對上：${hits.join("、")}` : "作品沒有交集"].join("｜"),
        mbid: x.id,
      });
      if (hits.length) strong.push({ id: x.id, why: `名稱相同，作品對上：${hits.slice(0, 3).join("、")}` });
    }
    if (strong.length === 1) pick = strong[0];
    else if (strong.length > 1) summary = `MusicBrainz 有 ${strong.length} 位同名、作品也都對得上，無法確定是哪一位`;
    else if (exact.length) summary = works.length || barcodes.length ? "MusicBrainz 有同名藝人，但作品、條碼都對不上" : "MusicBrainz 有同名藝人，但這位藝人底下還沒有作品可以交叉比對（新增系列後會自動重查）";
    else {
      // MusicBrainz 沒有：Wikidata 找同名，只列連結
      const s = await wd<{ search?: { id: string; label?: string; description?: string }[] }>(
        b,
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(a.name)}&language=zh&uselang=zh-tw&type=item&limit=5&format=json`,
      );
      for (const x of (s?.search ?? []).filter((y) => mnorm(y.label) === mnorm(a.name)))
        candidates.push({ label: `${x.label ?? x.id}（${x.id}）`, url: wdUrl(x.id), note: x.description ? `Wikidata 說明：${x.description}` : "Wikidata 同名項目" });
      if (!candidates.length) return { confidence: "none", result: empty("未查到：MusicBrainz、Wikidata 都沒有同名藝人") };
      summary = "MusicBrainz 沒有同名藝人，Wikidata 有同名項目（只列連結，不預填）";
    }
  }
  if (!pick) return { confidence: "low", result: { summary, fields: [], sources: [], candidates } };

  // 高信心：抓藝人細節＋Wikidata 事實欄位
  const x = await mb<MbArtist>(b, `artist/${pick.id}?inc=aliases+url-rels`);
  if (!x) return { confidence: "low", result: { summary: `MusicBrainz 找不到 ${pick.id}`, fields: [], sources: [], candidates } };
  const dupRow = await db()
    .prepare(`SELECT slug, name FROM artists WHERE mbid = ?1 AND slug <> ?2 AND deleted_at IS NULL LIMIT 1`)
    .bind(x.id, a.slug)
    .first<{ slug: string; name: string }>();
  const sources: AfSource[] = [{ label: `MusicBrainz：${x.name}`, url: mbUrl("artist", x.id) }];
  if (dupRow)
    return {
      confidence: "dup",
      result: { summary: `跟站上既有的「${dupRow.name}」是同一位（MusicBrainz 代碼相同），建議改掛過去`, fields: [], sources, candidates: [], dup: { into: dupRow.slug, label: dupRow.name, url: `/artist/${dupRow.slug}` } },
    };

  const qid = (x.relations ?? []).map((r) => r.url?.resource.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]).find(Boolean) ?? "";
  let wdFacts: { inst: Set<string>; gender: Set<string>; countries: Set<string> } | null = null;
  let wdLabels: string[] = [];
  if (qid) {
    sources.push({ label: `Wikidata：${qid}`, url: wdUrl(qid) });
    const sparql = `SELECT ?inst ?gender ?c WHERE { OPTIONAL { wd:${qid} wdt:P31 ?inst } OPTIONAL { wd:${qid} wdt:P21 ?gender } OPTIONAL { { wd:${qid} wdt:P27 ?c } UNION { wd:${qid} wdt:P495 ?c } UNION { wd:${qid} wdt:P740 ?l . ?l wdt:P17 ?c } } } LIMIT 200`;
    const r = await wd<{ results?: { bindings?: Record<string, { value: string }>[] } }>(b, `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`);
    if (r?.results?.bindings) {
      const q = (v?: { value: string }) => v?.value.split("/").pop() ?? "";
      wdFacts = { inst: new Set(), gender: new Set(), countries: new Set() };
      for (const row of r.results.bindings) {
        if (row.inst) wdFacts.inst.add(q(row.inst));
        if (row.gender) wdFacts.gender.add(q(row.gender));
        if (row.c) wdFacts.countries.add(q(row.c));
      }
    }
    const l = await wd<{ entities?: Record<string, { labels?: Record<string, { value: string }>; aliases?: Record<string, { value: string }[]> }> }>(
      b,
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels&languages=zh-tw|zh-hant|en|ko|ja&format=json`,
    );
    wdLabels = Object.values(l?.entities?.[qid]?.labels ?? {}).map((v) => v.value);
  }

  // 類型：MusicBrainz 為主，Wikidata 交叉；兩邊衝突就不填
  const GROUP_Q = new Set(["Q215380", "Q5741069", "Q2088357", "Q9212979", "Q641066", "Q56816954", "Q281643"]);
  const mbKind = /group|orchestra|choir/i.test(x.type ?? "") ? "group" : x.type === "Person" ? (x.gender === "Male" ? "male" : x.gender === "Female" ? "female" : "person") : "";
  const wdKind = !wdFacts
    ? ""
    : [...wdFacts.inst].some((q) => GROUP_Q.has(q))
      ? "group"
      : wdFacts.inst.has("Q5")
        ? wdFacts.gender.has("Q6581097")
          ? "male"
          : wdFacts.gender.has("Q6581072")
            ? "female"
            : "person"
        : "";
  let gender: string | null = null;
  if (mbKind && mbKind !== "person") gender = !wdKind || wdKind === mbKind || (wdKind === "person" && mbKind !== "group") ? mbKind : null;
  else if (!mbKind && wdKind && wdKind !== "person") gender = wdKind;
  else if (mbKind === "person" && (wdKind === "male" || wdKind === "female")) gender = wdKind;

  // 地區：台灣的訊號與其他國家的訊號只有一邊才填
  const tw = isTaiwanArea(x) || Boolean(wdFacts?.countries.has(TAIWAN_QID));
  const other = Boolean(x.country && x.country !== "TW" && x.country !== "XW") || [...(wdFacts?.countries ?? [])].some((c) => c !== TAIWAN_QID);
  const region = tw && !other ? "domestic" : !tw && other ? "overseas" : null;

  // 別名：MusicBrainz 名稱與主要語言別名、Wikidata 標籤（繁中、英、韓、日），去掉跟站上名稱或既有別名重複的
  const LOC = /^(zh_Hant|zh_TW|zh_HK|zh|en|ko|ja)/;
  const seen = new Set([a.name, ...aliases].map(mnorm));
  const add: string[] = [];
  for (const n of [x.name, ...(x.aliases ?? []).filter((y) => y.locale && LOC.test(y.locale) && y.type !== "Search hint").map((y) => y.name), ...wdLabels]) {
    const k = mnorm(n);
    if (!n || !k || seen.has(k) || n.length > 40) continue;
    seen.add(k);
    add.push(n.trim());
    if (add.length >= 6) break;
  }

  const set: Record<string, string | null> = {};
  const before: Record<string, string | null> = {};
  const fields: AfResult["fields"] = [];
  const G = { male: "男歌手", female: "女歌手", group: "團體" } as Record<string, string>;
  if (!a.mbid) {
    before.mbid = null;
    set.mbid = x.id;
    fields.push({ label: "MusicBrainz 代碼", value: x.id });
  }
  if (!a.gender && gender) {
    before.gender = null;
    set.gender = gender;
    fields.push({ label: "類型", value: G[gender] ?? gender });
  }
  if (!a.region && region) {
    before.region = null;
    set.region = region;
    fields.push({ label: "地區", value: region === "domestic" ? "國內" : "國外" });
  }
  if (add.length) {
    before.aliases = a.aliases;
    set.aliases = JSON.stringify([...aliases, ...add]);
    fields.push({ label: "別名", value: add.join("、") });
  }
  // mbid 撞到別人（剛好同時被別筆寫入）就不寫 mbid
  if (Object.keys(set).length) {
    const cols = Object.keys(set);
    await db()
      .prepare(`UPDATE artists SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(", ")}, updated_at = ?${cols.length + 2} WHERE slug = ?1`)
      .bind(a.slug, ...cols.map((c) => set[c]), nowIso())
      .run();
  }
  const notes = [pick.why];
  if (!gender && (mbKind || wdKind)) notes.push("類型兩邊資料不一致，沒填");
  if (!region && tw && other) notes.push("地區兩邊資料不一致（台灣與其他國家都有），沒填");
  return {
    confidence: "high",
    result: { summary: `高信心：${notes.join("；")}`, fields: fields.length ? fields : [{ label: "預填", value: "欄位都已經有值，沒有要補的" }], sources, candidates: [] },
    applied: Object.keys(set).length ? { artist: { slug: a.slug, before, set } } : {},
  };
}

/* =====================================================================
 * 系列
 * ===================================================================== */

type SeriesRow = { id: number; artistSlug: string; no: number; title: string; year: string; kind: string; seriesType: string; name: string; mbid: string | null; deletedAt: string | null };
const SERIES_SQL = `SELECT id, artist_slug AS artistSlug, no, title, year, kind, series_type AS seriesType, name, mbid, deleted_at AS deletedAt FROM series`;
const SERIES_TYPE: Record<string, string> = { album: "專輯發行", ep: "EP 發行", single: "單曲發行" };

async function releasesOfRg(b: Budget, rgId: string) {
  const r = await mb<{ releases?: MbRelease[] }>(b, `release?release-group=${rgId}&inc=${encodeURIComponent("media+recordings+labels+artist-credits")}&limit=50`);
  return r?.releases ?? [];
}

const physicalOfficial = (rs: MbRelease[]) => rs.filter((r) => (!r.status || r.status === "Official") && releaseFields(r));

async function doSeries(b: Budget, job: Job): Promise<Outcome> {
  const w = await db().prepare(`${SERIES_SQL} WHERE id = ?1`).bind(Number(job.ref)).first<SeriesRow>();
  if (!w || w.deletedAt) return { confidence: "none", result: empty("這個系列已經不在了") };
  if (w.kind === "misc" || w.kind === "tour" || w.kind === "brand")
    return { confidence: "none", result: empty("演唱會、品牌周邊不在 MusicBrainz 收錄範圍，沒查") };
  const a = await db().prepare(`SELECT slug, name, aliases, mbid FROM artists WHERE slug = ?1`).bind(w.artistSlug).first<{ slug: string; name: string; aliases: string; mbid: string | null }>();
  if (!a) return { confidence: "none", result: empty("找不到藝人") };
  const hasYear = /^\d{4}$/.test(w.year);

  // 重名：同一位藝人已經有同標題（年份相同或有一邊沒填）的系列 → 建議改掛，不用查 MusicBrainz
  const same = (
    await db().prepare(`${SERIES_SQL} WHERE artist_slug = ?1 AND id <> ?2 AND deleted_at IS NULL AND kind <> 'misc'`).bind(w.artistSlug, w.id).all<SeriesRow>()
  ).results.find((x) => mnorm(x.title) === mnorm(w.title) && (!hasYear || !/^\d{4}$/.test(x.year) || x.year === w.year));
  if (same)
    return {
      confidence: "dup",
      result: { summary: `同一位藝人已經有《${same.title}》${same.year ? `（${same.year}）` : ""}，建議改掛過去`, fields: [], sources: [], candidates: [], dup: { into: `${same.artistSlug}/${same.no}`, label: `《${same.title}》${same.year}`, url: `/artist/${same.artistSlug}/${same.no}` } },
    };

  // 這個系列底下的版本：條碼、曲目當佐證
  const vs = (
    await db()
      .prepare(`SELECT CASE WHEN ${HUMAN_BARCODE} THEN v.barcode ELSE '' END AS barcode, CASE WHEN ${human("track_list")} THEN v.track_list ELSE '[]' END AS trackList FROM versions v JOIN items i ON i.id = v.item_ref WHERE i.series_id = ?1 AND v.deleted_at IS NULL AND COALESCE(v.source, '') <> 'musicbrainz'`)
      .bind(w.id)
      .all<{ barcode: string; trackList: string }>()
  ).results;
  const myBarcodes = new Set(vs.map((v) => cleanBarcode(v.barcode)).filter(Boolean));
  const myTracks = vs.map((v) => J<string[]>(v.trackList, [])).find((t) => t.length) ?? [];

  const forced = job.hint && UUID.test(job.hint) ? job.hint.toLowerCase() : w.mbid;
  const candidates: AfCandidate[] = [];
  let pick: { rg: MbRg; releases: MbRelease[]; why: string } | null = null;
  let summary = "";
  if (forced) {
    const rg = await mb<MbRg>(b, `release-group/${forced}?inc=artist-credits`);
    if (!rg) return { confidence: "low", result: { summary: `MusicBrainz 找不到 ${forced}`, fields: [], sources: [], candidates } };
    pick = {
      rg,
      releases: await releasesOfRg(b, rg.id),
      why:
        job.hint === "monthly"
          ? "每月補新作品：這位藝人在 MusicBrainz 的作品清單裡有、站上還沒有的新發行"
          : job.hint
            ? "管理員指定"
            : "系列已經有 MusicBrainz 代碼（版本用條碼對上時寫入，或原本就有）",
    };
  } else {
    const artistQ = a.mbid ? `arid:${a.mbid}` : `artist:"${lq(a.name)}"`;
    const res = await mb<{ "release-groups"?: MbRg[] }>(b, `release-group?query=${encodeURIComponent(`releasegroup:"${lq(w.title)}" AND ${artistQ}`)}&limit=10`);
    const names = new Set([a.name, ...J<string[]>(a.aliases, [])].map(mnorm));
    const t = mnorm(w.title);
    const cands = (res?.["release-groups"] ?? []).filter((g) => mnorm(g.title) === t || (g.releases ?? []).some((r) => mnorm(r.title) === t));
    const scored: { rg: MbRg; releases: MbRelease[]; hits: string[]; artistOk: boolean; yearOk: boolean }[] = [];
    for (const g of cands.slice(0, 2)) {
      const credits = g["artist-credit"] ?? [];
      const artistOk = a.mbid ? credits.some((c) => c.artist?.id === a.mbid) : credits.some((c) => names.has(mnorm(c.artist?.name)) || names.has(mnorm(c.name)));
      const releases = await releasesOfRg(b, g.id);
      const years = new Set([(g["first-release-date"] ?? "").slice(0, 4), ...releases.map((r) => (r.date ?? "").slice(0, 4))].filter(Boolean));
      const yearOk = hasYear && years.has(w.year);
      const hits: string[] = [];
      const bc = releases.map((r) => cleanBarcode(r.barcode)).find((x) => x && myBarcodes.has(x));
      if (bc) hits.push(`條碼 ${bc}`);
      if (myTracks.length) {
        const mine = new Set(myTracks.map((l) => mnorm(l.replace(/^\s*\S+\s*[.．、]\s*/, "").replace(/\s*[(（]\d+:\d{2}[)）]\s*$/, ""))));
        const best = Math.max(0, ...releases.map((r) => {
          const theirs = (r.media ?? []).flatMap((m) => (m.tracks ?? []).map((x) => mnorm(x.title)));
          return theirs.length ? theirs.filter((x) => mine.has(x)).length / Math.max(theirs.length, mine.size) : 0;
        }));
        if (best >= 0.8) hits.push("曲目");
      }
      scored.push({ rg: g, releases, hits, artistOk, yearOk });
      const phys = physicalOfficial(releases).length;
      candidates.push({
        label: `《${g.title}》${g["first-release-date"] ?? ""}${g["primary-type"] ? ` ${g["primary-type"]}` : ""}`,
        url: mbUrl("release-group", g.id),
        note: [artistOk ? "藝人相符" : "藝人對不上", hasYear ? (yearOk ? "年份相符" : "年份不同") : "沒填年份", `實體版本 ${phys} 個`, ...hits].join("｜"),
        mbid: g.id,
      });
    }
    const byBarcode = scored.filter((s) => s.hits.some((h) => h.startsWith("條碼")));
    const full = scored.filter((s) => s.artistOk && (s.yearOk || s.hits.includes("曲目")));
    if (byBarcode.length === 1) pick = { ...byBarcode[0], why: `條碼吻合（${byBarcode[0].hits[0].slice(3)}）` };
    else if (full.length === 1 && scored.filter((s) => s.artistOk).length === 1)
      pick = { ...full[0], why: `藝人、標題${full[0].yearOk ? `、年份 ${w.year}` : ""}${full[0].hits.includes("曲目") ? "、曲目" : ""}吻合，只有一個候選` };
    else if (!cands.length) summary = "未查到：MusicBrainz 沒有這位藝人的同名作品";
    else if (full.length > 1) summary = "MusicBrainz 有多個同名作品都對得上，無法確定";
    else if (!hasYear) summary = "MusicBrainz 有同名作品，但系列沒填年份，無法交叉比對";
    else summary = "MusicBrainz 有同名作品，但藝人或年份對不上";
    if (!pick && !cands.length) return { confidence: "none", result: empty(summary) };
  }
  if (!pick) return { confidence: "low", result: { summary, fields: [], sources: [], candidates } };

  const rg = pick.rg;
  const sources: AfSource[] = [{ label: `MusicBrainz：《${rg.title}》`, url: mbUrl("release-group", rg.id) }];
  const dupRow = await db().prepare(`${SERIES_SQL} WHERE mbid = ?1 AND id <> ?2 AND deleted_at IS NULL LIMIT 1`).bind(rg.id, w.id).first<SeriesRow>();
  if (dupRow)
    return {
      confidence: "dup",
      result: { summary: `跟站上既有的《${dupRow.title}》是同一張（MusicBrainz 代碼相同），建議改掛過去`, fields: [], sources, candidates: [], dup: { into: `${dupRow.artistSlug}/${dupRow.no}`, label: `《${dupRow.title}》${dupRow.year}`, url: `/artist/${dupRow.artistSlug}/${dupRow.no}` } },
    };

  const applied: AfApplied = {};
  const fields: AfResult["fields"] = [];
  const set: Record<string, string | null> = {};
  const before: Record<string, string | null> = {};
  if (!w.mbid) {
    before.mbid = null;
    set.mbid = rg.id;
    fields.push({ label: "MusicBrainz 代碼", value: rg.id });
  }
  const y = (rg["first-release-date"] ?? "").slice(0, 4);
  let year = w.year;
  if (!hasYear && /^\d{4}$/.test(y)) {
    before.year = w.year;
    set.year = year = y;
    fields.push({ label: "年份", value: y });
  }
  const mk = SERIES_KIND[rg["primary-type"] ?? ""];
  let seriesType = w.seriesType;
  if (w.kind === "album" && mk && mk !== "album") {
    before.kind = w.kind;
    set.kind = mk;
    before.series_type = w.seriesType;
    set.series_type = seriesType = SERIES_TYPE[mk];
    fields.push({ label: "類型", value: mk === "ep" ? "EP" : "單曲" });
  }
  if (set.year || set.series_type) {
    before.name = w.name;
    set.name = `${year}《${w.title}》${seriesType}`;
  }
  if (Object.keys(set).length) {
    const cols = Object.keys(set);
    await db()
      .prepare(`UPDATE series SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(", ")}, updated_at = ?${cols.length + 2} WHERE id = ?1`)
      .bind(w.id, ...cols.map((c) => set[c]), nowIso())
      .run();
    applied.series = { id: w.id, before, set };
  }
  const sync = await syncVersions(w.id, rg, pick.releases, applied);
  fields.push(...sync.fields);
  const extra: AfCandidate[] = [...sync.candidates];
  const digital = pick.releases.filter((r) => (r.media ?? []).length && (r.media ?? []).every((m) => isDigital(m.format)));
  if (!physicalOfficial(pick.releases).length && digital.length) {
    fields.push({ label: "版本", value: "MusicBrainz 只有數位版，實體版本沒建（曲目可參考下方連結，不自動填進實體版）" });
    for (const r of digital.slice(0, 2)) extra.push({ label: `數位版《${r.title}》${r.date ?? ""}`, url: mbUrl("release", r.id), note: `曲目 ${(r.media ?? []).reduce((n, m) => n + (m.tracks?.length ?? 0), 0)} 首` });
  }
  // 系列對上了，藝人那邊沒定案的工作可以用這個重查；等著的版本工作也叫醒
  await requeueRef("artist", w.artistSlug);
  await db()
    .prepare(
      `UPDATE autofill_jobs SET next_at = ?2 WHERE type = 'version' AND status = 'queued' AND ref IN
       (SELECT CAST(v.id AS TEXT) FROM versions v JOIN items i ON i.id = v.item_ref WHERE i.series_id = ?1)`,
    )
    .bind(w.id, nowIso())
    .run();
  return { confidence: "high", result: { summary: `高信心：${pick.why}`, fields, sources, candidates: extra }, applied };
}

/**
 * 把一個 release-group 的實體正式發行對到系列的版本：
 * - 已經有這個 release MBID 的版本 → 跳過
 * - 同品項、條碼相同的既有版本 → 補空白欄位
 * - 同品項還有會員建的、沒對上 MusicBrainz 的版本 → 不建（避免重複），列成候選，等版本工作比對完再建
 * - 其他 → 建新版本（source＝musicbrainz、資料狀態待確認、created_by 空白不計分）
 */
async function syncVersions(seriesId: number, rg: MbRg, releases: MbRelease[], applied: AfApplied, skip = new Set<string>()) {
  const fields: AfResult["fields"] = [];
  const candidates: AfCandidate[] = [];
  const phys = physicalOfficial(releases).filter((r) => !skip.has(r.id));
  if (!phys.length) return { fields, candidates };
  const used = new Set<string>();
  for (let i = 0; i < phys.length; i += 90) {
    const ids = phys.slice(i, i + 90).map((r) => r.id);
    const rows = await db().prepare(`SELECT mbid FROM versions WHERE deleted_at IS NULL AND mbid IN (${ids.map((_, k) => `?${k + 1}`).join(",")})`).bind(...ids).all<{ mbid: string }>();
    rows.results.forEach((r) => used.add(r.mbid));
  }
  type It = { id: number; itemId: string; kind: string };
  const items = (await db().prepare(`SELECT id, item_id AS itemId, kind FROM items WHERE series_id = ?1 AND deleted_at IS NULL AND status = 'approved'`).bind(seriesId).all<It>()).results;
  type V = { id: number; itemRef: number; versionId: string; edition: string; mbid: string | null; barcode: string } & Record<string, string | number | null>;
  const loadVersions = async (itemRef: number) =>
    (
      await db()
        .prepare(
          `SELECT id, item_ref AS itemRef, version_id AS versionId, edition, mbid, year, release_date, region, label, catalog, barcode, packaging, contents, tracks, track_list, deleted_at AS deletedAt FROM versions WHERE item_ref = ?1`,
        )
        .bind(itemRef)
        .all<V>()
    ).results;
  const rgYear = (rg["first-release-date"] ?? "").slice(0, 4);
  const firstByRegion = new Set<string>();
  let created = 0;
  let filled = 0;
  const sorted = [...phys].sort((x, y) => (x.date || "9999").localeCompare(y.date || "9999"));
  for (const r of sorted) {
    const f = releaseFields(r)!;
    const region = f.fields.region;
    if (used.has(r.id)) continue;
    let it = items.find((x) => x.kind === f.item.kind);
    const vs = it ? (await loadVersions(it.id)).filter((v) => !v.deletedAt) : [];
    const bc = f.fields.barcode;
    const sameBc = bc ? vs.find((v) => !v.mbid && cleanBarcode(v.barcode) === bc) : undefined;
    if (sameBc) {
      if (await fillVersion(sameBc, r.id, f.fields, applied)) filled++;
      used.add(r.id);
      continue;
    }
    if (vs.some((v) => !v.mbid)) {
      candidates.push({ label: `${f.item.kind} ${[f.fields.year, region, f.media].filter(Boolean).join(" ")}${bc ? ` 條碼 ${bc}` : ""}`, url: mbUrl("release", r.id), note: "同品項有會員建的版本還沒對上，這筆先不建", mbid: r.id });
      continue;
    }
    if (created >= 12) {
      candidates.push({ label: `${f.item.kind} ${[f.fields.year, region, f.media].filter(Boolean).join(" ")}`, url: mbUrl("release", r.id), note: "一次最多自動建 12 個版本，這筆沒建", mbid: r.id });
      continue;
    }
    if (!it) {
      const existing = (await db().prepare(`SELECT item_id AS itemId FROM items WHERE series_id = ?1`).bind(seriesId).all<{ itemId: string }>()).results;
      let itemId = f.item.id;
      for (let k = 2; existing.some((x) => x.itemId === itemId); k++) itemId = `${f.item.id}${k}`;
      const ins = await db()
        .prepare(`INSERT INTO items (series_id, item_id, kind, sort, status, source) VALUES (?1, ?2, ?3, ?4, 'approved', 'musicbrainz') RETURNING id`)
        .bind(seriesId, itemId, f.item.kind, f.item.sort)
        .first<{ id: number }>();
      it = { id: ins!.id, itemId, kind: f.item.kind };
      items.push(it);
      (applied.createdItems ??= []).push(ins!.id);
    }
    // 版本名稱：年份＋地區＋首版／再版＋媒體組成（跟匯入腳本同一套）
    const y = f.fields.year;
    let tag = "";
    if (y && rgYear && y > rgYear) tag = "再版";
    else if (y && y === rgYear && !firstByRegion.has(region)) {
      firstByRegion.add(region);
      tag = "首版";
    }
    let ed = [y, `${region}${tag}`, f.media].filter(Boolean).join(" ");
    const extra = r.disambiguation || (mnorm(r.title) !== mnorm(rg.title) ? r.title : "");
    if (extra) ed += `（${extra}）`;
    const editions = new Set(vs.map((v) => v.edition));
    for (let k = 2; editions.has(ed); k++) ed = ed.replace(/（\d+）$/, "") + `（${k}）`;
    const top = (await loadVersions(it.id)).reduce((n, v) => Math.max(n, Number(String(v.versionId).replace(/^v/, "")) || 0), 0);
    const ins = await db()
      .prepare(
        `INSERT INTO versions (item_ref, version_id, edition, year, region, label, catalog, barcode, packaging, contents, tracks, identify_by, data_status, sort, status, mbid, source, release_date, track_list)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', '待確認', ?12, 'approved', ?13, 'musicbrainz', ?14, ?15
         WHERE NOT EXISTS (SELECT 1 FROM versions WHERE mbid = ?13 AND deleted_at IS NULL) RETURNING id`,
      )
      .bind(
        it.id,
        `v${top + 1}`,
        ed,
        y,
        region,
        f.fields.label,
        f.fields.catalog || "待查證",
        f.fields.barcode || "無條碼",
        f.fields.packaging,
        f.fields.contents,
        f.fields.tracks,
        vs.length + created,
        r.id,
        f.fields.release_date,
        f.fields.track_list || "[]",
      )
      .first<{ id: number }>();
    if (ins) {
      (applied.createdVersions ??= []).push(ins.id);
      created++;
      used.add(r.id);
    }
  }
  if (created) fields.push({ label: "新增版本", value: `${created} 個（MusicBrainz 實體發行，含曲目）` });
  if (filled) fields.push({ label: "補齊既有版本", value: `${filled} 個（條碼相同）` });
  return { fields, candidates };
}

const VERSION_COLS = ["year", "release_date", "region", "label", "catalog", "barcode", "packaging", "contents", "tracks", "track_list"] as const;

/** 補一個既有版本的空白欄位（不蓋會員填的值）；曲目有維基式編輯紀錄的不碰 */
async function fillVersion(v: Record<string, unknown> & { id: number; mbid: string | null }, releaseId: string, fill: VersionFill, applied: AfApplied) {
  const set: Record<string, string | null> = {};
  const before: Record<string, string | null> = {};
  const rev = await db()
    .prepare(
      `SELECT 1 AS x FROM revisions WHERE field = 'tracks' AND target = (SELECT 'tracks:' || w.artist_slug || '/' || w.no || '#' || i.item_id || '-' || v.version_id
         FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = ?1) LIMIT 1`,
    )
    .bind(v.id)
    .first();
  for (const c of VERSION_COLS) {
    const cur = String(v[c] ?? "");
    const val = fill[c];
    if (!val || !BLANK[c](cur)) continue;
    if (c === "track_list" && rev) continue;
    before[c] = cur;
    set[c] = val;
  }
  if (!v.mbid) {
    const taken = await db().prepare(`SELECT 1 AS x FROM versions WHERE mbid = ?1 AND deleted_at IS NULL`).bind(releaseId).first();
    if (!taken) {
      before.mbid = null;
      set.mbid = releaseId;
    }
  }
  if (!Object.keys(set).length) return false;
  const cols = Object.keys(set);
  await db()
    .prepare(`UPDATE versions SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(", ")} WHERE id = ?1`)
    .bind(v.id, ...cols.map((c) => set[c]))
    .run();
  (applied.versions ??= []).push({ id: v.id, before, set });
  return true;
}

/* =====================================================================
 * 版本
 * ===================================================================== */

type Owner = { id: number; key: string; itemRef: number; auto: boolean };
/** 某個 release MBID 目前掛在站上哪個版本；auto＝自動補資料剛建、沒人用（source musicbrainz、沒有建立者、沒有收藏） */
async function ownerOf(releaseId: string, exceptId: number): Promise<Owner | null> {
  const r = await db()
    .prepare(
      `SELECT v.id, v.item_ref AS itemRef, v.source, v.created_by AS createdBy, w.artist_slug || '/' || w.no AS sk, i.item_id AS itemId, v.version_id AS vid
       FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id
       WHERE v.mbid = ?1 AND v.id <> ?2 AND v.deleted_at IS NULL LIMIT 1`,
    )
    .bind(releaseId, exceptId)
    .first<{ id: number; itemRef: number; source: string | null; createdBy: string | null; sk: string; itemId: string; vid: string }>();
  if (!r) return null;
  const used = await db().prepare(`SELECT COUNT(*) AS n FROM shares WHERE series_key = ?1 AND item_id = ?2 AND version_id = ?3 AND deleted_at IS NULL`).bind(r.sk, r.itemId, r.vid).first<{ n: number }>();
  const auto = r.source === "musicbrainz" && !r.createdBy && !used?.n && Boolean(await db().prepare(`SELECT 1 AS x FROM autofill_jobs, json_each(autofill_jobs.applied, '$.createdVersions') je WHERE je.value = ?1 LIMIT 1`).bind(r.id).first());
  return { id: r.id, itemRef: r.itemRef, key: `${r.sk}#${r.itemId}-${r.vid}`, auto };
}

async function doVersion(b: Budget, job: Job): Promise<Outcome> {
  const v = await db()
    .prepare(
      `SELECT v.id, v.item_ref AS itemRef, v.version_id AS versionId, v.edition, v.mbid, v.year, v.release_date, v.region, v.label, v.catalog, v.barcode, v.packaging, v.contents, v.tracks, v.track_list,
              v.deleted_at AS deletedAt, i.kind AS itemKind, w.id AS seriesId, w.title AS seriesTitle, w.year AS seriesYear, w.mbid AS seriesMbid, w.artist_slug AS artistSlug
       FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = ?1`,
    )
    .bind(Number(job.ref))
    .first<Record<string, string | number | null> & { id: number; itemRef: number; mbid: string | null; deletedAt: string | null; itemKind: string; seriesId: number; seriesTitle: string; seriesMbid: string | null; year: string; region: string; barcode: string; edition: string }>();
  if (!v || v.deletedAt) return { confidence: "none", result: empty("這個版本已經不在了") };
  if (!["CD", "黑膠", "卡帶", "藍光／DVD"].includes(v.itemKind)) return { confidence: "none", result: empty(`${v.itemKind}不在 MusicBrainz 收錄範圍，沒查`) };
  if (v.mbid && !job.hint)
    return {
      confidence: "high",
      result: { summary: "高信心：查系列時已經用條碼對上這一版並補齊（預填內容記在系列那筆，駁回請到系列那筆）", fields: [{ label: "MusicBrainz 代碼", value: v.mbid }], sources: [{ label: "MusicBrainz 發行", url: mbUrl("release", v.mbid) }], candidates: [] },
    };
  const hintBc = job.hint && /^\d{8,14}$/.test(job.hint) ? job.hint : "";
  const hintId = job.hint && UUID.test(job.hint) ? job.hint.toLowerCase() : "";
  const bc = hintBc || cleanBarcode(v.barcode);
  const applied: AfApplied = {};
  const candidates: AfCandidate[] = [];
  const kindOk = (r: MbRelease) => releaseFields(r)?.item.kind === v.itemKind;
  const L: Record<string, string> = { mbid: "MusicBrainz 代碼", year: "年份", release_date: "發行日", region: "地區", label: "發行", catalog: "目錄號", barcode: "條碼", packaging: "包裝", contents: "內容物", tracks: "曲目數", track_list: "曲目" };
  const dupOut = (o: Owner, why: string, r: MbRelease): Outcome => ({
    confidence: "dup",
    result: { summary: `${why}；站上已經有這一版（${o.key}），建議改掛過去`, fields: [], sources: [{ label: `MusicBrainz：${r.title}`, url: mbUrl("release", r.id) }], candidates: [], dup: { into: o.key, label: o.key, url: `/artist/${o.key.replace(/#.*/, "")}#${o.key.split("#")[1]}` } },
  });

  const finish = async (r: MbRelease, why: string): Promise<Outcome> => {
    const f = releaseFields(r);
    if (!f) return { confidence: "low", result: { summary: "對到的 MusicBrainz 發行不是實體版", fields: [], sources: [], candidates: [{ label: r.title, url: mbUrl("release", r.id) }] } };
    const fields: AfResult["fields"] = [];
    const o = await ownerOf(r.id, v.id);
    if (o && !o.auto) {
      if (o.itemRef === v.itemRef) return dupOut(o, why, r);
      return { confidence: "low", result: { summary: `${why}，但這個發行已經掛在站上另一個品項的版本（${o.key}），請人工看`, fields: [], sources: [], candidates: [{ label: r.title, url: mbUrl("release", r.id), mbid: r.id }] } };
    }
    if (o?.auto) {
      // 自動補資料剛替這張建的同一版（會員新增版本時表單還看不到）：收掉那筆，資料補進會員這筆
      await db().prepare(`UPDATE versions SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`).bind(o.id, nowIso()).run();
      (applied.absorbed ??= []).push(o.id);
      fields.push({ label: "合併", value: `自動建的 ${o.key} 跟這筆是同一版，已收掉` });
    }
    const ok = await fillVersion(v, r.id, f.fields, applied);
    const got = applied.versions?.[0]?.set ?? {};
    for (const [k, val] of Object.entries(got)) if (!(k === "tracks" && got.track_list)) fields.push({ label: L[k] ?? k, value: k === "track_list" ? `${J<string[]>(val, []).filter((x) => !x.startsWith("【")).length} 首` : String(val) });
    if (!ok) fields.push({ label: "預填", value: "欄位都已經有值，沒有要補的" });
    // 系列還沒有 MBID：這個 release 所屬的 release-group 標題跟系列相同才寫
    const rg = r["release-group"];
    if (rg && !v.seriesMbid && (mnorm(rg.title) === mnorm(v.seriesTitle) || mnorm(r.title) === mnorm(v.seriesTitle))) {
      const other = await db().prepare(`SELECT 1 AS x FROM series WHERE mbid = ?1 AND deleted_at IS NULL`).bind(rg.id).first();
      if (!other) {
        await db().prepare(`UPDATE series SET mbid = ?2, updated_at = ?3 WHERE id = ?1 AND mbid IS NULL`).bind(v.seriesId, rg.id, nowIso()).run();
        applied.series = { id: v.seriesId, before: { mbid: null }, set: { mbid: rg.id } };
        fields.push({ label: "系列 MusicBrainz 代碼", value: rg.id });
      }
    }
    // 對上了：同一張的其他實體版本這時才建（先前為了避免重複沒建）
    const rgId = applied.series?.set.mbid ?? v.seriesMbid;
    if (rgId) {
      const all = await releasesOfRg(b, rgId);
      const sync = await syncVersions(v.seriesId, rg && rg.id === rgId ? rg : { id: rgId, title: v.seriesTitle }, all, applied, new Set([r.id]));
      fields.push(...sync.fields);
    }
    return {
      confidence: "high",
      result: { summary: `高信心：${why}`, fields, sources: [{ label: `MusicBrainz：${r.title}${r.date ? ` ${r.date}` : ""}${r.country ? ` ${r.country}` : ""}`, url: mbUrl("release", r.id) }], candidates: [] },
      applied,
    };
  };
  const full = (id: string) => mb<MbRelease>(b, `release/${id}?inc=${encodeURIComponent("media+recordings+labels+release-groups+artist-credits")}`);

  if (hintId) {
    const r = await full(hintId);
    if (!r) return { confidence: "low", result: { summary: `MusicBrainz 找不到 ${hintId}`, fields: [], sources: [], candidates } };
    return finish(r, "管理員指定");
  }

  if (bc) {
    const res = await mb<{ releases?: MbRelease[] }>(b, `release?query=${encodeURIComponent(`barcode:${bc}`)}&limit=10`);
    const hits = (res?.releases ?? []).filter((r) => cleanBarcode(r.barcode) === bc);
    const titleOk = (r: MbRelease) =>
      (v.seriesMbid && r["release-group"]?.id === v.seriesMbid) || mnorm(r["release-group"]?.title) === mnorm(v.seriesTitle) || mnorm(r.title) === mnorm(v.seriesTitle);
    const good = hits.filter(titleOk);
    for (const r of hits)
      candidates.push({ label: `${r.title} ${r.date ?? ""} ${r.country ?? ""}`.trim(), url: mbUrl("release", r.id), note: titleOk(r) ? "條碼、標題相符" : "條碼相符，但標題跟系列不同", mbid: r.id });
    const one = good.length === 1 ? good[0] : good.filter(kindOk).length === 1 && new Set(good.map((r) => r["release-group"]?.id)).size === 1 ? good.filter(kindOk)[0] : null;
    if (one) {
      const r = await full(one.id);
      if (r) return finish(r, `條碼 ${bc} 吻合`);
    }
    if (hits.length && !good.length) return { confidence: "low", result: { summary: `條碼 ${bc} 在 MusicBrainz 對到的是別的標題，請人工看`, fields: [], sources: [], candidates } };
    if (good.length > 1) return { confidence: "low", result: { summary: `條碼 ${bc} 對到多筆發行，無法確定`, fields: [], sources: [], candidates } };
  }

  if (!v.seriesMbid) {
    // 系列還在查：等它（最多 40 分鐘）
    const pending = await db()
      .prepare(`SELECT 1 AS x FROM autofill_jobs WHERE type = 'series' AND ref = ?1 AND status = 'queued'`)
      .bind(String(v.seriesId))
      .first();
    if (pending && Date.now() - Date.parse(job.createdAt) < 40 * 60_000) return { confidence: "low", result: empty("等系列查完"), defer: 60 };
    return {
      confidence: bc && !candidates.length ? "none" : "low",
      result: {
        summary: bc ? `${candidates.length ? "條碼有對到但無法確定" : `未查到：條碼 ${bc} 不在 MusicBrainz`}，系列也沒對上` : "系列沒對上 MusicBrainz，版本無從比對（有條碼可以按「重查」填條碼）",
        fields: [],
        sources: [],
        candidates,
      },
    };
  }

  const all = await releasesOfRg(b, v.seriesMbid);
  const physAll = physicalOfficial(all).filter(kindOk);
  const owners = new Map<string, Owner | null>();
  for (const r of physAll) owners.set(r.id, await ownerOf(r.id, v.id));
  const hasYear = /^\d{4}$/.test(v.year);
  const code = regionCode(v.region) || regionCode(v.edition);
  let pool = physAll;
  if (hasYear) pool = pool.filter((r) => (r.date ?? "").startsWith(v.year));
  if (code) pool = pool.filter((r) => r.country === code);
  for (const r of physAll) {
    const o = owners.get(r.id);
    candidates.push({
      label: `${v.itemKind} ${[r.date, r.country].filter(Boolean).join(" ")}${cleanBarcode(r.barcode) ? ` 條碼 ${cleanBarcode(r.barcode)}` : ""}`,
      url: mbUrl("release", r.id),
      note: [pool.includes(r) ? "年份、地區相符" : "年份或地區不同", o ? `站上是 ${o.key}` : "站上還沒有"].join("｜"),
      mbid: r.id,
    });
  }
  if (pool.length === 1 && hasYear) {
    const r = await full(pool[0].id);
    if (r) return finish(r, `系列、格式、年份 ${v.year}${code ? `、地區 ${code}` : ""} 吻合，只有一個候選`);
  }
  if (pool.length === 1 && !hasYear) {
    // 只有一個同格式的實體版、但會員沒填年份：不預填；站上已經有那一版就建議改掛
    const o = owners.get(pool[0].id);
    if (o && o.itemRef === v.itemRef)
      return { ...dupOut(o, `這張只有一個${v.itemKind}版，但版本沒填年份`, pool[0]), confidence: "dup" };
  }
  if (!physicalOfficial(all).length) {
    const digital = all.filter((r) => (r.media ?? []).length && (r.media ?? []).every((m) => isDigital(m.format)));
    return {
      confidence: digital.length ? "low" : "none",
      result: {
        summary: digital.length ? "MusicBrainz 只有數位版，沒有實體版可比對；曲目可參考連結，不自動填進實體版" : "未查到：MusicBrainz 這張沒有任何發行",
        fields: [],
        sources: [],
        candidates: digital.slice(0, 2).map((r) => ({ label: `數位版《${r.title}》${r.date ?? ""}`, url: mbUrl("release", r.id), note: `曲目 ${(r.media ?? []).reduce((n, m) => n + (m.tracks?.length ?? 0), 0)} 首` })),
      },
    };
  }
  if (!physAll.length) return { confidence: "none", result: { summary: `未查到：MusicBrainz 這張沒有${v.itemKind}版`, fields: [], sources: [], candidates } };
  return {
    confidence: "low",
    result: { summary: pool.length > 1 ? `同格式有 ${pool.length} 個候選，無法確定是哪一版` : hasYear || code ? "年份或地區都對不上" : "版本沒填年份，無法確定是哪一版", fields: [], sources: [], candidates },
  };
}

/* =====================================================================
 * 還原（駁回、重查前）
 * ===================================================================== */

async function restore(table: "artists" | "series" | "versions", keyCol: string, key: string | number, c: Change) {
  for (const [col, val] of Object.entries(c.set)) {
    // 只還原「現在還是我們填的值」的欄位：之後有人手動改過就不動
    await db()
      .prepare(`UPDATE ${table} SET ${col} = ?1 WHERE ${keyCol} = ?2 AND ${col} IS ?3`)
      .bind(c.before[col] ?? null, key, val)
      .run();
  }
}

export async function undoApplied(a: AfApplied) {
  const notes: string[] = [];
  if (a.artist) await restore("artists", "slug", a.artist.slug, a.artist);
  if (a.series) await restore("series", "id", a.series.id, a.series);
  for (const v of a.versions ?? []) await restore("versions", "id", v.id, v);
  for (const id of a.createdVersions ?? []) {
    const r = await db()
      .prepare(
        `SELECT w.artist_slug || '/' || w.no AS sk, i.item_id AS itemId, v.version_id AS vid FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE v.id = ?1`,
      )
      .bind(id)
      .first<{ sk: string; itemId: string; vid: string }>();
    if (!r) continue;
    const used = await db().prepare(`SELECT COUNT(*) AS n FROM shares WHERE series_key = ?1 AND item_id = ?2 AND version_id = ?3 AND deleted_at IS NULL`).bind(r.sk, r.itemId, r.vid).first<{ n: number }>();
    if (used?.n) {
      notes.push(`版本 ${r.sk}#${r.itemId}-${r.vid} 已有 ${used.n} 則收藏在用，沒刪`);
      continue;
    }
    await db().prepare(`UPDATE versions SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`).bind(id, nowIso()).run();
  }
  for (const id of a.absorbed ?? []) await db().prepare(`UPDATE versions SET deleted_at = NULL WHERE id = ?1`).bind(id).run();
  for (const id of a.createdItems ?? []) {
    const left = await db().prepare(`SELECT COUNT(*) AS n FROM versions WHERE item_ref = ?1 AND deleted_at IS NULL`).bind(id).first<{ n: number }>();
    if (!left?.n) await db().prepare(`UPDATE items SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`).bind(id, nowIso()).run();
  }
  return notes;
}

/* =====================================================================
 * 後台
 * ===================================================================== */

export type AdminAutofill = { status: string; confidence: string | null; decision: string | null; result: AfResult; hint: string | null; updatedAt: string };

export async function autofillFor(additionIds: number[]) {
  const out = new Map<number, AdminAutofill>();
  for (let i = 0; i < additionIds.length; i += 90) {
    const ids = additionIds.slice(i, i + 90);
    if (!ids.length) continue;
    const rows = await db()
      .prepare(`SELECT addition_id AS a, status, confidence, decision, result, hint, updated_at AS u FROM autofill_jobs WHERE addition_id IN (${ids.map((_, k) => `?${k + 1}`).join(",")})`)
      .bind(...ids)
      .all<{ a: number; status: string; confidence: string | null; decision: string | null; result: string; hint: string | null; u: string }>();
    for (const r of rows.results) out.set(r.a, { status: r.status, confidence: r.confidence, decision: r.decision, result: J<AfResult>(r.result, empty("")), hint: r.hint, updatedAt: r.u });
  }
  // 後台打開時順手把到期的工作跑掉（例如 waitUntil 沒跑完的）
  const due = await db().prepare(`SELECT 1 AS x FROM autofill_jobs WHERE status = 'queued' AND next_at <= ?1 LIMIT 1`).bind(nowIso()).first();
  if (due) kickAutofill();
  return out;
}

async function jobOf(additionId: number) {
  return db()
    .prepare(`SELECT id, confidence, decision, result, applied FROM autofill_jobs WHERE addition_id = ?1`)
    .bind(additionId)
    .first<{ id: number; confidence: string | null; decision: string | null; result: string; applied: string }>();
}

export async function markDecision(additionId: number, decision: "approved" | "rejected" | null) {
  await db().prepare(`UPDATE autofill_jobs SET decision = ?2, updated_at = ?3 WHERE addition_id = ?1`).bind(additionId, decision, nowIso()).run();
}

/** 核准要做什麼：重複的回傳要改掛到哪裡，其他回 null（照一般確認） */
export async function approvalTarget(additionId: number) {
  const j = await jobOf(additionId);
  if (!j || j.confidence !== "dup" || j.decision) return null;
  return J<AfResult>(j.result, empty("")).dup?.into ?? null;
}

/** 駁回預填：還原這次填的欄位、刪掉這次建的版本（已有收藏在用的保留） */
export async function rejectAutofill(additionId: number) {
  const j = await jobOf(additionId);
  if (!j) return { notes: ["這筆沒有自動補資料的紀錄"] };
  const notes = await undoApplied(J<AfApplied>(j.applied, {}));
  await db().prepare(`UPDATE autofill_jobs SET decision = 'rejected', applied = '{}', updated_at = ?2 WHERE id = ?1`).bind(j.id, nowIso()).run();
  return { notes };
}

/** 重查：hint＝管理員指定的 MBID 或條碼（可空白）。先還原上次預填，再排進佇列馬上跑 */
export async function recheckAutofill(additionId: number, type: string, ref: string, rawHint: unknown) {
  const hint = typeof rawHint === "string" ? rawHint.trim().replace(/^https?:\/\/musicbrainz\.org\/[a-z-]+\//, "").slice(0, 60) : "";
  const clean = UUID.test(hint) ? hint.toLowerCase() : cleanBarcode(hint);
  await db()
    .prepare(
      `INSERT INTO autofill_jobs (addition_id, type, ref, hint) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(addition_id) DO UPDATE SET status = 'queued', confidence = NULL, decision = NULL, hint = excluded.hint, tries = 0, next_at = ?5, updated_at = ?5`,
    )
    .bind(additionId, type, ref, clean || null, nowIso())
    .run();
  kickAutofill();
  return { hint: clean };
}
