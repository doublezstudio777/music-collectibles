"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cropAvatar } from "@/lib/image";
import { loadImage } from "@/lib/watermark-burn";

/**
 * 大頭貼裁切視窗（2026-09-30，不加套件）。
 * - 正方形取景框，圓形遮罩、框外調暗（輸出仍是正方形，站上頭像直角顯示）
 * - 拖曳：Pointer Events，滑鼠與觸控同一套；縮放：手機雙指、桌機滑桿＋滾輪；鍵盤方向鍵移動、＋－縮放
 * - 預覽畫在取景框大小的 canvas 上，來源是縮到長邊 2048 的工作圖（4000px 照片在手機上每一格不必重畫整張原圖）；
 *   按確定時從原圖取那一塊正方形，輸出 256×256 WebP（lib/image.ts cropAvatar）。原圖不上傳
 * - 位置用「取景框中心對到原圖哪個點」記（原圖座標），縮放倍率 1＝短邊剛好塞滿取景框，最大 5 倍
 */

const WORK_EDGE = 2048;
const MAX_ZOOM = 5;

type Src = { img: HTMLImageElement; work: HTMLCanvasElement; w: number; h: number };
type View = { z: number; cx: number; cy: number };

/** 把中心點夾在「取景框不會露出照片外面」的範圍內 */
function clampView(v: View, w: number, h: number): View {
  const z = Math.min(MAX_ZOOM, Math.max(1, v.z));
  const half = Math.min(w, h) / z / 2;
  return { z, cx: Math.min(w - half, Math.max(half, v.cx)), cy: Math.min(h - half, Math.max(half, v.cy)) };
}

