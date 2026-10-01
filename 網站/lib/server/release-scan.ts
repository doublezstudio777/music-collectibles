// 每月自動補新作品（2026-10-01，自動補資料第 2 層）。
//
// 每月一次：對站上已有 MusicBrainz 代碼（artists.mbid）的藝人，到 MusicBrainz 看他的作品清單（release-group），
// 找出「站上還沒有、而且是最近一年內發行」的專輯／EP／單曲，建成系列，再交給發布時自動補資料（lib/server/autofill.ts）
// 用同一套規則建版本（實體正式發行才建、帶曲目、資料狀態待確認）。
//
// 信心分級（照自動補資料，有疑義就不建）：
//   高：藝人用 MBID 查作品清單（不是用名字搜，作品一定是這位藝人的）＋站上沒有同 MBID 的系列（含已刪除的，刪過的不會被補回來）
//       ＋這位藝人底下沒有同名的系列＋MusicBrainz 有實體正式發行 → 建系列（立即上站），進後台「待確認的新增」
//   疑義：這位藝人已經有同名（或互相包含）的系列、只是還沒有 MBID → 不建，列在後台「每月補新作品」的疑義清單，人工判斷要不要合併
//   略過：只有數位發行（跟 9/28、9/30 匯入規則一樣不收）、非正式發行、類型不是專輯／EP／單曲、沒有發行日期、超過一年
// 「最近一年」：第一次發行日期在掃描當天往前 365 天內。只有數位的作品之後補上實體版，在一年內的每次掃描都會再看一次。
//
// 分批：每月第一次每日排程（台灣 02:00）開一輪，實際查詢由 `*/10 * * * *` 排程接手，跟自動補資料共用一把鎖與
// MusicBrainz 每秒 1 次的計時（autofill_state 的 lock／mb_last）；每次執行最多 45 次對外連線、2 分鐘，查不完下一次接著查。
// 一位藝人約 1～3 次查詢，128 位藝人大約 4～6 次排程（40～60 分鐘）跑完。
// 狀態（進度、統計、建了哪些、疑義清單）存 autofill_state 的 release_scan，後台看得到，不用新表。

import { env } from "cloudflare:workers";
import { mb, mbUrl, mnorm, SERIES_KIND, releaseFields, type Budget, type MbRelease } from "@/lib/server/autofill-mb";

const db = () => env.DB!;
const nowIso = () => new Date().toISOString();
/** 後台「待確認的新增」新增者欄位：系統建的 */
export const SYSTEM_RELEASES = "system:releases";
const WINDOW_DAYS = 365;
const SERIES_TYPE: Record<string, string> = { album: "專輯發行", ep: "EP 發行", single: "單曲發行" };
const LIST_MAX = 300;

export type ScanItem = { artist: string; slug: string; title: string; date: string; rg: string; url: string; note?: string; key?: string };
export type ScanState = {
  month: string;
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt?: string;
  cutoff: string;
  cursor: string;
  total: number;
  stats: { artists: number; calls: number; candidates: number; created: number; doubt: number; digital: number; old: number; other: number };
  created: ScanItem[];
  doubt: ScanItem[];
  digital: ScanItem[];
  errors: string[];
};

/** 台灣時間的年月（每月一輪用） */
const twMonth = (t = Date.now()) => new Date(t + 8 * 3600_000).toISOString().slice(0, 7);

