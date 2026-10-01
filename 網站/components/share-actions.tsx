"use client";

import { useEffect, useRef, useState } from "react";

export type ShareInfo = { url: string; title: string; text: string };

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
export function CopyLink({ className = "btn btn-line" }: { className?: string } = {}) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyText(location.origin + location.pathname)) {
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    }
  };
  return (
    <button type="button" className={className} onClick={copy} data-testid="copy-link">
      <span aria-live="polite">{done ? "已複製連結" : "複製連結"}</span>
    </button>
  );
}

/** 單則頁：分享（手機原生選單／桌機小選單：複製連結、Facebook、Threads、LINE）。2026-09-28 拿掉「下載分享圖」 */
export function ShareActions({ info }: { info: ShareInfo }) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const close = () => setMenu(false);
  const ref = useDismiss(menu, close);
  const links = shareLinks(info);

  const onShare = async () => {
    if (nativeShareOK()) {
      try {
        await navigator.share({ title: info.title, text: info.text, url: info.url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // 其他錯誤（例如權限）改開小選單
      }
    }
    setMenu(!menu);
  };

  const onCopy = async () => {
    if (await copyText(info.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="share-tools" ref={ref}>
      <div className="share-btns">
        <button type="button" className="btn btn-line" aria-expanded={menu} onClick={onShare} data-testid="share-btn">
          分享
        </button>
      </div>
      {menu ? (
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
    </div>
  );
}
