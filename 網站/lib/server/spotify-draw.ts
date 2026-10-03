// Spotify 自動抽歌（2026-09-30）：替每位已對應 Spotify 的藝人，從完整作品裡隨機抽一首給首頁。不看熱門度
// （2026-02 起 Spotify 也拿掉了 Top Tracks 與 popularity）。訪客開首頁不打 Spotify，只讀 D1。
//
// 一位藝人怎麼抽：專輯清單（Get Artist's Albums，album＋single、market=TW、每頁上限 10，分頁抓完）
//   → 隨機挑一張 → 這張的曲目（Get Album）→ 隨機挑一首。一張挑不到換一張，最多試 3 張。
//   跳過：曲名有伴奏／純音樂／Instrumental／Inst／Karaoke、演出者沒有這位藝人、台灣不能播。Live 與 Remix 保留。
//   最近 10 次抽過的歌盡量不重複（那張專輯全都抽過才允許重複）。
//
// 配額（重要）：development mode 的配額按 endpoint 分桶、以開發者帳號計、數字不公開。2026-09-30 實測
//   Get Artist's Albums 約 100 次就回 429＋Retry-After 約 86,000 秒（鎖 24 小時）。所以：
//   - 專輯清單存在 spotify_artists.albums，30 天才更新一次；曲目存在 spotify_albums，抓過就不再抓
//   - 每個桶每天（台灣日期）自訂上限：專輯清單 60 次、專輯曲目 80 次（spotify_state 的 used:桶:日期）
//   - 429：照 Retry-After（至少 60 秒）把那個桶鎖到那時（backoff:桶），其他桶照常；清單桶鎖住時，已有清單的藝人照抽
//   - 當天額度用完時，只從已快取曲目的專輯裡抽（還是隨機，只是範圍暫時小一點）；快取會一天天長大
//
// 排程：wrangler.production.jsonc 的 `*/5 18-20 * * *`（台灣 02:00～04:55 每 5 分鐘一批），一批最多 12 位藝人、
//   打 Spotify 最多 30 次（免費方案每次呼叫對外連線上限 50）。當天抽過的不再抽；抽不到的（沒有額度也沒有快取）隔一班再試。
//   整晚抽完（或最後一班 20:55 UTC）才讓 content_version 加 1 一次，首頁整頁快取換成新的一批。
//
// 金鑰：SPOTIFY_CLIENT_ID／SPOTIFY_CLIENT_SECRET（wrangler secret），Client Credentials 換 token，token 留在記憶體到過期前 1 分鐘。

import { env } from "cloudflare:workers";

/** 曲名排除：伴奏、純音樂、Instrumental（含 Inst. 縮寫）、Karaoke */
export const EXCLUDE_TITLE = /伴奏|純音樂|纯音乐|instrumental|karaoke|\binst\b/i;
const MAX_ARTISTS = 12;
const MAX_CALLS = 30;
const ALBUM_LIST_TTL_DAYS = 30;
const MAX_ALBUM_PAGES = 20;
const RECENT = 10;
/**
 * 每個配額桶每天自己設的上限（實測 Get Artist's Albums 約 100 次被鎖，留一半以上的餘裕）。
 * search：藝人自動比對（2026-10-03，lib/server/spotify-auto.ts）用，只打 search，一位藝人最多約 9 次
 */
export const DAILY_LIMIT = { artist_albums: 60, album: 80, search: 120 } as const;
export type Bucket = keyof typeof DAILY_LIMIT;

export const taiwanDay = (now = Date.now()) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);

export class RateLimited extends Error {
  constructor(
    public bucket: Bucket | "token",
    public retryAfter: number,
  ) {
    super(`Spotify 429（${bucket}），${retryAfter} 秒後再試`);
  }
}
/** 這次呼叫的對外連線用完，或這個桶今天的額度用完／鎖住中 */
export class NoBudget extends Error {}

let cached: { token: string; exp: number } | null = null;