export async function scanState(): Promise<ScanState | null> {
  const r = await db().prepare(`SELECT value FROM autofill_state WHERE key = 'release_scan'`).first<{ value: string }>();
  try {
    return r?.value ? (JSON.parse(r.value) as ScanState) : null;
  } catch {
    return null;
  }
}
async function save(s: ScanState) {
  s.created = s.created.slice(-LIST_MAX);
  s.doubt = s.doubt.slice(-LIST_MAX);
  s.digital = s.digital.slice(-LIST_MAX);
  s.errors = s.errors.slice(-50);
  await db()
    .prepare(`INSERT INTO autofill_state (key, value, updated_at) VALUES ('release_scan', ?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .bind(JSON.stringify(s), nowIso())
    .run();
}

/**
 * 開一輪掃描。排程每天呼叫一次：這個月已經開過就什麼都不做；manual（後台按鈕）強制重開一輪。
 * 回傳是否開了新的一輪
 */
export async function startReleaseScan({ trigger, now = Date.now() }: { trigger: "cron" | "manual"; now?: number }) {
  const cur = await scanState();
  const month = twMonth(now);
  if (trigger === "cron" && cur?.month === month) return false;
  const total = await db().prepare(`SELECT COUNT(*) AS n FROM artists WHERE mbid IS NOT NULL AND deleted_at IS NULL AND status = 'approved'`).first<{ n: number }>();
  await save({
    month,
    trigger,
    startedAt: new Date(now).toISOString(),
    cutoff: new Date(now - WINDOW_DAYS * 86400_000).toISOString().slice(0, 10),
    cursor: "",
    total: total?.n ?? 0,
    stats: { artists: 0, calls: 0, candidates: 0, created: 0, doubt: 0, digital: 0, old: 0, other: 0 },
    created: [],
    doubt: [],
    digital: [],
    errors: [],
  });
  return true;
}

type Rg = { id: string; title: string; "primary-type"?: string | null; "first-release-date"?: string; "artist-credit"?: { artist?: { id: string; name: string } }[] };

/**
 * 查一位藝人（自動補資料的執行迴圈在沒有工作時呼叫）。沒有進行中的掃描或已經查完回 false。
 * MusicBrainz 忙線、額度用完會丟 Busy／OutOfBudget：游標還停在這位藝人前面，下一次從這位重查
 */
export async function releaseScanStep(b: Budget): Promise<boolean> {
  const s = await scanState();
  if (!s || s.finishedAt) return false;
  const a = await db()
    .prepare(`SELECT slug, name, mbid FROM artists WHERE mbid IS NOT NULL AND deleted_at IS NULL AND status = 'approved' AND slug > ?1 ORDER BY slug LIMIT 1`)
    .bind(s.cursor)
    .first<{ slug: string; name: string; mbid: string }>();
  if (!a) {
    s.finishedAt = nowIso();
    await save(s);
    console.log("[每月補新作品] 掃描完成", JSON.stringify(s.stats));
    return false;
  }
  const calls0 = b.calls;
  // 這位藝人的統計先記在這裡，查完才併進總數（中途忙線、額度用完會從這位重查，避免重複計算）；
  // 建好的系列例外：建一個就存一次，重查時同 MBID 已經在站上，不會重建
  const d = { candidates: 0, doubt: 0, digital: 0, old: 0, other: 0 };
  const doubt: ScanItem[] = [];
  const digital: ScanItem[] = [];

  // 1. 作品清單（release-group browse，依藝人 MBID；超過 100 個分頁，最多 3 頁）
  const rgs: Rg[] = [];
  for (let offset = 0; offset < 300; ) {
    const r = await mb<{ "release-groups"?: Rg[]; "release-group-count"?: number }>(b, `release-group?artist=${a.mbid}&type=album|ep|single&limit=100&offset=${offset}`);
    const list = r?.["release-groups"] ?? [];
    rgs.push(...list);
    offset += list.length;
    if (!list.length || offset >= (r?.["release-group-count"] ?? 0)) break;
  }

  // 2. 站上已經有的（同 MBID 的系列，含已刪除的；整站查，共同署名歸在別人名下的也算）
  const ids = rgs.map((g) => g.id);
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const part = ids.slice(i, i + 90);
    const rows = await db().prepare(`SELECT mbid FROM series WHERE mbid IN (${part.map((_, k) => `?${k + 1}`).join(",")})`).bind(...part).all<{ mbid: string }>();
    rows.results.forEach((r) => have.add(r.mbid));
  }
  const mine = (
    await db()
      .prepare(`SELECT artist_slug AS slug, no, title, year, mbid FROM series WHERE deleted_at IS NULL AND kind <> 'misc' AND (artist_slug = ?1 OR EXISTS (SELECT 1 FROM json_each(series.credits) WHERE value = ?1))`)
      .bind(a.slug)
      .all<{ slug: string; no: number; title: string; year: string; mbid: string | null }>()
  ).results;

  for (const g of rgs) {
    if (have.has(g.id)) continue;
    const kind = SERIES_KIND[g["primary-type"] ?? ""];
    const date = g["first-release-date"] ?? "";
    const item: ScanItem = { artist: a.name, slug: a.slug, title: g.title, date, rg: g.id, url: mbUrl("release-group", g.id) };
    if (!kind) {
      d.other++;
      continue;
    }
    if (!/^\d{4}/.test(date) || date < s.cutoff) {
      d.old++;
      continue;
    }
    d.candidates++;
    // 疑義：同名（或互相包含、至少 3 字）的系列還沒有 MBID → 可能是會員建過的同一張，不自動建
    const t = mnorm(g.title);
    const y = date.slice(0, 4);
    const same = mine.find((w) => {
      const n = mnorm(w.title);
      const titleOk = n === t || (Math.min(n.length, t.length) >= 3 && (n.includes(t) || t.includes(n)));
      return titleOk && (!/^\d{4}/.test(w.year) || w.year.slice(0, 4) === y);
    });
    if (same) {
      d.doubt++;
      doubt.push({ ...item, key: `${same.slug}/${same.no}`, note: same.mbid ? `站上《${same.title}》已有別的 MusicBrainz 代碼` : `站上已有《${same.title}》${same.year}（還沒有 MusicBrainz 代碼），可能是同一張` });
      continue;
    }
    // 實體正式發行才建（只有數位的不收）
    const rel = await mb<{ releases?: MbRelease[] }>(b, `release?release-group=${g.id}&inc=media&limit=100`);
    const phys = (rel?.releases ?? []).filter((r) => (!r.status || r.status === "Official") && releaseFields(r));
    if (!phys.length) {
      d.digital++;
      digital.push({ ...item, note: (rel?.releases ?? []).length ? "只有數位或非正式發行" : "MusicBrainz 還沒有任何發行" });
      continue;
    }
    // 3. 建系列（共同署名：MusicBrainz 掛名的其他人站上也有的，一起列進署名）
    const others = (g["artist-credit"] ?? []).map((c) => c.artist?.id).filter((x): x is string => Boolean(x) && x !== a.mbid);
    const co = others.length
      ? (await db().prepare(`SELECT slug FROM artists WHERE deleted_at IS NULL AND mbid IN (${others.map((_, k) => `?${k + 1}`).join(",")})`).bind(...others).all<{ slug: string }>()).results.map((r) => r.slug)
      : [];
    const no = await nextNo(a.slug);
    const ins = await db()
      .prepare(
        `INSERT INTO series (artist_slug, no, title, name, series_type, kind, credits, year, body, guests, compilation, status, mbid, source)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '[]', '[]', '[]', 'approved', ?9, 'musicbrainz'
         WHERE NOT EXISTS (SELECT 1 FROM series WHERE mbid = ?9) RETURNING id`,
      )
      .bind(a.slug, no, g.title, `${y}《${g.title}》${SERIES_TYPE[kind]}`, SERIES_TYPE[kind], kind, JSON.stringify([a.slug, ...co]), y, g.id)
      .first<{ id: number }>();
    if (!ins) continue;
    const add = await db()
      .prepare(`INSERT INTO catalog_additions (type, ref, created_by) VALUES ('series', ?1, ?2) ON CONFLICT DO NOTHING RETURNING id`)
      .bind(String(ins.id), SYSTEM_RELEASES)
      .first<{ id: number }>();
    // 版本交給自動補資料（hint＝monthly：結果摘要寫「每月補新作品」）；同一個執行迴圈接著就會跑到
    if (add) await db().prepare(`INSERT INTO autofill_jobs (addition_id, type, ref, hint) VALUES (?1, 'series', ?2, 'monthly') ON CONFLICT(addition_id) DO NOTHING`).bind(add.id, String(ins.id)).run();
    s.stats.created++;
    s.created.push({ ...item, key: `${a.slug}/${no}`, note: `實體發行 ${phys.length} 個` });
    await save(s);
    mine.push({ slug: a.slug, no, title: g.title, year: y, mbid: g.id });
  }
  s.cursor = a.slug;
  s.stats.artists++;
  s.stats.calls += b.calls - calls0;
  for (const k of Object.keys(d) as (keyof typeof d)[]) s.stats[k] += d[k];
  s.doubt.push(...doubt);
  s.digital.push(...digital);
  await save(s);
  return true;
}

/** 下一個系列流水號（跟 series-link.ts 的 nextSeriesNo 同一套：用過的號不重用） */
async function nextNo(slug: string) {
  const r = await db()
    .prepare(`SELECT MAX(COALESCE((SELECT MAX(no) FROM series WHERE artist_slug = ?1), 0), COALESCE((SELECT value FROM counters WHERE key = 'series_no:' || ?1), 0)) + 1 AS n`)
    .bind(slug)
    .first<{ n: number }>();
  return r?.n ?? 1;
}
