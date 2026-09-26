// 維基式編輯（2c）：系列頁正文、藝人簡介。
//
// - 認證帳號（已驗證 Email）都能編輯與還原，必填一句修改說明
// - 每次修改存一筆 revisions（整份內容），差異在歷史頁即時算；還原＝新增一筆，不刪任何紀錄
// - 管理員可以鎖定頁面，鎖定後只有管理員能改
// - 藝人簡介來自維基百科時，後續所有版本都標 CC BY-SA 4.0（改寫仍是衍生作品，授權跟著走）
// - 第一次有人編輯時，先把目前內容存成「初始版本」，歷史才完整

import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, artists, pageLocks, revisions, series } from "@/db/schema";
import { isAdmin, type User } from "@/lib/server/auth";
import { parseJson, userNames } from "@/lib/server/content";
import { hit } from "@/lib/server/services";
import { HttpError } from "@/lib/server/trade";

export const WIKI_LICENSE = "CC BY-SA 4.0";
const MAX_CHARS = 20_000;
const MAX_PARAS = 80;

export type WikiTarget = { kind: "artist"; slug: string } | { kind: "series"; slug: string; no: number };

export function parseWikiTarget(v: unknown): WikiTarget | null {
  if (typeof v !== "string" || v.length > 100) return null;
  let m = v.match(/^artist:([a-z0-9-]{1,60})$/);
  if (m) return { kind: "artist", slug: m[1] };
  m = v.match(/^series:([a-z0-9-]{1,60})\/(\d{1,6})$/);
  if (m) return { kind: "series", slug: m[1], no: Number(m[2]) };
  return null;
}

export const targetKey = (t: WikiTarget) => (t.kind === "artist" ? `artist:${t.slug}` : `series:${t.slug}/${t.no}`);
export const fieldOf = (t: WikiTarget) => (t.kind === "artist" ? "intro" : "body");

type Page = { content: string[]; license: string | null; createdBy: string | null; createdAt: string; wikiUrl: string | null };

/** 讀頁面目前內容（只算前台看得到的：已核准、沒刪、沒隱藏） */
export async function loadPage(t: WikiTarget): Promise<Page | null> {
  const db = getDb();
  if (t.kind === "artist") {
    const [a] = await db
      .select()
      .from(artists)
      .where(and(eq(artists.slug, t.slug), eq(artists.status, "approved"), isNull(artists.deletedAt), isNull(artists.hiddenAt)));
    if (!a) return null;
    return {
      content: parseJson<string[]>(a.intro, []),
      license: a.wikiUrl ? (a.wikiLicense ?? WIKI_LICENSE) : null,
      createdBy: a.createdBy,
      createdAt: a.createdAt,
      wikiUrl: a.wikiUrl,
    };
  }
  const [w] = await db
    .select()
    .from(series)
    .where(and(eq(series.artistSlug, t.slug), eq(series.no, t.no), eq(series.status, "approved"), isNull(series.deletedAt), isNull(series.hiddenAt)));
  if (!w) return null;
  return { content: parseJson<string[]>(w.body, []), license: null, createdBy: w.createdBy, createdAt: w.createdAt, wikiUrl: null };
}

export async function isLocked(t: WikiTarget) {
  const [r] = await getDb().select().from(pageLocks).where(eq(pageLocks.target, targetKey(t)));
  return Boolean(r);
}

export type RevisionView = {
  id: number;
  no: number;
  content: string[];
  summary: string;
  author: { handle: string; name: string } | null;
  revertedFrom: number | null;
  license: string | null;
  at: string;
};

