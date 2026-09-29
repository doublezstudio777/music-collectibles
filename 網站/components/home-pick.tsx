"use client";

// 首頁上方的一首歌（2026-09-29）：Spotify 官方嵌入播放器＋藝人。
// 首頁整頁快取，伺服器輸出整份啟用歌單，挑哪一首在瀏覽器端決定（不因此讓快取失效、不多用伺服器 CPU）。
// 伺服器輸出與 hydration 第一次都是「還沒挑」：文字先隱藏、播放器位置放同尺寸佔位，挑好才顯示，版面不跳。
// 換一首用 key 換掉整個 iframe，不改 src（改 src 會在瀏覽器上一頁多一筆紀錄）。
import Link from "next/link";
import { useEffect, useState } from "react";
import { artistHref } from "@/lib/data";

export type PickSong = { track: string; slug: string; name: string; meta: string };

const rand = (n: number) => Math.floor(Math.random() * n);
/** 先隨機挑藝人、再挑那位的一首：歌多的藝人不會比較常出現 */
const pickFrom = (songs: PickSong[], pool: number[]) => {
  const slugs = [...new Set(pool.map((n) => songs[n].slug))];
  const slug = slugs[rand(slugs.length)];
  const mine = pool.filter((n) => songs[n].slug === slug);
  return mine[rand(mine.length)];
};

export function HomePick({ songs }: { songs: PickSong[] }) {
  const [i, setI] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // 隨機只能在瀏覽器端做（伺服器輸出是整頁快取的同一份），掛上後挑一次
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setI(pickFrom(songs, songs.map((_, n) => n)));
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
            看其他人{s.name}的相關收藏
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
