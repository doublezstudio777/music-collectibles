/**
 * 頭像（2026-09-28）：有大頭貼顯示 256px 正方形小圖，沒有就是原本的暱稱字樣頭像（黑底白字、取第一個字）。
 * 全站直角；圖片是裝飾，名字另外寫在旁邊，所以 alt 空白。
 */
export function Ava({ name, src, size = "sm" }: { name: string; src?: string | null; size?: "sm" | "lg" }) {
  const cls = `ava ava-${size}`;
  if (src) {
    const px = size === "lg" ? 80 : 24;
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`${cls} ava-img`} src={src} alt="" width={px} height={px} loading="lazy" decoding="async" />;
  }
  return (
    <span className={cls} aria-hidden="true">
      {Array.from(name)[0] ?? "?"}
    </span>
  );
}
