/**
 * 頂端頭像裡的暱稱（2026-09-28 使用者指定規則）。
 * 字寬：英文、數字與其他半形字元算 0.5，中日韓與其他全形字元算 1。
 * - 字寬 ≤ 4：正常字級，全名（超過 2 就排成兩行，40×40 的框才放得下）
 * - 4 < 字寬 ≤ 6：縮小字級，全名分兩行
 * - 字寬 > 6：取前 4 個字寬，後面加「…」，縮小字級分兩行
 */
export type AvatarLabel = { lines: string[]; size: "normal" | "small" };

const charWidth = (ch: string) => ((ch.codePointAt(0) ?? 0) < 0x2e80 && !/[ᄀ-ᅟ]/.test(ch) ? 0.5 : 1);

export const nameWidth = (name: string) => Array.from(name).reduce((w, ch) => w + charWidth(ch), 0);

/** 依字寬切兩行，第一行拿到一半（含）以上 */
function split(chars: string[]): string[] {
  const total = chars.reduce((w, ch) => w + charWidth(ch), 0);
  let w = 0;
  let i = 0;
  while (i < chars.length && w < total / 2) w += charWidth(chars[i++]);
  const a = chars.slice(0, i).join("");
  const b = chars.slice(i).join("");
  return b ? [a, b] : [a];
}

export function avatarLabel(raw: string): AvatarLabel {
  const chars = Array.from(raw.trim() || "我");
  const w = nameWidth(chars.join(""));
  if (w <= 2) return { lines: [chars.join("")], size: "normal" };
  if (w <= 4) return { lines: split(chars), size: "normal" };
  if (w <= 6) return { lines: split(chars), size: "small" };
  const head: string[] = [];
  let used = 0;
  for (const ch of chars) {
    if (used + charWidth(ch) > 4) break;
    head.push(ch);
    used += charWidth(ch);
  }
  return { lines: split([...head, "…"]), size: "small" };
}
