"use client";

import Link from "next/link";
import type { HoldingView } from "@/lib/data";
import { useAppState } from "@/lib/state";

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
          <th className="hide-md">目錄號</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
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
              {r.edition}
              <span className="sub">{r.year}</span>
            </td>
            <td className="hide-md">{r.format}</td>
            <td className="hide-md mono">{r.catalog}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 個人頁的我有／想要，兩者都公開。本人的清單讀本機狀態，別人讀示範資料 */
export function HoldingsList({
  isSelf,
  owned,
  wanted,
  catalog,
}: {
  isSelf: boolean;
  owned: string[];
  wanted: string[];
  catalog: HoldingView[];
}) {
  const { state, ready } = useAppState();
  if (isSelf && !ready) return null;
  const pick = (keys: string[]) =>
    keys.map((k) => catalog.find((c) => c.key === k)).filter((x): x is HoldingView => Boolean(x));
  const ownRows = pick(isSelf ? state.owned : owned);
  const wantRows = pick(isSelf ? state.wanted : wanted);

  return (
    <>
      <section className="block" id="owned">
        <h2 className="block-title">
          我有 <span className="count">{ownRows.length}</span>
        </h2>
        {ownRows.length ? <Table rows={ownRows} /> : <p className="empty">還沒有標記</p>}
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