/** 一次執行的額度帳：calls＝這次對外連線數，used／locked＝各桶今天的狀態（開頭從 D1 讀，結尾寫回） */
export type Ledger = { calls: number; max: number; day: string; now: number; used: Record<Bucket, number>; start: Record<Bucket, number>; lockedUntil: Partial<Record<Bucket, string>> };

const canUse = (l: Ledger, b: Bucket) => l.calls < l.max && l.used[b] < DAILY_LIMIT[b] && !(l.lockedUntil[b] && Date.parse(l.lockedUntil[b]!) > l.now);
const retryAfter = (r: Response) => Math.max(60, Number(r.headers.get("retry-after")) || 0);

async function getToken(l: Ledger): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const id = env.SPOTIFY_CLIENT_ID;
  const secret = env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("沒有設定 SPOTIFY_CLIENT_ID／SPOTIFY_CLIENT_SECRET");
  if (l.calls >= l.max) throw new NoBudget();
  l.calls++;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(10_000),
  });
  if (r.status === 429) throw new RateLimited("token", retryAfter(r));
  if (!r.ok) throw new Error(`Spotify 換 token 失敗 ${r.status}`);
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

/** GET Spotify Web API（記在某個桶）；404／400 回 null，429 鎖桶後丟 RateLimited，沒額度丟 NoBudget */
export async function sp<T>(path: string, bucket: Bucket, l: Ledger): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await getToken(l);
    if (!canUse(l, bucket)) throw new NoBudget();
    l.calls++;
    l.used[bucket]++;
    const r = await fetch(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (r.status === 429) {
      const s = retryAfter(r);
      l.lockedUntil[bucket] = new Date(l.now + s * 1000).toISOString();
      throw new RateLimited(bucket, s);
    }
    if (r.status === 401) {
      cached = null;
      continue;
    }
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`Spotify ${r.status}：${path.split("?")[0]}`);
    return (await r.json()) as T;
  }
  throw new Error("Spotify 401（token 無效）");
}

type AlbumPage = { items: { id: string }[]; next: string | null };
type AlbumResp = { id: string; name: string; tracks: { items: { id: string; name: string; is_playable?: boolean; artists: { id: string }[] }[] } };
type CachedAlbum = { name: string; tracks: { i: string; n: string; a: string[] }[] };
type ArtistRow = { artist_slug: string; spotify_id: string; albums: string | null; albums_at: string | null };
export type Picked = { trackId: string; title: string; albumId: string; albumName: string };

/** 專輯清單：有且未滿 30 天用 D1 的；過期時有額度才重抓，沒額度沿用舊的；完全沒有又沒額度回 null */
async function albumList(a: ArtistRow, l: Ledger): Promise<{ ids: string[] | null; refreshed: boolean; error?: string }> {
  let old: string[] | null = null;
  try {
    old = a.albums ? (JSON.parse(a.albums) as string[]) : null;
  } catch {
    old = null;
  }
  const fresh = old && a.albums_at && l.now - Date.parse(a.albums_at) < ALBUM_LIST_TTL_DAYS * 86400_000;
  if (fresh) return { ids: old, refreshed: false };
  // 抓到一半沒額度就白打了（不存半套清單）：這次連線要留得下 20 頁，今天的桶也要留得下預估頁數才開始
  const need = old ? Math.ceil(old.length / 10) + 1 : 3;
  if (!canUse(l, "artist_albums") || l.max - l.calls < MAX_ALBUM_PAGES + 1 || DAILY_LIMIT.artist_albums - l.used.artist_albums < need) return { ids: old, refreshed: false };
  const ids: string[] = [];
  try {
    for (let page = 0; page < MAX_ALBUM_PAGES; page++) {
      const p = await sp<AlbumPage>(`artists/${a.spotify_id}/albums?include_groups=album,single&market=TW&limit=10&offset=${page * 10}`, "artist_albums", l);
      if (!p) break;
      ids.push(...p.items.map((x) => x.id));
      if (!p.next) break;
    }
  } catch (e) {
    // 鎖住或沒額度：這次沿用舊清單（沒有就等），其他桶照常
    if (e instanceof NoBudget || (e instanceof RateLimited && e.bucket !== "token")) return { ids: old, refreshed: false, error: e instanceof RateLimited ? e.message : "" };
    throw e;
  }
  return { ids: [...new Set(ids)], refreshed: true };
}

