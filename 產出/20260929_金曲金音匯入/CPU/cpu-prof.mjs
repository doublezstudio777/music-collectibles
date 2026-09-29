// 本機 Worker CPU：連 wrangler dev 的 inspector，Profiler 取樣，每個網址打 N 次（帶不同查詢字串繞過整頁快取）
// 用法：node cpu-prof.mjs <base> <N> <path...>
import { createRequire } from "node:module";
const require = createRequire("/home/dz/AboutAI/專案/music-collectibles/網站/package.json");
const WebSocket = require("ws");
const [base, nStr, ...paths] = process.argv.slice(2);
const N = Number(nStr);
const list = await (await fetch("http://127.0.0.1:9230/json")).json();
const ws = new WebSocket(list[0]?.webSocketDebuggerUrl ?? "ws://127.0.0.1:9230/ws");
await new Promise((r) => ws.on("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (m) => {
  const d = JSON.parse(m);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d.result);
    pending.delete(d.id);
  }
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });
for (const p of paths) {
  // 先暖一次（isolate 內容目錄記憶體快取建好，量的是「整頁快取沒命中、目錄已在記憶體」與第一次）
  await send("Profiler.start");
  const t0 = Date.now();
  let status = 0;
  for (let k = 0; k < N; k++) {
    const r = await fetch(`${base}${p}${p.includes("?") ? "&" : "?"}_cpu=${Date.now()}${k}`, { headers: { "user-agent": "Mozilla/5.0 cpu-prof" } });
    status = r.status;
    await r.arrayBuffer();
  }
  const { profile } = await send("Profiler.stop");
  const idle = new Set(profile.nodes.filter((n) => ["(idle)", "(program)", "(garbage collector)"].includes(n.callFrame.functionName) && n.callFrame.functionName === "(idle)").map((n) => n.id));
  let busy = 0;
  profile.samples.forEach((s, i) => {
    if (!idle.has(s)) busy += profile.timeDeltas[i] ?? 0;
  });
  console.log(`${p} status=${status} 每請求非閒置 ${(busy / 1000 / N).toFixed(2)} ms（${N} 次，牆鐘 ${Date.now() - t0}ms）`);
}
ws.close();
