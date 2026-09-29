"use client";

// 炫收藏多張照片（2026-09-28）：一則最多 10 張，第一張是封面。
// 一次選多張或分次加；每張在瀏覽器壓縮後各自上傳（同時最多 2 張），失敗的那張可以單獨重試。
// 換順序：直接拖（滑鼠拖、手指長按再拖），另有往前／往後／設為封面按鈕。

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/account";
import { uploadSharePhoto } from "@/lib/image";

export const MAX_PHOTOS = 10;

export type PickedPhoto = {
  key: string;
  /** 伺服器端照片 id（上傳完成才有） */
  id?: string;
  /** 顯示用小圖：本機 blob 或 /img/ 縮圖 */
  preview: string;
  /** 主圖網址（上傳完成才有；換封面時畫預覽圖用） */
  url?: string;
  file?: File;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  /** 已經掛在這則收藏上的（編輯模式）：刪掉時交給伺服器存檔時一起刪 */
  attached?: boolean;
};

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;

/** handle＝發文者帳號名，燒進浮水印用（2026-09-29）；還沒讀到帳號時照片先排隊不送 */
export function usePhotoPicker(initial: PickedPhoto[] = [], onPaused?: () => void, handle = "") {
  const [items, setItems] = useState<PickedPhoto[]>(initial);
  const [notice, setNotice] = useState("");
  const started = useRef(new Set<string>());
  const dropped = useRef(new Set<string>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patch = useCallback((key: string, p: Partial<PickedPhoto>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x))), []);

  // 上傳佇列：排隊中的依序送，同時最多 2 張
  useEffect(() => {
    if (!handle) return;
    const running = items.filter((x) => x.status === "uploading").length;
    const next = items.filter((x) => x.status === "queued" && !started.current.has(x.key)).slice(0, Math.max(0, 2 - running));
    for (const it of next) {
      started.current.add(it.key);
      patch(it.key, { status: "uploading", error: "" });
      void (async () => {
        let r: Awaited<ReturnType<typeof uploadSharePhoto>> | null = null;
        try {
          r = await uploadSharePhoto(it.file!, handle);
        } catch {
          r = null;
        }
        started.current.delete(it.key);
        if (dropped.current.has(it.key)) {
          // 上傳途中被刪掉：傳完馬上從伺服器刪掉，不留孤兒檔
          if (r?.ok) void api(`/api/uploads?id=${encodeURIComponent(r.data.id)}`, { method: "DELETE" });
          return;
        }
        if (!r) return patch(it.key, { status: "error", error: "這個檔案讀不出來，換一張" });
        if (r.ok) return patch(it.key, { status: "done", id: r.data.id, url: r.data.url });
        if (r.error.code === "STORAGE_FULL" || r.error.code === "UPLOAD_PAUSED") onPaused?.();
        patch(it.key, { status: "error", error: r.error.code === "STORAGE_FULL" ? "上傳暫停" : r.error.message });
      })();
    }
  }, [items, patch, onPaused, handle]);

  const add = (files: File[]) => {
    const room = MAX_PHOTOS - itemsRef.current.length;
    const take = files.filter((f) => f.type.startsWith("image/") || f.type === "").slice(0, Math.max(0, room));
    const over = files.length - take.length;
    setNotice(over > 0 ? `一則最多 ${MAX_PHOTOS} 張，有 ${over} 張沒加進來` : "");
    if (!take.length) return;
    setItems((xs) => [...xs, ...take.map((f) => ({ key: newKey(), preview: URL.createObjectURL(f), file: f, status: "queued" as const }))]);
  };

  const retry = (key: string) => {
    started.current.delete(key);
    patch(key, { status: "queued", error: "" });
  };

  const remove = (key: string) => {
    const it = itemsRef.current.find((x) => x.key === key);
    if (!it) return;
    if (it.status === "uploading") dropped.current.add(key);
    else if (it.id && !it.attached) void api(`/api/uploads?id=${encodeURIComponent(it.id)}`, { method: "DELETE" });
    setNotice("");
    setItems((xs) => xs.filter((x) => x.key !== key));
  };

  const move = (from: number, to: number) =>
    setItems((xs) => {
      if (to < 0 || to >= xs.length || from === to) return xs;
      const next = [...xs];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });

  /** 還沒掛上收藏的新照片（取消編輯時要刪） */
  const discardNew = () => {
    for (const it of itemsRef.current) {
      if (it.status === "uploading") dropped.current.add(it.key);
      else if (it.id && !it.attached) void api(`/api/uploads?id=${encodeURIComponent(it.id)}`, { method: "DELETE" });
    }
  };

  const pending = items.filter((x) => x.status === "queued" || x.status === "uploading").length;
  const failed = items.filter((x) => x.status === "error").length;
  const done = items.filter((x) => x.status === "done").length;
  return { items, add, retry, remove, move, discardNew, notice, pending, failed, done };
}

type Picker = ReturnType<typeof usePhotoPicker>;

