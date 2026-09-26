// 維基式歷史頁的差異比對：先比段落（LCS），被改掉的段落再逐字比。純函式。

export type Piece = { t: "same" | "add" | "del"; s: string };
export type ParaDiff =
  | { t: "same"; s: string }
  | { t: "add"; s: string }
  | { t: "del"; s: string }
  | { t: "change"; pieces: Piece[] };

function lcs<T>(a: T[], b: T[]): Piece[] | { t: "same" | "add" | "del"; i: number }[] {
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: "same" | "add" | "del"; i: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: "same", i });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: "del", i: i++ });
    else out.push({ t: "add", i: j++ });
  }
  while (i < n) out.push({ t: "del", i: i++ });
  while (j < m) out.push({ t: "add", i: j++ });
  return out;
}

/** 逐字比；太長（兩邊相乘超過 400 萬）就整段換 */
export function diffChars(a: string, b: string): Piece[] {
  const A = Array.from(a);
  const B = Array.from(b);
  if (A.length * B.length > 4_000_000) return [{ t: "del", s: a }, { t: "add", s: b }];
  const ops = lcs(A, B) as { t: "same" | "add" | "del"; i: number }[];
  const out: Piece[] = [];
  for (const o of ops) {
    const ch = o.t === "add" ? B[o.i] : A[o.i];
    const last = out[out.length - 1];
    if (last && last.t === o.t) last.s += ch;
    else out.push({ t: o.t, s: ch });
  }
  return out;
}

export function diffParas(a: string[], b: string[]): ParaDiff[] {
  const ops = lcs(a, b) as { t: "same" | "add" | "del"; i: number }[];
  const raw: ParaDiff[] = ops.map((o) => (o.t === "add" ? { t: "add", s: b[o.i] } : { t: o.t, s: a[o.i] }));
  // 相鄰的「刪一段、加一段」視為改寫，逐字比
  const out: ParaDiff[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const next = raw[k + 1];
    if (cur.t === "del" && next?.t === "add") {
      out.push({ t: "change", pieces: diffChars(cur.s, next.s) });
      k++;
    } else out.push(cur);
  }
  return out;
}

/** 字數變化（顯示 +12／−3） */
export const charCount = (paras: string[]) => paras.reduce((n, p) => n + Array.from(p).length, 0);

/** textarea 內容 → 段落：空行分段，段內換行併成一行 */
export const toParas = (text: string) =>
  text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