/** 新到舊。還沒人編輯過時回一筆虛擬的「目前版本」（id 0），不寫資料庫 */
export async function history(t: WikiTarget, page: Page): Promise<RevisionView[]> {
  const rows = await getDb()
    .select()
    .from(revisions)
    .where(and(eq(revisions.target, targetKey(t)), eq(revisions.field, fieldOf(t))))
    .orderBy(desc(revisions.id));
  if (!rows.length) {
    const names = await userNames(page.createdBy ? [page.createdBy] : []);
    return [
      {
        id: 0,
        no: 1,
        content: page.content,
        summary: page.license ? "初始版本（取自維基百科）" : "初始版本",
        author: page.createdBy ? (names.get(page.createdBy) ?? null) : null,
        revertedFrom: null,
        license: page.license,
        at: page.createdAt,
      },
    ];
  }
  const names = await userNames(rows.map((r) => r.authorId ?? ""));
  return rows.map((r, i) => ({
    id: r.id,
    no: rows.length - i,
    content: parseJson<string[]>(r.content, []),
    summary: r.summary,
    author: r.authorId ? (names.get(r.authorId) ?? { handle: "", name: "（已刪除）" }) : null,
    revertedFrom: r.revertedFrom,
    license: r.license,
    at: r.createdAt,
  }));
}

/** 編輯表單的 baseId：目前最新版本 id（0＝還沒人編輯過） */
export async function latestRevisionId(target: string) {
  const [r] = await getDb().select({ id: revisions.id }).from(revisions).where(eq(revisions.target, target)).orderBy(desc(revisions.id)).limit(1);
  return r?.id ?? 0;
}

/** 頁面上的「最後修改：某某」 */
export async function lastEdit(t: WikiTarget) {
  const [r] = await getDb()
    .select({ authorId: revisions.authorId, at: revisions.createdAt })
    .from(revisions)
    .where(eq(revisions.target, targetKey(t)))
    .orderBy(desc(revisions.id))
    .limit(1);
  if (!r) return null;
  const names = await userNames(r.authorId ? [r.authorId] : []);
  return { by: r.authorId ? (names.get(r.authorId)?.name ?? "（已刪除）") : "音藏", date: r.at.slice(0, 10) };
}

async function ensureBaseline(t: WikiTarget, page: Page) {
  const db = getDb();
  const [any] = await db.select({ id: revisions.id }).from(revisions).where(eq(revisions.target, targetKey(t))).limit(1);
  if (any) return;
  await db.insert(revisions).values({
    target: targetKey(t),
    field: fieldOf(t),
    content: JSON.stringify(page.content),
    summary: page.license ? "初始版本（取自維基百科）" : "初始版本",
    authorId: page.createdBy,
    license: page.license,
    createdAt: page.createdAt,
  });
}

async function latestId(t: WikiTarget) {
  const [r] = await getDb().select({ id: revisions.id }).from(revisions).where(eq(revisions.target, targetKey(t))).orderBy(desc(revisions.id)).limit(1);
  return r?.id ?? 0;
}

async function assertCanEdit(u: User, t: WikiTarget) {
  if (!u.emailVerifiedAt) throw new HttpError(403, "NOT_VERIFIED", "認證後才能編輯");
  if (!isAdmin(u) && (await isLocked(t))) throw new HttpError(423, "PAGE_LOCKED", "這個頁面已被管理員鎖定，暫時不能編輯");
  if (!(await hit(`edit:${u.id}`, 60, 86400))) throw new HttpError(429, "RATE_LIMITED", "今天編輯太多次了，明天再來");
}

function cleanParas(v: unknown) {
  if (!Array.isArray(v)) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const paras = v
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paras.length > MAX_PARAS || paras.reduce((n, p) => n + p.length, 0) > MAX_CHARS) {
    throw new HttpError(413, "TOO_LONG", `內容太長（上限 ${MAX_CHARS.toLocaleString("en-US")} 字）`);
  }
  return paras;
}

const cleanSummary = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!s) throw new HttpError(400, "SUMMARY_REQUIRED", "寫一句修改說明");
  return s;
};