const rand = (n: number) => Math.floor(Math.random() * n);

async function cachedAlbums(ids: string[]): Promise<Map<string, CachedAlbum>> {
  const out = new Map<string, CachedAlbum>();
  const db = env.DB!;
  // D1 一句最多 100 個綁定參數：每 90 個一批
  for (let k = 0; k < ids.length; k += 90) {
    const part = ids.slice(k, k + 90);
    const rows = (await db.prepare(`SELECT album_id, name, tracks FROM spotify_albums WHERE album_id IN (${part.map((_, j) => `?${j + 1}`).join(",")})`).bind(...part).all<{ album_id: string; name: string; tracks: string }>()).results;
    for (const r of rows) out.set(r.album_id, { name: r.name, tracks: JSON.parse(r.tracks) });
  }
  return out;
}

/**
 * 從這位藝人的完整作品抽一首（不寫 spotify_draws）。新抓到的專輯曲目放進 newAlbums 讓呼叫端存 D1。
 * 曲目沒快取、今天又沒額度的專輯先跳過（只從有快取的裡面挑）。
 */
export async function pickTrack(
  a: ArtistRow,
  albums: string[],
  recent: Set<string>,
  l: Ledger,
  cache: Map<string, CachedAlbum>,
  newAlbums: Map<string, CachedAlbum>,
): Promise<{ pick: Picked | null; goneAlbum: boolean }> {
  let left = [...albums];
  let goneAlbum = false;
  for (let tries = 0; tries < 3 && left.length; tries++) {
    if (!canUse(l, "album")) left = left.filter((id) => cache.has(id));
    if (!left.length) break;
    const [albumId] = left.splice(rand(left.length), 1);
    let al = cache.get(albumId);
    if (!al) {
      const r = await sp<AlbumResp>(`albums/${albumId}?market=TW`, "album", l);
      if (!r) {
        goneAlbum = true;
        continue;
      }
      al = {
        name: r.name.slice(0, 200),
        tracks: r.tracks.items
          .filter((t) => t.id && t.is_playable !== false && !EXCLUDE_TITLE.test(t.name))
          .map((t) => ({ i: t.id, n: t.name.slice(0, 200), a: t.artists.map((x) => x.id) })),
      };
      cache.set(albumId, al);
      newAlbums.set(albumId, al);
    }
    const ok = al.tracks.filter((t) => t.a.includes(a.spotify_id));
    if (!ok.length) continue;
    const unseen = ok.filter((t) => !recent.has(t.i));
    const pool = unseen.length ? unseen : ok;
    const t = pool[rand(pool.length)];
    return { pick: { trackId: t.i, title: t.n, albumId, albumName: al.name }, goneAlbum };
  }
  return { pick: null, goneAlbum };
}

export type DrawResult = {
  day: string;
  skipped?: string;
  drawn: number;
  empty: number;
  waiting: number;
  errors: string[];
  remaining: number;
  calls: number;
  used: Record<Bucket, number>;
  locked: Partial<Record<Bucket, string>>;
  bumped: boolean;
};

