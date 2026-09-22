"use client";

import Link from "next/link";
import { Archive, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCollection } from "@/lib/collection";
import {
  FORMAT_CODE,
  getArtist,
  getWork,
  shares,
  versionHref,
  versionKey,
  versions,
} from "@/lib/data";

function VersionRows({ keys }: { keys: string[] }) {
  const rows = keys
    .map((key) => versions.find((v) => versionKey(v) === key))
    .filter((v) => v !== undefined);

  if (!rows.length) {
    return <p className="section-note">還沒有項目。</p>;
  }

  return (
    <ul className="sibling-list">
      {rows.map((version) => {
        const work = getWork(version.workSlug);
        const artist = work ? getArtist(work.artistSlug) : undefined;
        if (!work || !artist) return null;
        return (
          <li key={versionKey(version)}>
            <Link href={versionHref(version)}>
              <span className={`cover cover-sm ${version.color}`} aria-hidden="true">
                <span className="cover-format">
                  {FORMAT_CODE[version.format] ?? version.format}
                </span>
              </span>
              <span className="needs-help-copy">
                <strong>{work.title}</strong>
                <small>
                  {artist.name} · {version.edition}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function MyCollection() {
  const { state, ready } = useCollection();

  if (!ready) {
    return <p className="quiet-label">載入中</p>;
  }

  const savedShares = shares.filter((s) => state.saved.includes(s.id));
  const total = state.owned.length + state.wanted.length + state.saved.length;

  if (total === 0) {
    return (
      <div className="empty-state">
        <Archive aria-hidden="true" />
        <h3>還沒有收藏</h3>
        <p>去作品頁找到你手上那個版本，按「我有這個版本」就會出現在這裡。</p>
        <Button variant="outline" asChild>
          <Link href="/work">瀏覽作品</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="my-collection">
      <section>
        <div className="panel-heading">
          <h2>我有（{state.owned.length}）</h2>
        </div>
        <VersionRows keys={state.owned} />
      </section>

      <section>
        <div className="panel-heading">
          <h2>我想要（{state.wanted.length}）</h2>
        </div>
        <VersionRows keys={state.wanted} />
      </section>

      <section>
        <div className="panel-heading">
          <h2>已儲存的分享（{savedShares.length}）</h2>
          <span className="quiet-label">留著以後看，不表示持有</span>
        </div>
        {savedShares.length ? (
          <ul className="saved-list">
            {savedShares.map((share) => {
              const version = versions.find((v) => v.slug === share.versionSlug);
              const work = version ? getWork(version.workSlug) : undefined;
              if (!version || !work) return null;
              return (
                <li key={share.id}>
                  <Link href={versionHref(version)}>
                    <strong>{share.title}</strong>
                    <small>
                      {share.authorName} · {work.title} {version.edition}
                    </small>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="section-note">還沒有儲存任何分享。</p>
        )}
      </section>
    </div>
  );
}
