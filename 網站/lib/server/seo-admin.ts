// 後台 SEO（2026-10-01 第三層，手動覆寫）：藝人頁、系列頁、首頁、關於頁的自訂標題、描述、og 圖、不收錄開關，
// 加上全站的標題後綴與預設描述。存在 settings 表（key＝seo:{對象}，value＝JSON），不用新表、不用遷移。
// settings 有內容版本觸發器：存檔後整頁快取自動換新。
//
// og 圖：瀏覽器端裁成 1200×630 JPEG 再上傳，存 R2 `g/{id}.jpg`，photos 表記一列（purpose=seo、owner_id=site:seo，
// 不掛在任何管理員帳號底下，刪管理員帳號不會連帶刪掉），計入 r2_bytes；/img/g/ 公開。換掉或清掉的舊檔：標刪除、R2 刪檔、容量扣回。

import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { adminLog, photos, settings } from "@/db/schema";
import { getCatalog } from "@/lib/server/content";
import { randomToken } from "@/lib/server/crypto";
import { activeArtistPhoto } from "@/lib/server/artist-photos";
import { dimensions, isPaused, MAX_OG_BYTES, purgePhotoCache, releaseBytes, reserveBytes, checkImage } from "@/lib/server/photos";
import { seriesTracks } from "@/lib/server/tracks";
import { HttpError } from "@/lib/server/trade";
import type { User } from "@/lib/server/auth";
import {
  artistDescription,
  artistIndex,
  artistTitle,
  overrideOf,
  seoContext,
  seriesDescription,
  seriesIndex,
  seriesTitle,
} from "@/lib/server/seo";
import { artistHref, norm, SITE_TITLE, SITE_NAME, seriesHref } from "@/lib/data";
import { clipWidth, DEFAULT_SITE_DESC, DEFAULT_TITLE_SUFFIX, DESC_MAX, isSeoTarget, oneLine, type SeoOverride, type SeoTarget } from "@/lib/seo";
import { ABOUT_PARAS } from "@/lib/about";

export const SEO_OG = { w: 1200, h: 630 } as const;
const LIMITS = { title: 80, description: 300, suffix: 30 } as const;
const nowIso = () => new Date().toISOString();

export type SeoForm = {
  target: SeoTarget;
  label: string;
  path: string;
  /** 自動產生的（沒覆寫時實際輸出的） */
  auto: { title: string; description: string; og: string };
  override: SeoOverride;
  /** 首頁標題不接後綴 */
  absolute: boolean;
  /** 自動把關的判斷（沒勾「不收錄」時） */
  auto_index: { index: boolean; reason: string };
  site: { suffix: string; description: string };
};

/** 首頁 og 圖、關於頁沒照片時用站方預設圖 */
const OG_DEFAULT_URL = "/og-default.png";

export async function seoForm(target: SeoTarget): Promise<SeoForm> {
  const [c, ctx] = await Promise.all([getCatalog(), seoContext()]);
  const override = overrideOf(ctx, target);
  const base = { target, override, site: ctx.site };
  if (target === "page:home") {
    return { ...base, label: "首頁", path: "/", absolute: true, auto: { title: SITE_TITLE, description: ctx.site.description, og: OG_DEFAULT_URL }, auto_index: { index: true, reason: "" } };
  }
  if (target === "page:about") {
    return {
      ...base,
      label: "關於頁",
      path: "/about",
      absolute: false,
      auto: { title: `關於${SITE_NAME}`, description: clipWidth(ABOUT_PARAS[0], DESC_MAX), og: OG_DEFAULT_URL },
      auto_index: { index: true, reason: "" },
    };
  }
  if (target.startsWith("artist:")) {
    const a = c.getArtist(target.slice(7));
    if (!a) throw new HttpError(404, "NOT_FOUND", "找不到這位藝人");
    const photo = await activeArtistPhoto(a.slug);
    const og = photo?.url ?? c.ogPhotoOf(c.sharesWithTag(a.name))?.url ?? OG_DEFAULT_URL;
    const decision = c.artistVisible(a) ? artistIndex(c, ctx, { ...a }) : { index: false, reason: "藝人頁沒有公開（404）" };
    return { ...base, label: a.name, path: artistHref(a.slug), absolute: false, auto: { title: artistTitle(a), description: artistDescription(c, a), og }, auto_index: withoutOverride(decision, override) };
  }
  const key = target.slice(7);
  const w = c.getSeriesByKey(key);
  if (!w) throw new HttpError(404, "NOT_FOUND", "找不到這個系列");
  const tracks = await seriesTracks(w.artistSlug, w.no);
  return {
    ...base,
    label: `${c.creditNames(w).map((a) => a.name).join("、")}《${w.title}》`,
    path: seriesHref(w),
    absolute: false,
    auto: {
      title: seriesTitle(c, w),
      description: seriesDescription(c, w, tracks),
      og: c.ogPhotoOf(c.sharesOfSeries(w))?.url ?? OG_DEFAULT_URL,
    },
    auto_index: withoutOverride(seriesIndex(c, ctx, w), override),
  };
}

