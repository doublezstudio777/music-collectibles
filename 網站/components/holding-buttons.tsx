"use client";

import { useShownCount } from "@/lib/counts";
import { toggleHolding, useAppState } from "@/lib/state";
import { Heart } from "@/components/like-button";

/**
 * 我有／願望清單，掛在版本上。owners、wanted 是資料庫總數（含自己），顯示由 useLiveCount 換算。
 * 2026-10-01 願望清單統一：原本的「想要」改成愛心＋「加入願望清單」，跟收藏卡片的愛心同一個圖示、同一個清單（/me/likes）。
 * 資料表照舊（holdings.kind = 'wanted'），只改呈現
 */
export function HoldingButtons({ vkey, owners, wanted }: { vkey: string; owners: number; wanted: number }) {
  const { holds, ready } = useAppState();
  const own = holds("owned", vkey);
  const want = holds("wanted", vkey);
  const ownN = useShownCount("owned", vkey, owners, own);
  const wantN = useShownCount("wanted", vkey, wanted, want);
  return (
    <div className="holding">
      <button
        type="button"
        className={`hold${own ? " is-on" : ""}`}
        aria-pressed={ready ? own : undefined}
        onClick={() => toggleHolding("owned", vkey)}
      >
        我有 <span className="num">{ownN}</span>
      </button>
      <button
        type="button"
        className={`hold hold-wish${want ? " is-on" : ""}`}
        aria-pressed={ready ? want : undefined}
        aria-label={`${want ? "已在願望清單" : "加入願望清單"}，${wantN} 人放進願望清單`}
        data-testid="wish-btn"
        onClick={() => toggleHolding("wanted", vkey)}
      >
        <Heart />
        {want ? "已在願望清單" : "加入願望清單"} <span className="num">{wantN}</span>
      </button>
    </div>
  );
}

/** 版本標題旁「N 人有這個版本」：持有數（其他人＋自己按了我有），跟我有按鈕同一個數字 */
export function OwnersCount({ vkey, owners }: { vkey: string; owners: number }) {
  const { holds } = useAppState();
  const n = useShownCount("owned", vkey, owners, holds("owned", vkey));
  return (
    <span className="ver-owners" data-testid="ver-owners">
      <span className="num">{n}</span> 人有這個版本
    </span>
  );
}
