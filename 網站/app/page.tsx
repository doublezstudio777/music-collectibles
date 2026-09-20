"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Archive, Bookmark, Camera, Check, ChevronRight, CirclePlus, Disc3, ListFilter, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Release = {
  id: string;
  artist: string;
  title: string;
  year: string;
  format: string;
  region: string;
  edition: string;
  catalog: string;
  status: "已確認" | "待確認";
  owners: number;
  wanted: number;
  color: string;
};

const releases: Release[] = [
  { id: "mountain-tw-cd", artist: "山線電台", title: "夜行採集", year: "2018", format: "CD", region: "台灣", edition: "首批紙套版", catalog: "ML-018-A", status: "已確認", owners: 18, wanted: 7, color: "cover-ink" },
  { id: "mountain-jp-cd", artist: "山線電台", title: "夜行採集", year: "2020", format: "CD", region: "日本", edition: "日版附側標", catalog: "MLJP-020", status: "已確認", owners: 6, wanted: 12, color: "cover-red" },
  { id: "tide-vinyl", artist: "潮汐公路", title: "島嶼低鳴", year: "2022", format: "黑膠", region: "台灣", edition: "透明海藍膠", catalog: "TS-022-LP", status: "已確認", owners: 11, wanted: 21, color: "cover-blue" },
  { id: "room-cassette", artist: "空房間", title: "留聲便條", year: "2017", format: "卡帶", region: "台灣", edition: "巡演限定版", catalog: "待查證", status: "待確認", owners: 3, wanted: 9, color: "cover-cream" },
  { id: "rain-live", artist: "雨停以前", title: "南方現場", year: "2021", format: "Blu-ray", region: "台灣", edition: "首批盒裝版", catalog: "RB-021-BD", status: "已確認", owners: 8, wanted: 5, color: "cover-night" },
  { id: "signal-ep", artist: "微光訊號", title: "凌晨四點", year: "2019", format: "CD", region: "台灣", edition: "電台宣傳片", catalog: "PROMO-04", status: "待確認", owners: 2, wanted: 16, color: "cover-signal" },
];

