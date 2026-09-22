"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Archive, ChevronRight, CirclePlus, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchBox } from "@/components/search-box";
import {
  FORMAT_CODE,
  getArtist,
  getWork,
  searchVersions,
  versionHref,
  versionKey,
} from "@/lib/data";

const FORMATS = ["全部", "CD", "黑膠", "卡帶", "影像"];

export function WorkIndex() {
  const params = useSearchParams();
  const query = params.get("q") ?? "";
  const [format, setFormat] = useState("全部");

  const results = useMemo(() => searchVersions(query, format), [query, format]);

  // 版本依作品分組，因為主要條目是作品
  const grouped = useMemo(() => {
    const map = new Map<string, typeof results>();
    for (const version of results) {
      const list = map.get(version.workSlug) ?? [];
      list.push(version);
      map.set(version.workSlug, list);
    }
    return [...map.entries()];
  }, [results]);

  return (
    <>
      <SearchBox defaultValue={query} />

      <div className="format-tabs" aria-label="依格式篩選">
        <span className="filter-label">
          <ListFilter aria-hidden="true" />
          格式
        </span>
        {FORMATS.map((item) => (
          <button
            key={item}
            type="button"
            className={format === item ? "format-tab is-selected" : "format-tab"}
            aria-pressed={format === item}
            onClick={() => setFormat(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="panel-heading">
        <h2>
          {query ? `「${query}」找到 ` : "共 "}
          {grouped.length} 件作品、{results.length} 個版本
        </h2>
      </div>

      {grouped.length ? (
        <div className="work-list">
          {grouped.map(([workSlug, workVersions]) => {
            const work = getWork(workSlug);
            const artist = work ? getArtist(work.artistSlug) : undefined;
            if (!work || !artist) return null;
            return (
              <section className="work-block" key={workSlug}>
                <header className="work-block-head">
                  <div>
                    <Link className="work-block-title" href={`/work/${work.slug}`}>
                      {work.title}
                    </Link>
                    <p className="work-block-meta">
                      {artist.name} · {work.workType} · {work.firstReleaseYear} ·{" "}
                      {workVersions.length} 個版本
                    </p>
                  </div>
                  <Link className="text-link" href={`/work/${work.slug}`}>
                    看作品條目
                    <ChevronRight aria-hidden="true" />
                  </Link>
                </header>

                <div className="release-grid">
                  {workVersions.map((version) => (
                    <Link
                      className="release-card"
                      key={versionKey(version)}
                      href={versionHref(version)}
                    >
                      <span className={`cover ${version.color}`} aria-hidden="true">
                        <span className="cover-format">
                          {FORMAT_CODE[version.format] ?? version.format}
                        </span>
                      </span>
                      <span className="release-copy">
                        <span className="release-artist">{version.versionType}</span>
                        <strong>{version.edition}</strong>
                        <span className="release-meta">
                          {version.year} · {version.region} · {version.format}
                        </span>
                        <span className="release-edition">{version.catalog}</span>
                      </span>
                      <ChevronRight className="card-chevron" aria-hidden="true" />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">
          <Archive aria-hidden="true" />
          <h3>沒有符合的版本</h3>
          <p>換個關鍵字試試。或者把你手上那件提出來，先進待確認清單。</p>
          <Button variant="outline">
            <CirclePlus aria-hidden="true" />
            提出候選版本
          </Button>
        </div>
      )}
    </>
  );
}
