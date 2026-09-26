// Workers 可用的雜湊與亂數：全部走 WebCrypto，不引外部套件。

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** 32 bytes → 43 字元，當 session token 與使用者 id */
export const randomToken = (n = 32) => b64url(randomBytes(n));

export async function sha256hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 6 位數，均勻分布（拒絕取樣避免模數偏差） */
export function sixDigitCode() {
  const max = 4_294_000_000; // 1_000_000 的倍數，≤ 2^32
  for (;;) {
    const [v] = crypto.getRandomValues(new Uint32Array(1));
    if (v < max) return String(v % 1_000_000).padStart(6, "0");
  }
}

/**
 * Cloudflare Workers 的 PBKDF2 上限是 100,000 次（超過直接丟 NotSupportedError，本機 dev 不會擋）。
 * 次數跟著雜湊字串存，之後平台放寬或換演算法時，登入成功再重新雜湊即可升級。
 */
export const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** iterations 由呼叫端給（正式環境可用環境變數 PBKDF2_ITERATIONS 調低，見 services.ts passwordIterations） */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS) {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${b64url(salt)}$${b64url(hash)}`;
}

/** 雜湊用的次數（登入成功時若跟設定不同就重新雜湊） */
export const hashIterations = (stored: string) => Number(stored.split("$")[1]) || 0;

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, fromB64url(salt), Number(iter));
  return equalBytes(got, fromB64url(hash));
}

/** 帳號不存在時也跑一次雜湊，讓回應時間看不出帳號在不在 */
export async function burnPasswordTime(password: string, iterations = PBKDF2_ITERATIONS) {
  await pbkdf2(password, randomBytes(16), iterations);
}