/** 拖曳：滑鼠按住移動 4px 就開始；手指要長按 350ms（不然當成捲動頁面） */
function useDrag(picker: Picker, grid: React.RefObject<HTMLUListElement | null>) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const st = useRef<{ key: string; id: number; x: number; y: number; touch: boolean; active: boolean; timer?: number } | null>(null);
  const moveRef = useRef(picker.move);
  const itemsRef = useRef(picker.items);
  useEffect(() => {
    moveRef.current = picker.move;
    itemsRef.current = picker.items;
  });

  // 拖曳中擋掉手機捲動（touchmove 要非 passive 才能 preventDefault）
  useEffect(() => {
    const el = grid.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (st.current?.active) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, [grid]);

  const end = () => {
    if (st.current?.timer) window.clearTimeout(st.current.timer);
    st.current = null;
    setDragKey(null);
  };

  const over = (x: number, y: number) => {
    const s = st.current;
    if (!s?.active) return;
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-photo-key]");
    const to = hit ? itemsRef.current.findIndex((it) => it.key === hit.dataset.photoKey) : -1;
    const from = itemsRef.current.findIndex((it) => it.key === s.key);
    if (to >= 0 && from >= 0 && to !== from) moveRef.current(from, to);
  };

  const handlers = (key: string) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      const touch = e.pointerType !== "mouse";
      st.current = { key, id: e.pointerId, x: e.clientX, y: e.clientY, touch, active: false };
      if (touch) {
        st.current.timer = window.setTimeout(() => {
          if (!st.current || st.current.key !== key) return;
          st.current.active = true;
          setDragKey(key);
          navigator.vibrate?.(10);
        }, 350);
      }
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const s = st.current;
      if (!s || s.id !== e.pointerId) return;
      const dist = Math.hypot(e.clientX - s.x, e.clientY - s.y);
      if (!s.active) {
        if (s.touch) {
          if (dist > 10) end(); // 還沒長按到就移動＝在捲動頁面
          return;
        }
        if (dist < 4) return;
        s.active = true;
        setDragKey(key);
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }
      e.preventDefault();
      over(e.clientX, e.clientY);
    },
    onPointerUp: end,
    onPointerCancel: end,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  });

  return { dragKey, handlers };
}

export function PhotoPicker({ picker, labelId, paused, disabled }: { picker: Picker; labelId: string; paused: boolean; disabled?: boolean }) {
  const grid = useRef<HTMLUListElement>(null);
  const { dragKey, handlers } = useDrag(picker, grid);
  const { items } = picker;
  const room = MAX_PHOTOS - items.length;
  return (
    <div className="pp" data-testid="photo-picker">
      <ul className="pp-grid" ref={grid} aria-labelledby={labelId} hidden={!items.length}>
          {items.map((it, i) => (
            <li
              key={it.key}
              className={`pp-tile${dragKey === it.key ? " is-drag" : ""}${it.status === "error" ? " is-error" : ""}`}
              data-photo-key={it.key}
              data-testid="pp-tile"
              data-id={it.id ?? ""}
              data-status={it.status}
              {...handlers(it.key)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 本機 blob 預覽，next/image 用不上 */}
              <img src={it.preview} alt={`第 ${i + 1} 張`} draggable={false} />
              {i === 0 ? (
                <b className="pp-cover" data-testid="pp-cover-badge">
                  封面
                </b>
              ) : null}
              {it.status === "queued" || it.status === "uploading" ? (
                <span className="pp-state" role="status">
                  {it.status === "queued" ? "等待中" : "上傳中…"}
                </span>
              ) : null}
              {it.status === "error" ? (
                <span className="pp-state pp-err">
                  <span>{it.error || "上傳失敗"}</span>
                  <button type="button" className="pp-retry" onClick={() => picker.retry(it.key)} data-testid="pp-retry" disabled={paused}>
                    重試
                  </button>
                </span>
              ) : null}
              <span className="pp-bar">
                <button type="button" aria-label={`第 ${i + 1} 張往前移`} disabled={i === 0} onClick={() => picker.move(i, i - 1)} data-testid="pp-left">
                  ◀
                </button>
                {i > 0 ? (
                  <button type="button" aria-label={`第 ${i + 1} 張設為封面`} onClick={() => picker.move(i, 0)} data-testid="pp-cover">
                    設封面
                  </button>
                ) : null}
                <button type="button" aria-label={`第 ${i + 1} 張往後移`} disabled={i === items.length - 1} onClick={() => picker.move(i, i + 1)} data-testid="pp-right">
                  ▶
                </button>
                <button type="button" aria-label={`刪掉第 ${i + 1} 張`} onClick={() => picker.remove(it.key)} data-testid="pp-remove">
                  ×
                </button>
              </span>
            </li>
          ))}
      </ul>
      {paused ? (
        <p className="upload-paused" role="status" data-testid="upload-paused">
          上傳暫停
        </p>
      ) : room > 0 ? (
        <label className={items.length ? "drop drop-more" : "drop"}>
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-labelledby={labelId}
            disabled={disabled}
            data-testid="pp-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length) picker.add(files);
            }}
          />
          <span className="drop-text">{items.length ? `＋ 再加（還可以放 ${room} 張）` : `＋ 加照片（最多 ${MAX_PHOTOS} 張）`}</span>
        </label>
      ) : (
        <p className="pp-full" data-testid="pp-full">
          已經 {MAX_PHOTOS} 張，要換就先刪一張
        </p>
      )}
      <p className="pp-meta" role="status" data-testid="pp-progress">
        {picker.pending ? `上傳中 ${picker.done}／${items.length}` : ""}
        {picker.notice ? <span className="pp-notice">{picker.notice}</span> : null}
      </p>
      {items.length > 1 ? <p className="pp-hint">按住拖曳換位置，手機長按再拖</p> : null}
    </div>
  );
}
