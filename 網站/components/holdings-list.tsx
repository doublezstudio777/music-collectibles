"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "@/components/link";
import type { HoldingView } from "@/lib/data";
import { api } from "@/lib/account";
import { useAppState } from "@/lib/state";
import { useIsSelf } from "@/components/self-only";

function Table({ rows }: { rows: HoldingView[] }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th className="col-cover">
            <span className="sr-only">封面</span>
          </th>
          <th>系列</th>
          <th>版本</th>
          <th className="hide-md">格式</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-key={r.key}>
            <td className="col-cover">
              <span className="cover cover-sm" />
            </td>
            <td>
              <Link className="link" href={r.href}>
                {r.title}
              </Link>
              <span className="sub">{r.artists}</span>
            </td>
            <td>
              {r.unsure ? <span className="sub-inline">{r.edition}</span> : r.edition}
              <span className="sub">{r.year}</span>
            </td>
            <td className="hide-md">{r.format}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * 我有依藝人分組（2026-10-01 一次發多張）：「我收藏的 Hyukoh：12 張」。
 * 只寫有幾張，不寫分母、不列缺哪幾張、不放進度條（使用者明確不要完成度）
 */
function OwnedGroups({ rows, isSelf, name }: { rows: HoldingView[]; isSelf: boolean; name: string }) {
  const groups = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; rows: HoldingView[] }>();
    for (const r of rows) {
      const slug = r.artistSlug ?? "";
      const g = m.get(slug) ?? { slug, name: r.artistName ?? r.artists, rows: [] };
      g.rows.push(r);
      m.set(slug, g);
    }
    return [...m.values()].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name, "zh-Hant"));
  }, [rows]);
  return (
    <>
      {groups.map((g) => (
        <div key={g.slug} className="own-group" data-artist={g.slug} data-testid="owned-group">
          <div className="own-group-head">
            <h3 className="own-group-title" data-testid="owned-group-title">
              {isSelf ? "我" : name}收藏的 {g.name}：<span className="num">{g.rows.length}</span> 張
            </h3>
            {isSelf && g.slug ? (
              <Link className="link" href={`/me/owned/${g.slug}`}>
                勾選
              </Link>
            ) : null}
          </div>
          <Table rows={g.rows} />
        </div>
      ))}
    </>
  );
}

/**
 * 個人頁的我有／想要，兩者都公開。別人看讀伺服器給的清單；本人看自己時跟著按鈕即時變，
 * 清單裡還沒有的鍵（剛勾的）另外跟 /api/holding-views 要顯示資料
 */
export function HoldingsList({
  handle,
  name,
  owned,
  wanted,
  views,
}: {
  handle: string;
  name: string;
  owned: string[];
  wanted: string[];
  /** 伺服器先算好的顯示列（這位會員目前的我有＋想要） */
  views: HoldingView[];
}) {
  const { state, ready } = useAppState();
  const { isSelf } = useIsSelf(handle);
  const [extra, setExtra] = useState<HoldingView[]>([]);
  const ownKeys = isSelf && ready ? state.owned : owned;
  const wantKeys = isSelf && ready ? state.wanted : wanted;
  const known = useMemo(() => new Map([...views, ...extra].map((v) => [v.key, v])), [views, extra]);

  // 本人剛勾的（伺服器清單裡沒有）：補要顯示資料
  const missing = [...ownKeys, ...wantKeys].filter((k) => !known.has(k));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    void api<{ views: HoldingView[] }>(`/api/holding-views?keys=${encodeURIComponent(missingKey)}`).then((r) => {
      if (r.ok) setExtra((xs) => [...xs, ...r.data.views.filter((v) => !xs.some((x) => x.key === v.key))]);
    });
  }, [missingKey]);

  const pick = (keys: string[]) => keys.map((k) => known.get(k)).filter((x): x is HoldingView => Boolean(x));
  const ownRows = pick(ownKeys);
  const wantRows = pick(wantKeys);

  return (
    <>
      <section className="block" id="owned">
        <h2 className="block-title">我有</h2>
        {ownRows.length ? <OwnedGroups rows={ownRows} isSelf={isSelf} name={name} /> : <p className="empty">還沒有標記</p>}
      </section>
      <section className="block" id="wanted">
        <h2 className="block-title">
          想要 <span className="count">{wantRows.length}</span>
        </h2>
        {wantRows.length ? <Table rows={wantRows} /> : <p className="empty">還沒有標記</p>}
      </section>
    </>
  );
}
