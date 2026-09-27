"use client";

import { useShownCount } from "@/lib/counts";
import { toggleHolding, useAppState } from "@/lib/state";

/** 我有／想要，掛在版本上。owners、wanted 是資料庫總數（含自己），顯示由 useLiveCount 換算 */
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
        className={`hold${want ? " is-on" : ""}`}
        aria-pressed={ready ? want : undefined}
        onClick={() => toggleHolding("wanted", vkey)}
      >
        想要 <span className="num">{wantN}</span>
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