/** 顯示「不管開關，自動規則怎麼判」：開關打開時判斷結果是「後台設定不收錄」，這裡改回自動規則的理由 */
function withoutOverride(d: { index: boolean; reason: string }, o: SeoOverride) {
  return o.noindex && d.reason === "後台設定不收錄" ? { index: true, reason: "（自動規則會收錄，是後台開關擋掉）" } : d;
}

/** 搜尋藝人、系列（名稱、別名、系列名稱含關鍵字），最多 20 筆 */
export async function seoSearch(q: string) {
  const c = await getCatalog();
  const k = norm(q);
  if (!k) return [];
  const artists = c.artists
    .filter((a) => [a.name, ...a.aliases].some((x) => norm(x).includes(k)))
    .slice(0, 10)
    .map((a) => ({ target: `artist:${a.slug}`, label: a.name, kind: a.kind === "發行單位" ? "發行單位" : "藝人", path: artistHref(a.slug) }));
  const series = c.seriesList
    .filter((w) => norm(w.title).includes(k) || norm(w.name).includes(k) || c.creditNames(w).some((a) => norm(a.name).includes(k)))
    .slice(0, 20 - artists.length)
    .map((w) => ({ target: `series:${w.artistSlug}/${w.no}`, label: `${c.creditNames(w).map((a) => a.name).join("、")}《${w.title}》`, kind: "系列", path: seriesHref(w) }));
  return [...artists, ...series];
}

/** 有覆寫過的對象（後台列表用） */
export async function seoOverrides() {
  const ctx = await seoContext();
  return [...ctx.overrides.entries()].filter(([k]) => isSeoTarget(k)).map(([target, o]) => ({ target, ...o }));
}

async function put(key: string, value: string) {
  await getDb().insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: nowIso() } });
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? oneLine(v).slice(0, max) : "");

export async function saveSeo(u: User, target: SeoTarget, body: Record<string, unknown>) {
  await seoForm(target); // 對象不存在就 404
  const prev = overrideOf(await seoContext(), target);
  const next: SeoOverride = {
    ...(clean(body.title, LIMITS.title) ? { title: clean(body.title, LIMITS.title) } : {}),
    ...(clean(body.description, LIMITS.description) ? { description: clean(body.description, LIMITS.description) } : {}),
    ...(prev.og ? { og: prev.og } : {}),
    ...(body.noindex === true ? { noindex: true } : {}),
  };
  await writeOverride(target, next);
  await getDb().insert(adminLog).values({ adminId: u.id, action: "SEO 設定", target, detail: JSON.stringify({ from: prev, to: next }) });
  return { saved: next };
}

async function writeOverride(target: SeoTarget, o: SeoOverride) {
  if (!o.title && !o.description && !o.og && !o.noindex) await getDb().delete(settings).where(eq(settings.key, `seo:${target}`));
  else await put(`seo:${target}`, JSON.stringify(o));
}

