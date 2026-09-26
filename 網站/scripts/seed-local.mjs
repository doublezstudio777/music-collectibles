// 本機示範資料 seed：帳號、內容（藝人、系列、品項、版本、正版辨識、已知仿冒、炫收藏）、
// 出價與私訊、檢舉、申訴，全部來自 scripts/demo-data.ts，寫進「本機」D1（照片寫進本機 R2 模擬）。
//
// 規則（第 2 階段技術設計第十二節）：示範資料只准走這支腳本，絕不寫進 drizzle/ 的正式遷移；
// 這支只接受本機（寫死 --local，沒有 --remote 的路），正式資料庫永遠不會有假帳號、假內容。
// 可重跑：INSERT OR IGNORE（明確給 id），不覆蓋已經存在的列。
//
// 用法：npm run db:migrate:local && npm run db:seed:local
// 示範帳號登入：{帳號}@demo.yinzang.test ／ 密碼 yinzang-demo（阿凱 kai 是未驗證 Email 的示範）
// 測試管理員：admin@demo.yinzang.test ／ yinzang-demo（名單在 vite.config.ts 的 ADMIN_EMAILS）
// 另外有 12 個「路人」帳號（r01～r12）只用來湊示範檢舉數。
//
// 參數：--persist-to <資料夾>（預設 .wrangler/state；驗收用空資料庫時指到暫存資料夾）

import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.argv.includes("--remote")) {
  console.error("seed 只准跑本機，拒絕 --remote");
  process.exit(1);
}
const pi = process.argv.indexOf("--persist-to");
const persist = pi > 0 ? process.argv[pi + 1] : ".wrangler/state";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const demo = await import("./demo-data.ts");
const { normKind } = await import("../lib/data.ts");
const { hashPassword } = await import("../lib/server/crypto.ts");

