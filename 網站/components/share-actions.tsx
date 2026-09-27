"use client";

import { useEffect, useRef, useState } from "react";
import type { ShareParts } from "@/lib/data";
import { SHARE_IMAGE_SIZE, drawShareImage, type ShareImageKind } from "@/lib/share-image";
import { useAppState } from "@/lib/state";

/** 登入會員：取大圖來畫分享圖（同源 blob，不汙染 canvas）；401／429 或失敗回 null，改用縮圖 */
async function loadBig(src: string): Promise<HTMLImageElement | null> {
  try {
    const r = await fetch(src, { credentials: "same-origin" });
    if (!r.ok) return null;
    const url = URL.createObjectURL(await r.blob());
    const el = new window.Image();
    el.src = url;
    await el.decode();
    return el;
  } catch {
    return null;
  }
}

export type ShareInfo = { url: string; title: string; text: string; parts: ShareParts };

/** 各平台的分享網址（驗收也用這一份列出來） */
export const shareLinks = (info: Pick<ShareInfo, "url" | "title">) => ({
  facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(info.url)}`,
  threads: `https://www.threads.net/intent/post?text=${encodeURIComponent(`${info.title} ${info.url}`)}`,
  line: `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(info.url)}`,
});

/** 手機（觸控為主）而且瀏覽器有原生分享才叫原生選單；桌機一律用小選單 */
const nativeShareOK = () =>
  typeof navigator !== "undefined" && typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches;

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 非 https（例如用區網 IP 開）沒有 clipboard API，退回舊方法
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** 點外面或按 Esc 收起 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

/** 系列頁、藝人頁：複製這頁的網址（不帶 ?edit、#錨點） */
export function CopyLink() {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyText(location.origin + location.pathname)) {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }
  };
  return (
    <button type="button" className="btn btn-line" onClick={copy} data-testid="copy-link">
      <span aria-live="polite">{done ? "已複製連結" : "複製連結"}</span>
    </button>
  );
}

/** 單則頁：分享（手機原生選單／桌機小選單）＋下載分享圖 */
export function ShareActions({
  info,
  author,
  what,
  kind,
  kindNote,
  handle,
  mainImage,
}: {
  info: ShareInfo;
  author: string;
  /** 發文者帳號（分享圖的浮水印） */
  handle: string;
  /** 大圖網址：登入會員下載分享圖時用大圖畫，沒登入或拿不到就用頁面上的縮圖 */
  mainImage?: string;
  what: string;
  kind: string;
  kindNote?: string;
}) {
  const { me } = useAppState();
  const [menu, setMenu] = useState<"" | "share" | "image">("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<ShareImageKind | "">("");
  const [error, setError] = useState("");
  const close = () => setMenu("");
  const ref = useDismiss(Boolean(menu), close);
  const links = shareLinks(info);

  const onShare = async () => {
    setError("");
    if (nativeShareOK()) {
      try {
        await navigator.share({ title: info.title, text: info.text, url: info.url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // 其他錯誤（例如權限）改開小選單
      }
    }
    setMenu(menu === "share" ? "" : "share");
  };

  const onCopy = async () => {
    if (await copyText(info.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const makeImage = async (k: ShareImageKind) => {
    setBusy(k);
    setError("");
    try {
      let img = document.querySelector<HTMLImageElement>(".detail-photo img");
      if (img && !img.complete) await img.decode().catch(() => undefined);
      if (mainImage && me) {
        const big = await loadBig(mainImage);
        if (big) img = big;
      }
      const blob = await drawShareImage(
        { parts: info.parts, what, kind, kindNote, author, handle, url: info.url, photo: img && img.naturalWidth ? img : null },
        k,
      );
      const name = `yinzang-${info.url.split("/").pop()}-${k}.jpg`;
      const file = new File([blob], name, { type: "image/jpeg" });
      // 手機能分享檔案就直接叫出分享選單（IG 在裡面），不然下載
      if (nativeShareOK() && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          close();
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      close();
    } catch (e) {
      setError((e as Error).message === "fonts" ? "字型還沒載好，稍等幾秒再試一次" : "分享圖產生失敗，重新整理後再試一次");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="share-tools" ref={ref}>
      <div className="share-btns">
        <button type="button" className="btn btn-line" aria-expanded={menu === "share"} onClick={onShare} data-testid="share-btn">
          分享
        </button>
        <button
          type="button"
          className="btn btn-line"
          aria-expanded={menu === "image"}
          onClick={() => setMenu(menu === "image" ? "" : "image")}
          data-testid="share-image-btn"
        >
          下載分享圖
        </button>
      </div>
      {menu === "share" ? (
        <ul className="share-menu" data-testid="share-menu">
          <li>
            <button type="button" onClick={onCopy}>
              <span aria-live="polite">{copied ? "已複製連結" : "複製連結"}</span>
            </button>
          </li>
          <li>
            <a href={links.facebook} target="_blank" rel="noopener noreferrer" onClick={close}>
              Facebook
            </a>
          </li>
          <li>
            <a href={links.threads} target="_blank" rel="noopener noreferrer" onClick={close}>
              Threads
            </a>
          </li>
          <li>
            <a href={links.line} target="_blank" rel="noopener noreferrer" onClick={close}>
              LINE
            </a>
          </li>
        </ul>
      ) : null}
      {menu === "image" ? (
        <ul className="share-menu" data-testid="image-menu">
          {(Object.keys(SHARE_IMAGE_SIZE) as ShareImageKind[]).map((k) => (
            <li key={k}>
              <button type="button" onClick={() => makeImage(k)} disabled={Boolean(busy)} data-kind={k}>
                <span>{busy === k ? "產生中…" : SHARE_IMAGE_SIZE[k].label}</span>
                <span className="sub mono">
                  {SHARE_IMAGE_SIZE[k].w}×{SHARE_IMAGE_SIZE[k].h}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