export const setState = (key: string, value: string) =>
  env.DB!.prepare(
    `INSERT INTO spotify_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).bind(key, value);

export async function openLedger(now: number, max: number): Promise<Ledger> {
  const day = taiwanDay(now);
  const rows = (await env.DB!.prepare(`SELECT key, value FROM spotify_state WHERE key LIKE 'used:%' OR key LIKE 'backoff:%' OR key = 'pending_bump'`).all<{ key: string; value: string }>()).results;
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const used = Object.fromEntries((Object.keys(DAILY_LIMIT) as Bucket[]).map((b) => [b, Number(m.get(`used:${b}:${day}`) ?? 0)])) as Record<Bucket, number>;
  const lockedUntil: Ledger["lockedUntil"] = {};
  for (const b of Object.keys(DAILY_LIMIT) as Bucket[]) {
    const v = m.get(`backoff:${b}`);
    if (v && Date.parse(v) > now) lockedUntil[b] = v;
  }
  return { calls: 0, max, day, now, used, start: { ...used }, lockedUntil };
}
/** 把這次用掉的額度與新鎖寫回（累加用 SQL 做，兩個執行同時跑也不會蓋掉對方） */
export function closeLedger(l: Ledger): D1PreparedStatement[] {
  const st: D1PreparedStatement[] = [];
  for (const b of Object.keys(DAILY_LIMIT) as Bucket[]) {
    const add = l.used[b] - l.start[b];
    if (add > 0)
      st.push(
        env.DB!.prepare(
          `INSERT INTO spotify_state (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ?2 AS TEXT), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        ).bind(`used:${b}:${l.day}`, String(add)),
      );
    if (l.lockedUntil[b]) st.push(setState(`backoff:${b}`, l.lockedUntil[b]!));
  }
  return st;
}
function saveAlbums(m: Map<string, CachedAlbum>): D1PreparedStatement[] {
  return [...m].map(([id, al]) =>
    env.DB!.prepare(
      `INSERT INTO spotify_albums (album_id, name, tracks) VALUES (?1, ?2, ?3) ON CONFLICT(album_id) DO UPDATE SET name = excluded.name, tracks = excluded.tracks, fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(id, al.name, JSON.stringify(al.tracks)),
  );
}

const PENDING = `SELECT sa.artist_slug, sa.spotify_id, sa.albums, sa.albums_at FROM spotify_artists sa
  JOIN artists a ON a.slug = sa.artist_slug
  WHERE sa.enabled = 1 AND a.kind = '藝人' AND a.status = 'approved' AND a.deleted_at IS NULL AND a.hidden_at IS NULL
    AND (sa.drawn_on IS NULL OR sa.drawn_on < ?1)`;

/** 跑一批抽歌。排程每 5 分鐘呼叫一次；管理員 API 也可手動呼叫（publish＝這批抽完就讓首頁換新，不等整晚抽完） */
export async function runSpotifyDraw(opts: { now?: number; publish?: boolean } = {}): Promise<DrawResult> {
  const now = opts.now ?? Date.now();
  const db = env.DB!;
  const l = await openLedger(now, MAX_CALLS);
  const res: DrawResult = { day: l.day, drawn: 0, empty: 0, waiting: 0, errors: [], remaining: 0, calls: 0, used: l.used, locked: l.lockedUntil, bumped: false };
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return { ...res, skipped: "沒有設定 Spotify 金鑰" };

  // 沒抽過的先，再來是最久沒抽的；同一批裡「上一班沒額度而等著」的會排在後面（updated_at 較新）
  const list = (
    await db.prepare(`${PENDING} ORDER BY sa.drawn_on IS NOT NULL, sa.drawn_on, sa.updated_at, sa.artist_slug LIMIT ${MAX_ARTISTS}`).bind(l.day).all<ArtistRow>()
  ).results;
  for (const a of list) {
    const newAlbums = new Map<string, CachedAlbum>();
    const st: D1PreparedStatement[] = [];
    let stop = false;
    try {
      const { ids, refreshed, error } = await albumList(a, l);
      if (error) res.errors.push(error);
      if (ids === null) {
        // 還沒有專輯清單、今天也沒額度抓：不算抽過，下一班或明天再來
        res.waiting++;
        st.push(db.prepare(`UPDATE spotify_artists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artist_slug = ?1`).bind(a.artist_slug));
      } else {
        const recent = new Set(
          (await db.prepare(`SELECT track_id FROM spotify_draws WHERE artist_slug = ?1 ORDER BY id DESC LIMIT ${RECENT}`).bind(a.artist_slug).all<{ track_id: string }>()).results.map(
            (r) => r.track_id,
          ),
        );
        const cache = await cachedAlbums(ids);
        let r: { pick: Picked | null; goneAlbum: boolean } = { pick: null, goneAlbum: false };
        try {
          r = ids.length ? await pickTrack(a, ids, recent, l, cache, newAlbums) : r;
        } catch (e) {
          if (e instanceof RateLimited) {
            res.errors.push(e.message);
            if (e.bucket === "token") stop = true;
          } else if (!(e instanceof NoBudget)) throw e;
        }
        // 專輯下架（404）：清掉更新時間，下次有額度時重抓清單
        if (refreshed || r.goneAlbum)
          st.push(db.prepare(`UPDATE spotify_artists SET albums = ?2, albums_at = ?3 WHERE artist_slug = ?1`).bind(a.artist_slug, JSON.stringify(ids), r.goneAlbum ? null : new Date(now).toISOString()));
        if (r.pick) {
          const p = r.pick;
          st.push(
            db.prepare(`INSERT INTO spotify_draws (artist_slug, track_id, title, album_id, album_name, drawn_on) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(a.artist_slug, p.trackId, p.title, p.albumId, p.albumName, l.day),
            db
              .prepare(`UPDATE spotify_artists SET drawn_on = ?2, track_id = ?3, title = ?4, album_name = ?5, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artist_slug = ?1`)
              .bind(a.artist_slug, l.day, p.trackId, p.title, p.albumName),
          );
          res.drawn++;
        } else if (!ids.length || (!stop && canUse(l, "album"))) {
          // 真的抽不到（沒有作品、試 3 張都只有伴奏或別人的歌）：今天不再試，首頁沿用上一首
          st.push(db.prepare(`UPDATE spotify_artists SET drawn_on = ?2 WHERE artist_slug = ?1`).bind(a.artist_slug, l.day));
          res.empty++;
        } else {
          res.waiting++;
          st.push(db.prepare(`UPDATE spotify_artists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE artist_slug = ?1`).bind(a.artist_slug));
        }
      }
    } catch (e) {
      // 走到這裡的 429／沒額度只會是換 token（各桶的在上面各自處理）：這班停
      if (e instanceof RateLimited) {
        res.errors.push(e.message);
        stop = true;
      } else if (e instanceof NoBudget) stop = true;
      else res.errors.push(`${a.artist_slug}：${e instanceof Error ? e.message : String(e)}`);
    }
    st.push(...saveAlbums(newAlbums));
    if (st.length) await db.batch(st);
    if (stop || l.calls >= l.max) break;
  }
  res.calls = l.calls;
  res.remaining = (await db.prepare(`SELECT COUNT(*) AS n FROM (${PENDING})`).bind(l.day).first<{ n: number }>())?.n ?? 0;

  // 首頁整頁快取：整晚抽完、最後一班排程、或管理員要求時才換一次
  const st: D1PreparedStatement[] = closeLedger(l);
  const pending = res.drawn > 0 || (await db.prepare(`SELECT value FROM spotify_state WHERE key = 'pending_bump'`).first<{ value: string }>())?.value === "1";
  const d = new Date(now);
  const lastSlot = d.getUTCHours() === 20 && d.getUTCMinutes() >= 55;
  if (pending && (res.remaining === 0 || lastSlot || opts.publish)) {
    st.push(db.prepare(`UPDATE content_version SET v = v + 1 WHERE id = 1`), setState("pending_bump", "0"));
    res.bumped = true;
  } else if (res.drawn > 0) st.push(setState("pending_bump", "1"));
  st.push(setState("last_run", JSON.stringify({ at: new Date(now).toISOString(), ...res })));
  await db.batch(st);
  return res;
}

