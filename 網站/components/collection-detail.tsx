"use client";

// 全家福合集的單則頁（2026-10-01 一次發多張）：大合照（照原比例，上面有號碼標記）＋說明＋專輯清單。
// 純展示：沒有交易區、沒有出價。發文者本人多兩件事：
// - 「把這些登記成我有」：清單全部一次登記（等於一次勾選「我收藏了哪些」）
// - 「挑幾張單獨發文」：勾幾張帶去批次發文（專輯已經選好，只要補照片）

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { Ava } from "@/components/ava";
import { LikeButton } from "@/components/like-button";
import { LevelTag } from "@/components/level-tag";
import { DmButton } from "@/components/dm-button";
import { ShareActions, type ShareInfo } from "@/components/share-actions";
import { TagList } from "@/components/share-card";
import { AppealBox } from "@/components/report";
import { EditedTime, Lightbox } from "@/components/share-detail";
import { CollectionPhoto } from "@/components/collection-photo";
import { addOwnedMany, whenLoggedIn } from "@/lib/account";
import { useAppState } from "@/lib/state";
import { userHref, verifyHref, type CollectionTagView, type ShareView } from "@/lib/data";

export function CollectionDetail({ share, shareInfo }: { share: ShareView; shareInfo: ShareInfo | null }) {
  const router = useRouter();
  const { me, ready, holds } = useAppState();
  const mine = Boolean(me) && share.author.handle === me?.handle;
  const lock = share.lock;
  const gallery = share.collection?.gallery ?? [];
  const tags = share.collection?.tags ?? [];
  const [active, setActive] = useState<string | null>(null);
  const [big, setBig] = useState<number | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  // 登入者看大圖（長邊 1600），訪客看縮圖；大圖載入失敗（每日上限）退回縮圖。伺服器輸出一律縮圖
  const hi = ready && Boolean(me);
  const srcOf = (p: { image: string; thumb: string }) => (hi && !failed.includes(p.image) ? p.image : p.thumb);
  const num = new Map(tags.map((t, i) => [t.key, i + 1]));
  const ownedAll = ready && tags.length > 0 && tags.every((t) => holds("owned", t.key));

  const focus = (key: string) => {
    setActive(key);
    document.getElementById(`ct-${num.get(key)}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const registerAll = () =>
    whenLoggedIn("登入後才能登記收藏", async () => {
      setBusy(true);
      setMsg("");
      const r = await addOwnedMany(tags.map((t) => t.key));
      setBusy(false);
      setMsg(r.ok ? `已登記 ${r.added.length} 張到「我有」${r.missing.length ? `，${r.missing.length} 張找不到了` : ""}` : r.message);
    });

  const togglePick = (key: string) => setPicked((xs) => (xs.includes(key) ? xs.filter((x) => x !== key) : [...xs, key]));
  const postPicked = () => router.push(`/share/batch?keys=${encodeURIComponent(picked.join(","))}&from=${share.n}`);

  return (
    <div className="detail collection" data-post="collection">
      <div className="detail-photo cphotos">
        {gallery.map((p, i) => (
          <figure key={p.thumb} className="cphoto-fig">
            <CollectionPhoto
              src={srcOf(p)}
              w={p.w}
              h={p.h}
              alt={`${share.what}，${share.author.name}的收藏合照${gallery.length > 1 ? `（第 ${i + 1} 張，共 ${gallery.length} 張）` : ""}`}
              pins={tags.flatMap((t) => (t.photo === i && t.x !== undefined && t.y !== undefined ? [{ n: num.get(t.key)!, x: t.x, y: t.y, key: t.key }] : []))}
              active={active}
              onPin={focus}
              onError={() => srcOf(p) !== p.thumb && setFailed((xs) => [...xs, p.image])}
            />
            <figcaption className="cphoto-cap">
              {!lock && p.code ? (
                <span className="photo-code" data-testid="photo-code">
                  查證碼 <a href={verifyHref(p.code)}>#{p.code}</a>
                </span>
              ) : null}
              <button
                type="button"
                className="btn-text cphoto-open"
                aria-label={gallery.length > 1 ? `看第 ${i + 1} 張大圖` : "看大圖"}
                onClick={() => whenLoggedIn("登入後可以點開大圖", () => setBig(i))}
                data-testid="cphoto-open"
              >
                看大圖
              </button>
            </figcaption>
          </figure>
        ))}
        {big !== null ? <Lightbox list={gallery.map((p) => p.image)} start={big} alt={share.what} onClose={() => setBig(null)} /> : null}
      </div>
      <div className="detail-info">
        {lock ? (
          <div className="lock-banner" role="status" data-target={lock.target}>
            <b>{lock.label}</b>
            <span>內容照常可看</span>
          </div>
        ) : null}
        {lock && mine ? <AppealBox target={lock.target} /> : null}
        {/* 自動標題本來就寫「合集 N 張」；發文者自己改了標題才另外標 */}
        <p className="collection-kind" data-testid="collection-kind" hidden={share.what.includes(`合集 ${tags.length} 張`)}>
          合集<span className="dot" aria-hidden="true">·</span>
          <span className="num">{tags.length}</span> 張
        </p>
        <h1 className="page-title">{share.what}</h1>
        <div className="detail-by">
          <Link className="who" href={userHref(share.author.handle)}>
            <Ava name={share.author.name} src={share.author.avatar} />
            <span className="who-name">{share.author.name}</span>
          </Link>
          <LevelTag badge={share.author.badge} />
          <span className="when">{share.time}</span>
          <LikeButton n={share.n} base={share.likes} large />
        </div>
        {share.editedAt ? (
          <p className="sub edited-at" data-testid="edited-at">
            最後編輯於 <EditedTime iso={share.editedAt} />
          </p>
        ) : null}
        {mine && ready ? (
          <div className="owner-box collection-owner" data-testid="collection-owner">
            <div className="owner-top">
              <span className="owner-status">
                <span className="sub">你的合集</span>
              </span>
              {lock ? null : (
                <Link className="btn btn-line" href={`/share/${share.n}/edit`} data-testid="share-edit-open">
                  編輯
                </Link>
              )}
            </div>
            <div className="collection-acts">
              <button type="button" className="btn btn-line" onClick={registerAll} disabled={busy || ownedAll} data-testid="collection-own-all">
                {ownedAll ? "都已登記成我有" : "把這些登記成我有"}
              </button>
              <button
                type="button"
                className="btn btn-line"
                aria-pressed={picking}
                onClick={() => {
                  setPicking((x) => !x);
                  setPicked([]);
                }}
                data-testid="collection-pick"
              >
                {picking ? "取消挑選" : "挑幾張單獨發文"}
              </button>
            </div>
            {msg ? (
              <p className="field-ok" role="status" data-testid="collection-msg">
                {msg}
              </p>
            ) : null}
          </div>
        ) : null}
        {shareInfo && !lock ? <ShareActions info={shareInfo} /> : null}
        {ready && !mine ? (
          <div className="dm-row">
            <DmButton to={{ share: share.n }} label="私訊" testid="dm-share" />
          </div>
        ) : null}
        {share.story ? <p className="prose">{share.story}</p> : null}
        <TagList about={share.about} tags={share.tags} links={share.tagLinks} />
        <TagRows tags={tags} active={active} setActive={setActive} picking={picking} picked={picked} togglePick={togglePick} />
        {picking ? (
          <div className="collection-pickbar" data-testid="collection-pickbar">
            <span>
              挑了 <b className="num">{picked.length}</b> 張
            </span>
            <button type="button" className="btn btn-p" disabled={!picked.length} onClick={postPicked} data-testid="collection-post-picked">
              單獨發文
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TagRows({
  tags,
  active,
  setActive,
  picking,
  picked,
  togglePick,
}: {
  tags: CollectionTagView[];
  active: string | null;
  setActive: (k: string | null) => void;
  picking: boolean;
  picked: string[];
  togglePick: (k: string) => void;
}) {
  return (
    <section className="ctags" aria-labelledby="ctags-title">
      <h2 className="block-title" id="ctags-title">
        合集裡的專輯 <span className="count">{tags.length}</span>
      </h2>
      <ol className="ctag-list" data-testid="ctag-list">
        {tags.map((t, i) => (
          <li key={t.key} id={`ct-${i + 1}`} className={`ctag${active === t.key ? " is-on" : ""}`} data-key={t.key} data-testid="ctag">
            {picking ? (
              <input type="checkbox" className="ctag-check" checked={picked.includes(t.key)} onChange={() => togglePick(t.key)} aria-label={`挑 ${t.label}`} data-testid="ctag-check" />
            ) : null}
            <button
              type="button"
              className={t.photo !== undefined ? "ctag-n is-pinned" : "ctag-n"}
              onClick={() => setActive(active === t.key ? null : t.key)}
              aria-label={t.photo !== undefined ? `在照片上標出第 ${i + 1} 張` : `第 ${i + 1} 張`}
              disabled={t.photo === undefined}
            >
              {i + 1}
            </button>
            <span className="ctag-text">
              <Link className="link ctag-album" href={t.href}>
                {t.artist}《{t.album}》
              </Link>
              <span className="ctag-ver">{t.version}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