const filters = ["全部", "CD", "黑膠", "卡帶", "影像"];
const shares = [
  {
    id: "share-1",
    name: "小孟",
    initials: "孟",
    time: "今天",
    title: "終於把《夜行採集》的兩個 CD 版本放在一起了",
    story: "台灣首批是紙套，日本版多了側標，背面的公司資訊也不同。以前一直以為只是包裝差異，實際比過才發現品號完全不一樣。",
    release: "山線電台 · 夜行採集",
    meta: "2 個版本 · CD",
    image: true,
    reason: "因為你也收藏山線電台",
  },
  {
    id: "share-2",
    name: "阿澤",
    initials: "澤",
    time: "昨天",
    title: "這卷巡演卡帶沒有條碼，要從哪裡辨認？",
    story: "外盒只有場次貼紙和手寫編號。目前先放在待確認，希望有人能補另一卷實物照片一起比對。",
    release: "空房間 · 留聲便條",
    meta: "待確認候選版本 · 卡帶",
    image: false,
    reason: "因為你關注限定發行",
  },
  {
    id: "share-3",
    name: "安琪",
    initials: "安",
    time: "3 天前",
    title: "想找這張透明海藍膠的完整內容物",
    story: "手上的版本缺了內附小海報。想確認首批是否每張都有，再決定要找完整版本或單收小海報。",
    release: "潮汐公路 · 島嶼低鳴",
    meta: "透明海藍膠 · 黑膠",
    image: false,
    reason: "因為它在你的想要清單",
  },
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [view, setView] = useState<"feed" | "catalog">("feed");
  const [selectedId, setSelectedId] = useState(releases[0].id);
  const [owned, setOwned] = useState<string[]>([releases[0].id]);
  const [wanted, setWanted] = useState<string[]>([releases[2].id, releases[5].id]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return releases.filter((release) => {
      const matchesQuery = !normalized || [release.artist, release.title, release.edition, release.catalog].join(" ").toLowerCase().includes(normalized);
      const matchesFilter = filter === "全部" || release.format === filter || (filter === "影像" && ["DVD", "Blu-ray"].includes(release.format));
      return matchesQuery && matchesFilter;
    });
  }, [filter, query, view]);

  const selected = results.find((release) => release.id === selectedId) ?? results[0] ?? releases[0];
  const toggle = (id: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="回到版本目錄頂端">
          <span className="brand-mark"><Disc3 aria-hidden="true" /></span>
          <span>留聲冊</span>
        </a>
        <nav className="main-nav" aria-label="主要導覽">
          <a className="is-active" href="#discover">發現</a>
          <a href="#catalog">版本目錄</a>
          <a href="#collection">我的收藏</a>
        </nav>
        <Button className="rounded-full" variant="outline"><Camera aria-hidden="true" />拍照分享</Button>
      </header>

      <section className="catalog-shell" id="top">
        <div className="catalog-heading">
          <div>
            <p className="eyebrow">台灣音樂實體版本資料庫</p>
            <h1>看看別人怎麼收藏。</h1>
          </div>
          <p className="heading-note">從收藏者的實拍、故事與版本差異開始，再深入查資料、加入想要或分享自己的收藏。</p>
        </div>

        <div className="search-row" role="search">
          <Search className="search-icon" aria-hidden="true" />
          <Input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) setView("catalog"); }} className="search-input" placeholder="搜尋收藏分享、音樂人、作品或版本" aria-label="搜尋收藏與版本" />
          <Button className="search-button">搜尋目錄</Button>
        </div>

        {view === "catalog" && <div className="format-tabs" aria-label="依格式篩選">
          <span className="filter-label"><ListFilter aria-hidden="true" />格式</span>
          {filters.map((item) => (
            <button key={item} type="button" className={filter === item ? "format-tab is-selected" : "format-tab"} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>}

        <div className="view-switch" aria-label="選擇探索方式">
          <button type="button" className={view === "feed" && !query ? "view-option is-selected" : "view-option"} aria-pressed={view === "feed" && !query} onClick={() => { setView("feed"); setQuery(""); }}>
            <Sparkles aria-hidden="true" />收藏分享
          </button>
          <button type="button" className={view === "catalog" || !!query ? "view-option is-selected" : "view-option"} aria-pressed={view === "catalog" || !!query} onClick={() => setView("catalog")}>
            <Archive aria-hidden="true" />全部版本
          </button>
          {view === "feed" && !query && <span className="recommendation-basis">依你的收藏、關注與想要清單推薦分享</span>}
        </div>

        {view === "feed" && !query ? (
          <div className="discover-layout" id="discover">
            <section className="share-feed" aria-labelledby="share-feed-title">
              <div className="panel-heading"><div><p className="eyebrow">推薦動態</p><h2 id="share-feed-title">收藏者最近在分享</h2></div><span className="quiet-label">不是價格排行榜</span></div>
              {shares.map((share) => (
                <article className="share-card" key={share.id}>
                  <header className="share-author"><span className="avatar">{share.initials}</span><span><strong>{share.name}</strong><small>{share.time} · {share.reason}</small></span><Button variant="ghost" size="sm">關注</Button></header>
                  <div className={share.image ? "share-body has-image" : "share-body"}>
                    {share.image ? <div className="share-photo"><Image src="/images/fictional-music-collection.png" alt="虛構的音樂實體收藏組合" fill sizes="(max-width: 700px) 100vw, 420px" /></div> : <div className={`share-cover ${share.id}`} aria-hidden="true"><Disc3 /></div>}
                    <div className="share-copy"><h3>{share.title}</h3><p>{share.story}</p><button type="button" className="tagged-release"><span><strong>{share.release}</strong><small>{share.meta}</small></span><ChevronRight aria-hidden="true" /></button></div>
                  </div>
                  <footer className="share-actions"><button type="button">收藏這篇</button><button type="button">我也有</button><button type="button">加入想要</button></footer>
                </article>
              ))}
            </section>
            <aside className="invite-panel">
              <p className="eyebrow">讓第一批內容出現</p><h2>邀請你認識的收藏者</h2><p>拍下正面、背面與條碼，AI 先整理成草稿；收藏者只要確認資料，再補上一段故事。</p>
              <Button className="invite-button"><Camera aria-hidden="true" />拍照建立分享草稿</Button>
              <div className="invite-steps"><span><b>1</b>拍攝包裝與辨識線索</span><span><b>2</b>AI 整理欄位並比對版本</span><span><b>3</b>本人確認後才公開分享</span></div>
            </aside>
          </div>
        ) : <div className="workspace" id="catalog">
          <section className="results-panel" aria-labelledby="results-title">
            <div className="panel-heading">
              <div><p className="eyebrow">版本目錄</p><h2 id="results-title">找到 {results.length} 個版本</h2></div>
              <span className="quiet-label">依資料更新排序</span>
            </div>

            {results.length ? (
              <div className="release-grid">
                {results.map((release) => (
                  <button type="button" className={selected.id === release.id ? "release-card is-selected" : "release-card"} key={release.id} onClick={() => setSelectedId(release.id)} aria-pressed={selected.id === release.id}>
                    <span className={`cover ${release.color}`} aria-hidden="true"><span className="cover-disc" /></span>
                    <span className="release-copy">
                      <span className="release-artist">{release.artist}</span>
                      <strong>{release.title}</strong>
                      <span className="release-meta">{release.year} · {release.region} · {release.format}</span>
                      <span className="release-edition">{release.edition}</span>
                    </span>
                    <ChevronRight className="card-chevron" aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state"><Archive aria-hidden="true" /><h3>目錄裡還沒有符合的版本</h3><p>可以換個關鍵字，或先提交一筆待確認候選版本。</p><Button variant="outline"><CirclePlus aria-hidden="true" />提出候選版本</Button></div>
            )}
          </section>

          <aside className="detail-panel" aria-label="版本詳細資料">
            <div className="feature-image">
              <Image src="/images/fictional-music-collection.png" alt="虛構的黑膠、CD、卡帶與折頁收藏組合" fill sizes="(max-width: 900px) 100vw, 420px" priority />
              <span className="image-note"><Sparkles aria-hidden="true" />示意圖像</span>
            </div>
            <div className="detail-content">
              <div className="detail-status"><Badge variant={selected.status === "已確認" ? "default" : "secondary"}>{selected.status}</Badge><span>{selected.catalog}</span></div>
              <p className="detail-artist">{selected.artist}</p><h2>{selected.title}</h2><p className="detail-edition">{selected.edition}</p>
              <dl className="version-facts">
                <div><dt>發行年份</dt><dd>{selected.year}</dd></div><div><dt>發行地區</dt><dd>{selected.region}</dd></div>
                <div><dt>格式</dt><dd>{selected.format}</dd></div><div><dt>資料狀態</dt><dd>{selected.status}</dd></div>
              </dl>
              <div className="collection-actions" id="collection">
                <Button className="collection-button" variant={owned.includes(selected.id) ? "default" : "outline"} onClick={() => toggle(selected.id, owned, setOwned)}>{owned.includes(selected.id) ? <Check aria-hidden="true" /> : <Archive aria-hidden="true" />}{owned.includes(selected.id) ? "已在收藏" : "我有這個版本"}</Button>
                <Button className="collection-button" variant={wanted.includes(selected.id) ? "secondary" : "outline"} onClick={() => toggle(selected.id, wanted, setWanted)}><Bookmark aria-hidden="true" />{wanted.includes(selected.id) ? "已加入想要" : "加入想要清單"}</Button>
              </div>
              <div className="community-stats"><span><strong>{selected.owners}</strong> 人收藏</span><span><strong>{selected.wanted}</strong> 人想要</span></div>
            </div>
          </aside>
        </div>}

        <section className="contribution-strip" id="contribute">
          <div><p className="eyebrow">找不到手上的版本？</p><h2>拍幾張照片，先讓 AI 整理線索。</h2><p>辨識結果只會成為待確認草稿；你可以修正條碼、目錄號與包裝差異，再決定是否提出候選版本。</p></div>
          <Button size="lg"><Camera aria-hidden="true" />拍照輔助建檔</Button>
        </section>
      </section>
    </main>
  );
}
