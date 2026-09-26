import { json } from "@/lib/server/auth";
import { getCatalog } from "@/lib/server/content";
import type { ArtistGender, ArtistRegion } from "@/lib/data";

/** 藝人目錄（App 用）：?g=male|female|group&r=domestic|overseas */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const g = ["male", "female", "group"].includes(q.get("g") ?? "") ? (q.get("g") as ArtistGender) : undefined;
  const r = ["domestic", "overseas"].includes(q.get("r") ?? "") ? (q.get("r") as ArtistRegion) : undefined;
  const c = await getCatalog(null);
  return json({
    artists: c.artistDirectory(g, r).map(({ artist: a, count }) => ({
      slug: a.slug,
      name: a.name,
      tagline: a.tagline,
      gender: a.gender ?? null,
      region: a.region ?? null,
      shares: count,
    })),
  });
}