export function AvatarCropper({ file, onCancel, onDone, onError }: { file: File; onCancel: () => void; onDone: (b: Blob) => void; onError: () => void }) {
  const [src, setSrc] = useState<Src | null>(null);
  const [view, setView] = useState<View>({ z: 1, cx: 0, cy: 0 });
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  // 事件處理要讀最新值，用 ref 同步一份；呼叫端常傳行內函式，也放 ref 免得每次重畫都重讀檔
  const viewRef = useRef(view);
  const srcRef = useRef(src);
  const cb = useRef({ onCancel, onError });
  useEffect(() => {
    viewRef.current = view;
    srcRef.current = src;
    cb.current = { onCancel, onError };
  });

  // 讀檔、做工作圖
  useEffect(() => {
    let dead = false;
    loadImage(file)
      .then((img) => {
        if (dead) return;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) throw new Error("size");
        const k = Math.min(1, WORK_EDGE / Math.max(w, h));
        const work = document.createElement("canvas");
        work.width = Math.max(1, Math.round(w * k));
        work.height = Math.max(1, Math.round(h * k));
        const ctx = work.getContext("2d");
        if (!ctx) throw new Error("canvas");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, work.width, work.height);
        setSrc({ img, work, w, h });
        setView({ z: 1, cx: w / 2, cy: h / 2 });
      })
      .catch(() => {
        if (!dead) cb.current.onError();
      });
    return () => {
      dead = true;
    };
  }, [file]);

  // 取景框大小（CSS 決定，這裡量）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    setSize(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 開視窗：鎖背景捲動、Esc 取消、焦點放取景框
  useEffect(() => {
    document.body.classList.add("has-modal");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current.onCancel();
    };
    window.addEventListener("keydown", onKey);
    boxRef.current?.focus();
    return () => {
      document.body.classList.remove("has-modal");
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // 畫預覽
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !src || !size) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (c.width !== px) {
      c.width = px;
      c.height = px;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const k = src.work.width / src.w;
    const side = Math.min(src.w, src.h) / view.z;
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(src.work, (view.cx - side / 2) * k, (view.cy - side / 2) * k, side * k, side * k, 0, 0, px, px);
  }, [src, view, size]);

  /** 以取景框內某一點（CSS px）為中心換倍率並平移：那一點下面的照片位置不動，再跟著手指位移 */
  const move = useCallback((from: { x: number; y: number }, to: { x: number; y: number }, nz: number) => {
    const s = srcRef.current;
    const el = boxRef.current;
    if (!s || !el) return;
    const V = el.clientWidth;
    const v = viewRef.current;
    const scale = (z: number) => (V * z) / Math.min(s.w, s.h);
    const px = v.cx + (from.x - V / 2) / scale(v.z);
    const py = v.cy + (from.y - V / 2) / scale(v.z);
    const z = Math.min(MAX_ZOOM, Math.max(1, nz));
    const next = clampView({ z, cx: px - (to.x - V / 2) / scale(z), cy: py - (to.y - V / 2) / scale(z) }, s.w, s.h);
    viewRef.current = next;
    setView(next);
  }, []);

  // 拖曳與雙指：記住每根手指（或滑鼠）的位置，每次移動用「重心位移＋距離比例」一起算
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const centroid = () => {
    const a = [...pts.current.values()];
    const x = a.reduce((t, p) => t + p.x, 0) / a.length;
    const y = a.reduce((t, p) => t + p.y, 0) / a.length;
    const d = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0;
    return { x, y, d };
  };
  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try {
      boxRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // 指標已經不在（極少數瀏覽器在快速點擊時會丟錯），照樣記位置
    }
    pts.current.set(e.pointerId, local(e));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    e.preventDefault();
    const before = centroid();
    pts.current.set(e.pointerId, local(e));
    const after = centroid();
    const ratio = before.d > 0 && after.d > 0 ? after.d / before.d : 1;
    move(before, after, viewRef.current.z * ratio);
  };
  const onUp = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId);
  };

  // 滾輪縮放要擋掉頁面捲動，React 的 onWheel 是 passive，改自己掛
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const p = { x: e.clientX - r.left, y: e.clientY - r.top };
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      move(p, p, viewRef.current.z * Math.exp(-dy * 0.0015));
    };
    // iOS Safari 的雙指手勢事件會觸發整頁縮放，取景框裡擋掉（實際縮放走 Pointer Events）
    const stop = (e: Event) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", stop);
    el.addEventListener("gesturechange", stop);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", stop);
      el.removeEventListener("gesturechange", stop);
    };
  }, [move]);

  const center = () => {
    const V = boxRef.current?.clientWidth ?? 0;
    return { x: V / 2, y: V / 2 };
  };
  const zoomTo = (z: number) => move(center(), center(), z);
  const onKey = (e: React.KeyboardEvent) => {
    const c = center();
    const step = e.shiftKey ? 40 : 10;
    const k: Record<string, () => void> = {
      ArrowLeft: () => move(c, { x: c.x + step, y: c.y }, viewRef.current.z),
      ArrowRight: () => move(c, { x: c.x - step, y: c.y }, viewRef.current.z),
      ArrowUp: () => move(c, { x: c.x, y: c.y + step }, viewRef.current.z),
      ArrowDown: () => move(c, { x: c.x, y: c.y - step }, viewRef.current.z),
      "+": () => zoomTo(viewRef.current.z * 1.1),
      "=": () => zoomTo(viewRef.current.z * 1.1),
      "-": () => zoomTo(viewRef.current.z / 1.1),
    };
    if (k[e.key]) {
      e.preventDefault();
      k[e.key]();
    }
  };

  const confirm = async () => {
    if (!src || busy) return;
    setBusy(true);
    try {
      const side = Math.min(src.w, src.h) / view.z;
      const blob = await cropAvatar(src.img, view.cx - side / 2, view.cy - side / 2, side);
      onDone(blob);
    } catch {
      onError();
    }
  };

  return (
    <div className="modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title" data-testid="avatar-cropper">
      <div className="modal-box crop-box">
        <h2 className="auth-title" id="crop-title">
          裁切大頭貼
        </h2>
        <div
          ref={boxRef}
          className="crop-view"
          tabIndex={0}
          role="application"
          aria-label="拖曳調整位置，方向鍵移動，加號減號縮放"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          data-testid="crop-view"
          data-ready={src ? "1" : "0"}
          data-z={view.z.toFixed(3)}
          data-cx={view.cx.toFixed(1)}
          data-cy={view.cy.toFixed(1)}
        >
          <canvas ref={canvasRef} className="crop-canvas" aria-hidden="true" />
          <svg className="crop-mask" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 0H100V100H0Z M50 0A50 50 0 1 0 50 100A50 50 0 1 0 50 0Z" fillRule="evenodd" />
            <circle cx="50" cy="50" r="49.75" vectorEffect="non-scaling-stroke" />
          </svg>
          {src ? null : <p className="crop-wait">讀取照片中…</p>}
        </div>
        <label className="crop-zoom">
          <span className="sr-only">縮放</span>
          <span aria-hidden="true" className="crop-zoom-mark">－</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={view.z}
            disabled={!src}
            onChange={(e) => zoomTo(Number(e.target.value))}
            data-testid="crop-zoom"
          />
          <span aria-hidden="true" className="crop-zoom-mark">＋</span>
        </label>
        <div className="crop-acts">
          <button type="button" className="btn btn-line" onClick={onCancel} data-testid="crop-cancel">
            取消
          </button>
          <button type="button" className="btn btn-p" onClick={() => void confirm()} disabled={!src || busy} data-testid="crop-ok">
            {busy ? "處理中…" : "確定"}
          </button>
        </div>
      </div>
    </div>
  );
}
