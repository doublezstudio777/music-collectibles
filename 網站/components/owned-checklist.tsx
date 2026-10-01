"use client";

// 我收藏了哪些（2026-10-01 一次發多張）：勾了就是「我有」，點一下存一下（跟版本頁的我有按鈕同一支 API）。
// 勾完按「一起發文」把這次勾的帶去批次發文；這次沒勾新的就帶這位藝人全部勾著的。
// 不顯示完成度（不顯示分母、不列缺哪幾張）：使用者原話「我就是不一定要全部都有，我只喜歡某幾個而已」。

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { whenLoggedIn } from "@/lib/account";
import { toggleHolding, useAppState } from "@/lib/state";
import { artistHref, type Kind } from "@/lib/data";
import type { PickSeries } from "@/lib/catalog";
import { AddSeries, chipsOf, PickList, seriesOfKey, submitSeries, submitVersion, type NewSeries } from "@/components/pick-list";

export function OwnedChecklist({ artist, series: initial }: { artist: { slug: string; name: string; visible: boolean }; series: PickSeries[] }) {
  const router = useRouter();
  const { state, holds, me, ready } = useAppState();
  const [series, setSeries] = useState(initial);
  const fresh = useRef(new Set<string>());
  const [, bump] = useState(0);
  const mine = useMemo(() => new Set(series.map((w) => w.key)), [series]);
  // 這位藝人底下勾著的（照清單順序）
  const checked = useMemo(
    () => series.flatMap((w) => chipsOf(w).map((c) => c.key)).filter((k) => state.owned.includes(k) && mine.has(seriesOfKey(k))),
    [series, state.owned, mine],
  );

  const toggle = (key: string) => {
    const on = !holds("owned", key);
    toggleHolding("owned", key);
    if (on) fresh.current.add(key);
    else fresh.current.delete(key);
    bump((n) => n + 1);
  };
  const turnOn = (key: string) => {
    if (!holds("owned", key)) toggleHolding("owned", key);
    fresh.current.add(key);
    bump((n) => n + 1);
  };

  const addSeries = async (f: NewSeries) => {
    if (!me) {
      whenLoggedIn("登入後才能新增", () => undefined);
      return "先登入";
    }
    const w = await submitSeries(artist, f);
    if (typeof w === "string") return w;
    setSeries((xs) => [w, ...xs.filter((x) => x.key !== w.key)]);
    turnOn(w.key);
    return null;
  };

  const addVersion = async (seriesKey: string, f: { kind: Kind; edition: string; year: string }) => {
    if (!me) {
      whenLoggedIn("登入後才能新增", () => undefined);
      return "先登入";
    }
    const r = await submitVersion(series, seriesKey, f);
    if (typeof r === "string") return r;
    setSeries(r.series);
    turnOn(r.key);
    return null;
  };

  const post = () => {
    const pick = checked.filter((k) => fresh.current.has(k));
    const keys = pick.length ? pick : checked;
    router.push(`/share/batch?keys=${encodeURIComponent(keys.join(","))}`);
  };

  return (
    <>
      <header className="page-head own-head">
        <h1 className="page-title">我收藏的 {artist.name}</h1>
        {artist.visible ? (
          <p className="page-meta">
            <Link className="link" href={artistHref(artist.slug)}>
              回到 {artist.name}
            </Link>
          </p>
        ) : null}
      </header>
      {ready && !me ? (
        <p className="own-login" data-testid="own-login">
          <button type="button" className="btn btn-line" onClick={() => whenLoggedIn("登入後才能登記收藏", () => undefined)}>
            登入
          </button>
        </p>
      ) : null}
      <AddSeries onSave={addSeries} />
      {series.length ? <PickList series={series} isOn={(k) => holds("owned", k)} onToggle={toggle} onAddVersion={addVersion} testid="own-list" /> : <p className="empty">還沒有任何專輯</p>}
      <div className="own-bar" data-testid="own-bar">
        <span className="own-count" data-testid="own-count">
          {checked.length ? (
            <>
              勾了 <b className="num">{checked.length}</b> 張
            </>
          ) : (
            "還沒勾"
          )}
        </span>
        <Link className="btn btn-line" href={`/share/collection?artist=${artist.slug}`} data-testid="own-collection">
          發合集
        </Link>
        <button type="button" className="btn btn-p" disabled={!checked.length} onClick={post} data-testid="own-post">
          一起發文
        </button>
      </div>
    </>
  );
}
