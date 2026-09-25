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
