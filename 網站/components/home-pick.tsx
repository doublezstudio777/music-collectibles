"use client";

// 首頁上方的一首歌（2026-09-29）：Spotify 官方嵌入播放器＋藝人。
// 首頁整頁快取，伺服器輸出整份啟用歌單，挑哪一首在瀏覽器端決定（不因此讓快取失效、不多用伺服器 CPU）。
// 伺服器輸出與 hydration 第一次都是「還沒挑」：文字先隱藏、播放器位置放同尺寸佔位，挑好才顯示，版面不跳。
// 換一首用 key 換掉整個 iframe，不改 src（改 src 會在瀏覽器上一頁多一筆紀錄）。
// 每天一首（2026-09-29）：第一眼那首以台灣日期為種子從歌單固定挑出，同一天所有人相同、隔天換；「換一首」照舊隨機。
// 種子只用日期，歌單順序由伺服器固定輸出，所以不需要伺服器參與，整頁快取不受影響。
import Link from "@/components/link";
import { useEffect, useState } from "react";
import { artistHref } from "@/lib/data";

export type PickSong = { track: string; slug: string; name: string; meta: string; count: number };

type Rng = () => number;
/** 台灣日期（UTC+8）YYYY-MM-DD */
export const taiwanDate = (now = Date.now()) => new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
/** 以字串為種子的固定亂數（FNV-1a 雜湊＋mulberry32） */
export function seeded(seed: string): Rng {
  let h = 2166136261;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** 先挑藝人、再挑那位的一首：歌多的藝人不會比較常出現 */
export const pickFrom = (songs: PickSong[], pool: number[], rng: Rng = Math.random) => {
  const slugs = [...new Set(pool.map((n) => songs[n].slug))];
  const slug = slugs[Math.floor(rng() * slugs.length)];
  const mine = pool.filter((n) => songs[n].slug === slug);
  return mine[Math.floor(rng() * mine.length)];
};

export function HomePick({ songs }: { songs: PickSong[] }) {
  const [i, setI] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // 當天那首在瀏覽器端挑（伺服器輸出是整頁快取的同一份，不能依日期變）：掛上後挑一次
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setI(pickFrom(songs, songs.map((_, n) => n), seeded(taiwanDate())));
  }, [songs]);
  const s = songs[i ?? 0];
  const shuffle = () => {
    if (i === null) return;
    // 優先換成別位藝人的歌；只剩同一位就換同一位的另一首
    const others = songs.map((_, n) => n).filter((n) => songs[n].slug !== s.slug);
    const pool = others.length ? others : songs.map((_, n) => n).filter((n) => n !== i);
    if (!pool.length) return;
    setLoaded(false);
    setI(pickFrom(songs, pool));
  };
  return (
    <section className="hp" aria-labelledby="hp-title" data-ready={i !== null} data-testid="home-pick">
      <h2 id="hp-title" className="hp-title">
        今日推薦單曲
      </h2>
      <div className="hp-player" data-loaded={loaded}>
        {i !== null ? (
          <iframe
            key={s.track}
            className="hp-sp"
            title="Spotify 播放器"
            src={`https://open.spotify.com/embed/track/${s.track}?utm_source=generator`}
            height={152}
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            onLoad={() => setLoaded(true)}
            data-track={s.track}
          />
        ) : null}
      </div>
      <div className="hp-row">
        <div className="hp-info">
          <p className="hp-name">
            <Link href={artistHref(s.slug)} data-testid="pick-name">
              {s.name}
            </Link>
          </p>
          <p className="hp-meta" data-testid="pick-meta">
            {s.meta}
          </p>
        </div>
        <div className="hp-acts">
          <Link className="btn btn-line" href={artistHref(s.slug)} data-testid="pick-go">
            {s.count > 0 ? `看其他人${s.name}的相關收藏` : `看${s.name}的藝人頁`}
          </Link>
          {songs.length > 1 ? (
            <button type="button" className="btn-shuffle" onClick={shuffle} data-testid="pick-shuffle">
              換一首
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