const q = (v) => (v === null || v === undefined ? "NULL" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const ins = (table, row) =>
  `INSERT OR IGNORE INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).map(q).join(", ")});`;
const nowMs = Date.now();
const iso = (hoursAgo) => new Date(nowMs - hoursAgo * 3600_000).toISOString();
const lines = [];
const uid = (handle) => `demo-${handle}`;

/* ---------- 帳號 ---------- */
const pw = await hashPassword("yinzang-demo");
const extra = [
  { handle: "yzadmin", name: "音藏管理員", bio: "本機測試管理員", verified: true, email: "admin@demo.yinzang.test" },
  ...Array.from({ length: 12 }, (_, i) => {
    const h = `r${String(i + 1).padStart(2, "0")}`;
    return { handle: h, name: `路人${h.slice(1)}`, bio: "示範檢舉用", verified: true };
  }),
];
for (const u of [...demo.users, ...extra]) {
  lines.push(
    ins("users", {
      id: uid(u.handle),
      email: u.email ?? `${u.handle}@demo.yinzang.test`,
      email_verified_at: u.verified ? iso(24 * 30) : null,
      password_hash: pw,
      handle: u.handle,
      name: u.name,
      bio: u.bio,
    }),
  );
}
for (const u of demo.users) {
  for (const n of u.liked) lines.push(ins("likes", { user_id: uid(u.handle), share_no: n }));
  for (const k of u.owned) lines.push(ins("holdings", { user_id: uid(u.handle), kind: "owned", target_key: k }));
  for (const k of u.wanted) lines.push(ins("holdings", { user_id: uid(u.handle), kind: "wanted", target_key: k }));
  for (const s of u.follows) lines.push(ins("follows", { user_id: uid(u.handle), artist_slug: s }));
}

/* ---------- 內容 ---------- */
for (const a of demo.artists) {
  lines.push(
    `INSERT OR IGNORE INTO artists (slug, name, aliases, kind, gender, region, tagline, intro, awards, status, created_by, last_edit_by) VALUES (` +
      [a.slug, a.name, JSON.stringify(a.aliases), a.kind, a.gender ?? null, a.region ?? null, a.tagline, JSON.stringify(a.intro), JSON.stringify(a.awards), "approved", uid("aze"), uid("aze")]
        .map(q)
        .join(", ") +
      `);`,
  );
}
let seriesId = 0;
let itemRef = 0;
let versionRef = 0;
for (const w of demo.seriesList) {
  seriesId += 1;
  lines.push(
    ins("series", {
      id: seriesId,
      artist_slug: w.artistSlug,
      no: w.no,
      title: w.title,
      name: w.name,
      series_type: w.seriesType,
      credits: JSON.stringify(w.credits),
      year: w.year,
      body: JSON.stringify(w.body),
      guests: JSON.stringify(w.guests),
      compilation: JSON.stringify(w.compilation),
      status: "approved",
      created_by: uid("aze"),
    }),
  );
  w.items.forEach((it, ii) => {
    itemRef += 1;
    lines.push(ins("items", { id: itemRef, series_id: seriesId, item_id: it.id, kind: it.kind, sort: ii, status: "approved", created_by: uid("aze") }));
    it.versions.forEach((v, vi) => {
      versionRef += 1;
      lines.push(
        ins("versions", {
          id: versionRef,
          item_ref: itemRef,
          version_id: v.id,
          edition: v.edition,
          year: v.year,
          region: v.region,
          label: v.label,
          catalog: v.catalog,
          barcode: v.barcode,
          packaging: v.packaging,
          contents: v.contents,
          tracks: v.tracks,
          identify_by: v.identifyBy,
          data_status: v.status,
          color: v.color,
          sort: vi,
          status: "approved",
          created_by: uid("aze"),
        }),
      );
      (v.marks ?? []).forEach((m, mi) =>
        lines.push(ins("version_marks", { id: versionRef * 100 + mi, version_ref: versionRef, label: m.label, text: m.text, photo_note: m.photo ?? null, sort: mi })),
      );
      (v.fakes ?? []).forEach((f, fi) =>
        lines.push(ins("version_fakes", { id: versionRef * 100 + fi, version_ref: versionRef, name: f.name, seen: f.seen, rows: JSON.stringify(f.rows), sort: fi })),
      );
    });
  });
}

const maxOrder = Math.max(...demo.shares.map((s) => s.order));
for (const s of demo.shares) {
  const k = normKind(s.kind);
  const sale = s.sale ?? { state: "share" };
  lines.push(
    ins("shares", {
      no: s.n,
      author_id: uid(s.author),
      what: s.what,
      kind: k.kind,
      kind_note: k.note ?? null,
      story: s.story,
      about: JSON.stringify(s.about),
      tags: JSON.stringify(s.tags),
      series_key: s.link?.series ?? null,
      item_id: s.link?.item ?? null,
      version_id: s.link?.version ?? null,
      ref_photo: s.refPhoto ? 1 : 0,
      color: s.color,
      sale_state: sale.state,
      price: sale.price ?? null,
      sold_price: sale.soldPrice ?? null,
      sold_to: sale.soldTo ? uid(sale.soldTo) : null,
      sold_at: sale.state === "sold" ? iso(24 * 7) : null,
      created_at: iso((maxOrder - s.order) * 3 + 1),
    }),
  );
}

// 第 1 則的示範照片：本機 R2 放一張（主圖與縮圖同一個檔）
const photoFile = join(root, "public/images/fictional-music-collection.jpg");
const photoKey = "p/demo-share-1.jpg";
lines.push(
  ins("photos", {
    id: "demo-share-1",
    owner_id: uid("xiaomeng"),
    purpose: "share",
    share_no: 1,
    r2_key: photoKey,
    thumb_key: photoKey,
    content_type: "image/jpeg",
    bytes: statSync(photoFile).size,
    width: 0,
    height: 0,
  }),
);
lines.push(`INSERT OR IGNORE INTO counters (key, value) VALUES ('r2_bytes', 0);`);
lines.push(`UPDATE counters SET value = (SELECT COALESCE(SUM(bytes), 0) FROM photos WHERE deleted_at IS NULL) WHERE key = 'r2_bytes';`);

/* ---------- 出價與私訊 ---------- */
const authorOf = new Map(demo.shares.map((s) => [s.n, s.author]));
let threadId = 0;
let offerId = 0;
let msgId = 0;
demo.threads.forEach((t, ti) => {
  threadId += 1;
  const base = (demo.threads.length - ti) * 5 + 2;
  lines.push(ins("threads", { id: threadId, share_no: t.n, buyer_id: uid(t.buyer), created_at: iso(base), updated_at: iso(base - 1) }));
  let last = 0;
  t.messages.forEach((m, mi) => {
    msgId += 1;
    last = msgId;
    const at = iso(base - mi * 0.2);
    let oid = null;
    if (m.offer) {
      offerId += 1;
      oid = offerId;
      lines.push(
        ins("offers", {
          id: offerId,
          share_no: t.n,
          buyer_id: uid(t.buyer),
          thread_id: threadId,
          kind: m.offer.kind,
          price: m.offer.price,
          status: m.offer.status,
          created_at: at,
        }),
      );
    }
    lines.push(ins("messages", { id: msgId, thread_id: threadId, from_id: m.from === "system" ? null : uid(m.from), text: m.text ?? null, offer_id: oid, created_at: at }));
  });
  // 已讀：示範的未讀只有 1-aze（賣家小孟還沒看）
  lines.push(ins("thread_reads", { thread_id: threadId, user_id: uid(t.buyer), last_message_id: last }));
  if (!demo.UNREAD_SEED.includes(t.id)) lines.push(ins("thread_reads", { thread_id: threadId, user_id: uid(authorOf.get(t.n)), last_message_id: last }));
});

/* ---------- 檢舉與申訴 ---------- */
for (const r of demo.reportSeeds) {
  let who = 0;
  for (const [reason, n] of Object.entries(r.counts)) {
    for (let i = 0; i < n; i++) {
      who += 1;
      lines.push(ins("reports", { target: r.target, reporter_id: uid(`r${String(who).padStart(2, "0")}`), reason, note: reason === "other" ? "示範" : "" }));
    }
  }
}
demo.appealSeeds.forEach((a, i) =>
  lines.push(ins("appeals", { id: i + 1, target: a.target, by_id: uid(a.by), text: a.text, photo_ids: "[]", status: a.status })),
);

/* ---------- 寫入 ---------- */
const file = join(root, ".wrangler", "seed-local.sql");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, lines.join("\n") + "\n");

const wrangler = (args) =>
  spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
    cwd: root,
    stdio: "inherit",
  });
const r = wrangler(["d1", "execute", "DB", "--local", "--config", "wrangler.local.jsonc", "--persist-to", persist, "--file", file]);
if (r.status !== 0) process.exit(r.status ?? 1);
const p = wrangler(["r2", "object", "put", `yinzang-photos/${photoKey}`, "--local", "--config", "wrangler.local.jsonc", "--persist-to", persist, "--file", photoFile, "--content-type", "image/jpeg"]);
console.log(`示範帳號 ${demo.users.length + extra.length} 個、炫收藏 ${demo.shares.length} 則、共 ${lines.length} 行 SQL`);
process.exit(p.status ?? 1);