export async function saveSite(u: User, body: Record<string, unknown>) {
  const suffix = clean(body.suffix, LIMITS.suffix);
  const description = clean(body.description, LIMITS.description);
  const prev = (await seoContext()).site;
  if (!suffix && !description) await getDb().delete(settings).where(eq(settings.key, "seo:site"));
  else await put("seo:site", JSON.stringify({ ...(suffix ? { suffix } : {}), ...(description ? { description } : {}) }));
  await getDb().insert(adminLog).values({ adminId: u.id, action: "全站 SEO 設定", target: "seo:site", detail: JSON.stringify({ from: prev, to: { suffix, description } }) });
  return { suffix: suffix || DEFAULT_TITLE_SUFFIX, description: description || DEFAULT_SITE_DESC };
}

async function dropOg(origin: string, key: string) {
  const db = getDb();
  const [p] = await db.select().from(photos).where(and(eq(photos.r2Key, key), eq(photos.purpose, "seo"), isNull(photos.deletedAt)));
  if (!p) return;
  await db.update(photos).set({ deletedAt: nowIso() }).where(eq(photos.id, p.id));
  await env.PHOTOS?.delete(key).catch(() => undefined);
  await releaseBytes(p.bytes);
  await purgePhotoCache(origin, [key]);
}

/** 上傳（或換掉）某個對象的 og 圖：1200×630 JPEG／WebP，最大 400KB */
export async function uploadSeoOg(u: User, target: SeoTarget, file: File | null, origin: string) {
  await seoForm(target);
  if (await isPaused()) throw new HttpError(503, "UPLOAD_PAUSED", "上傳暫停");
  if (!file) throw new HttpError(400, "BAD_REQUEST", "缺圖片檔");
  if (file.size > MAX_OG_BYTES) throw new HttpError(413, "TOO_LARGE", "圖片太大（上限 400KB）");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chk = checkImage(bytes);
  if (!chk) throw new HttpError(415, "BAD_FORMAT", "只收 JPEG 或 WebP");
  if ("error" in chk) throw new HttpError(400, "BAD_IMAGE", chk.error);
  const type = chk.type;
  const { width, height } = dimensions(bytes, type);
  if (width !== SEO_OG.w || height !== SEO_OG.h) throw new HttpError(400, "BAD_SIZE", `og 圖要是 ${SEO_OG.w}×${SEO_OG.h}`);
  if (!(await reserveBytes(bytes.length))) throw new HttpError(507, "STORAGE_FULL", "儲存空間已滿");
  const bucket = env.PHOTOS;
  const id = randomToken(12);
  const key = `g/${id}.${type === "image/webp" ? "webp" : "jpg"}`;
  if (!bucket) {
    await releaseBytes(bytes.length);
    throw new HttpError(503, "NO_STORAGE", "照片儲存還沒設定");
  }
  try {
    await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
  } catch {
    await releaseBytes(bytes.length);
    throw new HttpError(502, "STORAGE_ERROR", "圖片存不進去，再試一次");
  }
  await getDb().insert(photos).values({ id, ownerId: "site:seo", purpose: "seo", r2Key: key, thumbKey: key, contentType: type, bytes: bytes.length, width, height });
  const prev = overrideOf(await seoContext(), target);
  await writeOverride(target, { ...prev, og: key });
  if (prev.og && prev.og !== key) await dropOg(origin, prev.og);
  await getDb().insert(adminLog).values({ adminId: u.id, action: "SEO og 圖", target, detail: JSON.stringify({ from: prev.og ?? null, to: key }) });
  return { key, url: `/img/${key}` };
}

export async function clearSeoOg(u: User, target: SeoTarget, origin: string) {
  const prev = overrideOf(await seoContext(), target);
  if (!prev.og) return { cleared: false };
  const { og, ...rest } = prev;
  await writeOverride(target, rest);
  await dropOg(origin, og);
  await getDb().insert(adminLog).values({ adminId: u.id, action: "SEO og 圖", target, detail: JSON.stringify({ from: og, to: null }) });
  return { cleared: true };
}