async function write(u: User, t: WikiTarget, page: Page, paras: string[], summary: string, revertedFrom: number | null) {
  const db = getDb();
  await ensureBaseline(t, page);
  const at = new Date().toISOString();
  const [r] = await db
    .insert(revisions)
    .values({
      target: targetKey(t),
      field: fieldOf(t),
      content: JSON.stringify(paras),
      summary,
      authorId: u.id,
      revertedFrom,
      license: page.license,
      createdAt: at,
    })
    .returning({ id: revisions.id });
  if (t.kind === "artist") {
    await db.update(artists).set({ intro: JSON.stringify(paras), lastEditBy: u.id, updatedAt: at }).where(eq(artists.slug, t.slug));
  } else {
    await db
      .update(series)
      .set({ body: JSON.stringify(paras), lastEditBy: u.id, updatedAt: at })
      .where(and(eq(series.artistSlug, t.slug), eq(series.no, t.no)));
  }
  return r.id;
}

const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/** 編輯。baseId＝編輯者開始改時看到的最新版本 id（0＝還沒有紀錄），不一致＝有人先改了 */
export async function edit(u: User, rawTarget: unknown, rawContent: unknown, rawSummary: unknown, baseId: unknown) {
  const t = parseWikiTarget(rawTarget);
  if (!t) throw new HttpError(400, "BAD_REQUEST", "參數不對");
  const page = await loadPage(t);
  if (!page) throw new HttpError(404, "NOT_FOUND", "找不到這個頁面");
  await assertCanEdit(u, t);
  const paras = cleanParas(rawContent);
  const summary = cleanSummary(rawSummary);
  if (typeof baseId === "number" && baseId !== (await latestId(t))) {
    throw new HttpError(409, "EDIT_CONFLICT", "你編輯的時候有人先改了，重新整理看最新內容再改");
  }
  if (same(paras, page.content)) throw new HttpError(409, "NO_CHANGE", "內容沒有變");
  return { id: await write(u, t, page, paras, summary, null) };
}

/** 還原到某一版＝新增一筆內容等於那一版的紀錄 */
export async function revert(u: User, revId: number, rawSummary: unknown) {
  const db = getDb();
  const [r] = await db.select().from(revisions).where(eq(revisions.id, revId));
  if (!r) throw new HttpError(404, "NOT_FOUND", "找不到這個版本");
  const t = parseWikiTarget(r.target);
  if (!t) throw new HttpError(404, "NOT_FOUND", "找不到這個頁面");
  const page = await loadPage(t);
  if (!page) throw new HttpError(404, "NOT_FOUND", "找不到這個頁面");
  await assertCanEdit(u, t);
  const paras = parseJson<string[]>(r.content, []);
  if (same(paras, page.content)) throw new HttpError(409, "NO_CHANGE", "目前內容已經跟這一版一樣");
  const all = await db.select({ id: revisions.id }).from(revisions).where(eq(revisions.target, r.target));
  const no = all.filter((x) => x.id <= r.id).length;
  const extra = typeof rawSummary === "string" ? rawSummary.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const summary = `還原到第 ${no} 版${extra ? `：${extra}` : ""}`;
  return { id: await write(u, t, page, paras, summary, r.id) };
}

export async function setPageLock(admin: User, rawTarget: unknown, locked: unknown) {
  const t = parseWikiTarget(rawTarget);
  if (!t || typeof locked !== "boolean") throw new HttpError(400, "BAD_REQUEST", "參數不對");
  if (!(await loadPage(t))) throw new HttpError(404, "NOT_FOUND", "找不到這個頁面");
  const db = getDb();
  if (locked) await db.insert(pageLocks).values({ target: targetKey(t), lockedBy: admin.id }).onConflictDoNothing();
  else await db.delete(pageLocks).where(eq(pageLocks.target, targetKey(t)));
  await db.insert(adminLog).values({ adminId: admin.id, action: locked ? "鎖定頁面" : "解除頁面鎖定", target: targetKey(t), detail: "{}" });
}