/** 管理員驗收用：同一位藝人連抽 N 次（不寫抽歌紀錄、不影響首頁；新抓到的專輯曲目照樣存快取），回傳每次抽到的歌 */
export async function sampleArtist(slug: string, times: number) {
  const db = env.DB!;
  const a = await db.prepare(`SELECT artist_slug, spotify_id, albums, albums_at FROM spotify_artists WHERE artist_slug = ?1`).bind(slug).first<ArtistRow>();
  if (!a) return null;
  const l = await openLedger(Date.now(), 45);
  const { ids, refreshed } = await albumList(a, l);
  const cache = await cachedAlbums(ids ?? []);
  const newAlbums = new Map<string, CachedAlbum>();
  const picks: (Picked | null)[] = [];
  let stopped = "";
  for (let i = 0; i < times && ids?.length; i++) {
    try {
      picks.push((await pickTrack(a, ids, new Set(), l, cache, newAlbums)).pick);
    } catch (e) {
      if (e instanceof NoBudget || e instanceof RateLimited) {
        stopped = e instanceof RateLimited ? e.message : "額度用完";
        break;
      }
      throw e;
    }
  }
  const st = [...closeLedger(l), ...saveAlbums(newAlbums)];
  if (refreshed) st.push(db.prepare(`UPDATE spotify_artists SET albums = ?2, albums_at = ?3 WHERE artist_slug = ?1`).bind(slug, JSON.stringify(ids), new Date().toISOString()));
  if (st.length) await db.batch(st);
  const eligible = new Set<string>();
  for (const id of ids ?? []) for (const t of cache.get(id)?.tracks ?? []) if (t.a.includes(a.spotify_id)) eligible.add(t.i);
  return {
    slug,
    albums: ids?.length ?? 0,
    albumsCached: (ids ?? []).filter((id) => cache.has(id)).length,
    eligibleCached: eligible.size,
    calls: l.calls,
    stopped,
    picks,
    distinct: new Set(picks.filter(Boolean).map((p) => p!.trackId)).size,
  };
}

