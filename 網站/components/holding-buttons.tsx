"use client";

import { toggleHolding, useAppState } from "@/lib/state";

/** 我有／想要，掛在版本上。owners、wanted 是其他人的人數 */
export function HoldingButtons({ vkey, owners, wanted }: { vkey: string; owners: number; wanted: number }) {
  const { holds, ready } = useAppState();
  const own = holds("owned", vkey);
  const want = holds("wanted", vkey);
  return (
    <div className="holding">
      <button
        type="button"
        className={`hold${own ? " is-on" : ""}`}
        aria-pressed={ready ? own : undefined}
        onClick={() => toggleHolding("owned", vkey)}
      >
        我有 <span className="num">{owners + (own ? 1 : 0)}</span>
      </button>
      <button
        type="button"
        className={`hold${want ? " is-on" : ""}`}
        aria-pressed={ready ? want : undefined}
        onClick={() => toggleHolding("wanted", vkey)}
      >
        想要 <span className="num">{wanted + (want ? 1 : 0)}</span>
      </button>
    </div>
  );
}

/** 版本標題旁「N 人有這個版本」：持有數（其他人＋自己按了我有），跟我有按鈕同一個數字 */
export function OwnersCount({ vkey, owners }: { vkey: string; owners: number }) {
  const { holds } = useAppState();
  return (
    <span className="ver-owners" data-testid="ver-owners">
      <span className="num">{owners + (holds("owned", vkey) ? 1 : 0)}</span> 人有這個版本
    </span>
  );
}