/** 後台狀態 */
export async function drawStatus() {
  const db = env.DB!;
  const day = taiwanDay();
  const [c, pool, today, albums, state] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n, SUM(enabled) AS on_, SUM(track_id IS NOT NULL) AS has, SUM(albums IS NOT NULL) AS lists FROM spotify_artists`).first<{ n: number; on_: number; has: number; lists: number }>(),
    db.prepare(`SELECT COUNT(*) AS n, COUNT(DISTINCT track_id) AS tracks FROM spotify_draws`).first<{ n: number; tracks: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM spotify_draws WHERE drawn_on = ?1`).bind(day).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM spotify_albums`).first<{ n: number }>(),
    db.prepare(`SELECT key, value FROM spotify_state`).all<{ key: string; value: string }>(),
  ]);
  const m = new Map(state.results.map((r) => [r.key, r.value]));
  return {
    day,
    artists: c?.n ?? 0,
    enabled: c?.on_ ?? 0,
    withTrack: c?.has ?? 0,
    withAlbumList: c?.lists ?? 0,
    albumsCached: albums?.n ?? 0,
    poolRows: pool?.n ?? 0,
    poolTracks: pool?.tracks ?? 0,
    drawnToday: today?.n ?? 0,
    usedToday: { artist_albums: Number(m.get(`used:artist_albums:${day}`) ?? 0), album: Number(m.get(`used:album:${day}`) ?? 0), search: Number(m.get(`used:search:${day}`) ?? 0) },
    limits: DAILY_LIMIT,
    // 只回還在鎖的
    backoff: Object.fromEntries((["artist_albums", "album", "search"] as const).map((b) => [b, (m.get(`backoff:${b}`) ?? "") > new Date().toISOString() ? m.get(`backoff:${b}`)! : null])) as Record<Bucket, string | null>,
    lastRun: m.get("last_run") ? JSON.parse(m.get("last_run")!) : null,
    hasKey: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
  };
}
