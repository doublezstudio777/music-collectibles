// MusicBrainz 匯入：資料庫部分（由 import-musicbrainz.mjs 呼叫，不單獨跑）。
//
// 流程：讀目前資料庫狀態 → 算出要建／要合併／要補的 → 產生 SQL（每一句都有「沒有才做」的條件，重跑不會重複建）→ 執行。
// 規則見 import-musicbrainz.mjs 開頭。

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------- 對照表 ---------- */

const COUNTRY = {
  TW: "台灣", HK: "香港", CN: "中國", JP: "日本", US: "美國", KR: "韓國", MY: "馬來西亞", SG: "新加坡",
  XW: "全球", XE: "歐洲", GB: "英國", DE: "德國", FR: "法國", CA: "加拿大", AU: "澳洲", TH: "泰國",
};
const PACKAGING = {
  "Jewel Case": "塑膠盒", "Slim Jewel Case": "薄塑膠盒", Digipak: "紙盒（Digipak）", "Cardboard/Paper Sleeve": "紙套",
  "Keep Case": "DVD 盒", Box: "盒裝", "Gatefold Cover": "對開封套", Book: "書本裝", Digibook: "書本裝（Digibook）",
  Fatbox: "厚塑膠盒", "Super Jewel Box": "Super Jewel Box", "Snap Case": "扣盒", "Plastic Sleeve": "塑膠套",
  Slidepack: "抽拉式紙盒", "Discbox Slider": "抽拉式紙盒", Longbox: "長盒", "Cassette Case": "卡帶盒",
};
const SERIES_KIND = { Album: "album", EP: "ep", Single: "single" };
const SERIES_TYPE = { album: "專輯發行", ep: "EP 發行", single: "單曲發行" };
const ITEM = {
  cd: { id: "cd", kind: "CD", sort: 0 },
  vinyl: { id: "vinyl", kind: "黑膠", sort: 1 },
  cassette: { id: "cassette", kind: "卡帶", sort: 2 },
  bluray: { id: "bluray", kind: "藍光／DVD", sort: 3 },
  other: { id: "other", kind: "其他周邊", sort: 9 },
};

const isDigital = (f) => !f || /digital|download|stream/i.test(f);
/** 實體 format → 品項；對不到回 null */
function itemOf(f) {
  if (!f || isDigital(f)) return null;
  if (/vinyl|\bLP\b|flexi|shellac/i.test(f)) return ITEM.vinyl;
  if (/cassette/i.test(f)) return ITEM.cassette;
  if (/dvd|blu-?ray|hd-dvd|vhs|laserdisc|vcd|video cd/i.test(f)) return ITEM.bluray;
  if (/cd|sacd/i.test(f)) return ITEM.cd;
  return ITEM.other;
}
function fmtLabel(f) {
  if (/^(\d+)" Vinyl$/i.test(f)) return `${f.match(/^(\d+)/)[1]} 吋黑膠`;
  if (/vinyl/i.test(f)) return "黑膠";
  if (/cassette/i.test(f)) return "卡帶";
  if (/blu-?ray/i.test(f)) return "藍光";
  if (/dvd/i.test(f)) return "DVD";
  if (/sacd/i.test(f)) return "SACD";
  if (/cd-r/i.test(f)) return "CD-R";
  if (/cd/i.test(f)) return "CD";
  if (/usb/i.test(f)) return "USB 隨身碟";
  return f;
}
/** 一個 release 的實體媒體組成：「2CD」「CD＋DVD」 */
function mediaLabel(media) {
  const counts = new Map();
  for (const m of media) counts.set(fmtLabel(m.format), (counts.get(fmtLabel(m.format)) ?? 0) + 1);
  return [...counts].map(([f, n]) => (n > 1 ? `${n}${/^[A-Z]/.test(f) ? "" : " 張"}${f}` : f)).join("＋");
}
const fmtLength = (ms) => {
  if (!ms || ms < 0) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** 曲目行清單（格式見 lib/tracks.ts） */
function trackLines(media) {
  const multi = media.length > 1;
  const out = [];
  media.forEach((m, i) => {
    if (multi) out.push(`【第 ${m.position ?? i + 1} 碟 ${fmtLabel(m.format)}${m.title ? ` ${m.title}` : ""}】`);
    for (const t of m.tracks ?? []) {
      const len = fmtLength(t.length ?? t.recording?.length);
      out.push(`${t.number || t.position}. ${t.title}${len ? ` (${len})` : ""}`);
    }
  });
  return out;
}
const trackTotal = (media) => media.reduce((n, m) => n + (m.tracks?.length ?? m["track-count"] ?? 0), 0);

/* ---------- 主程式 ---------- */

export async function run({ remote, persist, dry, mapping, releases, people, PROTECTED_SHARE, manual = {}, norm, set = "label" }) {
  // 金曲金音批：mapping 裡 previous＝顏社本色上次的對應，只用來歸屬，不算進本批報告
  const own = mapping.filter((m) => !m.previous);
  const wrangler = (args, capture = false) =>
    spawnSync(process.execPath, ["--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js", ...args], {
      cwd: root,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  const target = remote ? ["--remote", "--config", "wrangler.production.jsonc"] : ["--local", "--config", "wrangler.local.jsonc", "--persist-to", persist];
  const query = (sql) => {
    const r = wrangler(["d1", "execute", "DB", ...target, "--json", "--command", sql], true);
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error(`查詢失敗：${sql.slice(0, 200)}`);
    }
    return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0].results;
  };
  const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
  const inList = (xs) => `(${xs.map(q).join(", ") || "''"})`;

  /* ---- 讀目前狀態 ---- */
  const slugs = people.map((p) => p.slug);
  const redirects = new Map(query(`SELECT old_slug AS o, new_slug AS n FROM artist_redirects`).map((r) => [r.o, r.n]));
  const cur = (s) => redirects.get(s) ?? s;
  const curSlugs = slugs.map(cur);
  const seriesRows = query(
    `SELECT id, artist_slug AS slug, no, title, year, kind, mbid, source FROM series WHERE deleted_at IS NULL AND artist_slug IN ${inList(curSlugs)}`,
  );
  const allMbSeries = new Map(query(`SELECT id, mbid, artist_slug AS slug, no FROM series WHERE mbid IS NOT NULL AND deleted_at IS NULL`).map((s) => [s.mbid, s]));
  const itemRows = seriesRows.length
    ? query(`SELECT id, series_id AS sid, item_id AS itemId, kind FROM items WHERE deleted_at IS NULL AND series_id IN (${seriesRows.map((s) => s.id).join(",")})`)
    : [];
  const versionRows = itemRows.length
    ? query(
        `SELECT id, item_ref AS iref, version_id AS vid, edition, year, region, label, catalog, barcode, packaging, contents, tracks, track_list AS trackList, release_date AS releaseDate, mbid, source FROM versions WHERE deleted_at IS NULL AND item_ref IN (${itemRows.map((i) => i.id).join(",")})`,
      )
    : [];
  const allMbVersions = new Set(query(`SELECT mbid FROM versions WHERE mbid IS NOT NULL`).map((v) => v.mbid));
  const [share] = query(`SELECT no, series_key AS sk, item_id AS item, version_id AS ver FROM shares WHERE no = ${PROTECTED_SHARE}`);
  let protectedId = null;
  if (share?.sk && share.item && share.ver) {
    const [slug, no] = share.sk.split("/");
    const [v] = query(
      `SELECT v.id FROM versions v JOIN items i ON i.id = v.item_ref JOIN series w ON w.id = i.series_id WHERE w.artist_slug = ${q(slug)} AND w.no = ${Number(no)} AND i.item_id = ${q(share.item)} AND v.version_id = ${q(share.ver)}`,
    );
    protectedId = v?.id ?? null;
  }
  console.log(`第 ${PROTECTED_SHARE} 則收藏掛的版本 id：${protectedId ?? "（沒有）"}，整列不碰`);

  const before = query(
    `SELECT (SELECT COUNT(*) FROM series WHERE source = 'musicbrainz') AS s, (SELECT COUNT(*) FROM items WHERE source = 'musicbrainz') AS i, ` +
      `(SELECT COUNT(*) FROM versions WHERE source = 'musicbrainz') AS v, (SELECT COUNT(*) FROM series WHERE mbid IS NOT NULL AND source IS NULL) AS sm, ` +
      `(SELECT COUNT(*) FROM versions WHERE mbid IS NOT NULL AND source IS NULL) AS vm, (SELECT COUNT(*) FROM versions WHERE track_list <> '[]') AS vt`,
  )[0];

  /* ---- 整理 MusicBrainz 資料：release-group → releases ---- */
  const slugByMbid = new Map(mapping.filter((m) => m.status === "ok").map((m) => [m.mbid, cur(m.slug)]));
  const skipped = { 數位發行: 0, 非正式發行: 0, 類型不收: 0, 格式不明: 0 };
  const skippedList = [];
  const groups = new Map();
  const seenRelease = new Set();
  for (const [mbid, list] of releases) {
    for (const r of list) {
      if (seenRelease.has(r.id)) continue;
      seenRelease.add(r.id);
      const rg = r["release-group"];
      const media = r.media ?? [];
      const phys = media.filter((m) => !isDigital(m.format));
      if (media.length && media.every((m) => isDigital(m.format))) {
        if (media.every((m) => m.format && /digital/i.test(m.format))) skipped.數位發行++;
        else skipped.格式不明++;
        continue;
      }
      if (!phys.length) {
        skipped.格式不明++;
        skippedList.push({ release: r.id, title: r.title, 原因: "沒有媒體格式" });
        continue;
      }
      if (r.status && r.status !== "Official") {
        skipped.非正式發行++;
        skippedList.push({ release: r.id, title: r.title, 原因: `狀態 ${r.status}` });
        continue;
      }
      // 類型未標（MusicBrainz 沒填 primary-type）：只有對得上既有系列時才收（類型沿用既有系列），對不上就跳過
      const kind = rg && !rg["primary-type"] ? "untyped" : SERIES_KIND[rg?.["primary-type"]];
      if (!rg || !kind) {
        skipped.類型不收++;
        skippedList.push({ release: r.id, title: r.title, 原因: `類型 ${rg?.["primary-type"] ?? "未標"}` });
        continue;
      }
      const credited = [...new Set((r["artist-credit"] ?? []).map((c) => slugByMbid.get(c.artist?.id)).filter(Boolean))];
      if (!credited.length) credited.push(slugByMbid.get(mbid));
      const g = groups.get(rg.id) ?? { rg, kind, credited: new Set(), releases: [] };
      credited.forEach((s) => g.credited.add(s));
      g.releases.push({ r, phys, item: itemOf(phys[0].format) });
      groups.set(rg.id, g);
    }
  }

  // 同一位藝人、同標題（簡繁視為相同）、同年份的多個 release-group 併成一個系列（MusicBrainz 偶有重複登錄或分地區登錄）
  const merged = new Map();
  for (const g of groups.values()) {
    const owner = [...g.credited][0];
    const k = `${owner}|${norm(g.rg.title)}|${(g.rg["first-release-date"] || "").slice(0, 4)}`;
    const m = merged.get(k);
    if (!m) merged.set(k, { ...g, also: [] });
    else {
      m.releases.push(...g.releases);
      g.credited.forEach((x) => m.credited.add(x));
      m.also.push(g.rg.id);
      if (m.kind === "untyped") m.kind = g.kind;
    }
  }
  groups.clear();
  for (const g of merged.values()) groups.set(g.rg.id, g);

  /* ---- 產生 SQL ---- */
  const lines = [];
  const report = { 新系列: [], 合併系列: [], 併入同名系列: [], 新品項: 0, 新版本: 0, 合併版本: [], 帶曲目版本: 0, 受保護略過: [] };
  const usedSeries = new Set(); // 既有系列已被某個 release-group 合併過
  const bySlug = (s) => seriesRows.filter((w) => w.slug === s);

  for (const m of mapping.filter((x) => x.status === "ok")) {
    lines.push(`UPDATE artists SET mbid = ${q(m.mbid)} WHERE slug = ${q(cur(m.slug))} AND mbid IS NULL;`);
  }

  const dateOf = (r) => r.date || "";
  const yearOf = (d) => (/^\d{4}/.test(d) ? d.slice(0, 4) : "");

  for (const g of [...groups.values()].sort((a, b) => (a.rg["first-release-date"] || "9999").localeCompare(b.rg["first-release-date"] || "9999"))) {
    const owner = [...g.credited][0];
    const years = g.releases.map((x) => yearOf(dateOf(x.r))).filter(Boolean).sort();
    const year = yearOf(g.rg["first-release-date"] || "") || years[0] || "";
    const title = g.rg.title;
    // 找既有系列：同 MBID → 同藝人（含共同署名的其他人）標題＋年份
    let sid = null;
    let existing = allMbSeries.get(g.rg.id) ?? null;
    if (existing) sid = existing.id;
    else {
      // 標題比對用 release-group 標題＋底下各 release 的標題（例：release-group「Mr. Almost」的台灣版標題是「差不多先生」）
      const nts = [...new Set([title, ...g.releases.map((x) => x.r.title)].map(norm))];
      const cand = [...g.credited]
        .flatMap(bySlug)
        .filter((w) => !w.mbid && !usedSeries.has(w.id) && w.kind !== "misc")
        .filter((w) => {
          const n = norm(w.title);
          const titleOk = nts.some((nt) => n === nt || (Math.min(n.length, nt.length) >= 3 && (n.includes(nt) || nt.includes(n))));
          const yearOk = !/^\d{4}/.test(w.year) || !years.length || years.includes(w.year.slice(0, 4)) || w.year.slice(0, 4) === year;
          return titleOk && yearOk;
        });
      if (cand.length) {
        existing = cand[0];
        sid = existing.id;
        usedSeries.add(existing.id);
        report.合併系列.push(`${existing.slug}/${existing.no}《${existing.title}》← ${title}（${g.rg.id}）`);
        lines.push(`UPDATE series SET mbid = ${q(g.rg.id)} WHERE id = ${sid} AND mbid IS NULL AND NOT EXISTS (SELECT 1 FROM series WHERE mbid = ${q(g.rg.id)});`);
        if (year) lines.push(`UPDATE series SET year = ${q(year)} WHERE id = ${sid} AND year NOT GLOB '[0-9][0-9][0-9][0-9]*';`);
      }
    }
    const S = `(SELECT id FROM series WHERE mbid = ${q(g.rg.id)} AND deleted_at IS NULL ORDER BY id LIMIT 1)`;
    if (!existing && g.kind === "untyped") {
      skipped.類型不收++;
      skippedList.push({ releaseGroup: g.rg.id, title, 原因: "類型未標，也對不到既有系列" });
      continue;
    }
    if (g.also.length) report.併入同名系列.push(`${owner}《${title}》${year}：${[g.rg.id, ...g.also].join("、")}`);
    if (!existing) {
      report.新系列.push(`${owner}《${title}》${year}`);
      const nextNo =
        `(SELECT MAX(COALESCE((SELECT MAX(no) FROM series WHERE artist_slug = ${q(owner)}), 0), ` +
        `COALESCE((SELECT value FROM counters WHERE key = 'series_no:' || ${q(owner)}), 0)) + 1)`;
      lines.push(
        `INSERT INTO series (artist_slug, no, title, name, series_type, kind, credits, year, body, guests, compilation, status, mbid, source) ` +
          `SELECT ${q(owner)}, ${nextNo}, ${q(title)}, ${q(`${year}《${title}》${SERIES_TYPE[g.kind]}`)}, ${q(SERIES_TYPE[g.kind])}, ${q(g.kind)}, ` +
          `${q(JSON.stringify([...g.credited]))}, ${q(year)}, '[]', '[]', '[]', 'approved', ${q(g.rg.id)}, 'musicbrainz' ` +
          `WHERE NOT EXISTS (SELECT 1 FROM series WHERE mbid = ${q(g.rg.id)});`,
      );
    }

    // 品項：既有系列裡同類型的品項沿用
    const itemsHere = sid ? itemRows.filter((i) => i.sid === sid) : [];
    const byItem = new Map();
    for (const x of g.releases) byItem.set(x.item.id, [...(byItem.get(x.item.id) ?? []), x]);
    for (const [iid, list] of byItem) {
      const def = list[0].item;
      const exItem = itemsHere.find((i) => i.itemId === iid) ?? itemsHere.find((i) => i.kind === def.kind);
      const itemId = exItem?.itemId ?? def.id;
      if (!exItem) {
        report.新品項++;
        lines.push(
          `INSERT INTO items (series_id, item_id, kind, sort, status, source) SELECT ${S}, ${q(itemId)}, ${q(def.kind)}, ${def.sort}, 'approved', 'musicbrainz' ` +
            `WHERE ${S} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM items WHERE series_id = ${S} AND item_id = ${q(itemId)});`,
        );
      }
      const I = `(SELECT id FROM items WHERE series_id = ${S} AND item_id = ${q(itemId)})`;
      const exVersions = exItem ? versionRows.filter((v) => v.iref === exItem.id) : [];
      const usedV = new Set(exVersions.filter((v) => v.mbid).map((v) => v.id));
      const editions = new Set(exVersions.map((v) => v.edition));

      // 版本名稱：年份＋地區＋首版／再版＋媒體組成
      const sorted = [...list].sort((a, b) => (dateOf(a.r) || "9999").localeCompare(dateOf(b.r) || "9999"));
      const firstYear = new Map();
      sorted.forEach((x, idx) => {
        const r = x.r;
        const d = dateOf(r);
        const y = yearOf(d);
        const region = COUNTRY[r.country] ?? r.country ?? "";
        const labels = [...new Set((r["label-info"] ?? []).map((l) => l.label?.name).filter((n) => n && n !== "[no label]"))];
        const cats = [...new Set((r["label-info"] ?? []).map((l) => l["catalog-number"]).filter((c) => c && c !== "[none]"))];
        const lines_ = trackLines(x.phys);
        const n = trackTotal(x.phys);
        const media = mediaLabel(x.phys);
        const pack = [PACKAGING[r.packaging] ?? (r.packaging && r.packaging !== "None" ? r.packaging : ""), x.phys.length > 1 ? media : ""].filter(Boolean).join("，");
        const contents = x.phys.length > 1 ? media : "";
        const fill = {
          year: y,
          release_date: d,
          region,
          label: labels.join("、"),
          catalog: cats.join("、"),
          barcode: r.barcode || "",
          packaging: pack,
          contents,
          tracks: n ? `${n} 首` : "",
          track_list: lines_.length ? JSON.stringify(lines_) : "",
        };

        const setBlank = (id, only = null) => {
          const conds = {
            year: `year NOT GLOB '[0-9][0-9][0-9][0-9]*'`,
            release_date: `release_date = ''`,
            region: `region = ''`,
            label: `label = ''`,
            catalog: `catalog IN ('', '待查證')`,
            barcode: `barcode IN ('', '無條碼')`,
            packaging: `packaging = ''`,
            contents: `contents IN ('', '—')`,
            tracks: `tracks IN ('', '—')`,
            track_list: `track_list = '[]' AND NOT EXISTS (SELECT 1 FROM revisions WHERE field = 'tracks' AND target LIKE 'tracks:%' AND target = (SELECT 'tracks:' || w.artist_slug || '/' || w.no || '#' || i.item_id || '-' || v2.version_id FROM versions v2 JOIN items i ON i.id = v2.item_ref JOIN series w ON w.id = i.series_id WHERE v2.id = ${id}))`,
          };
          for (const [col, val] of Object.entries(fill)) if (val && (!only || only.includes(col))) lines.push(`UPDATE versions SET ${col} = ${q(val)} WHERE id = ${id} AND ${conds[col]};`);
        };

        // 1) 已經匯入過（MBID 在）：只補空白
        const hasMb = exVersions.find((v) => v.mbid === r.id);
        if (hasMb || allMbVersions.has(r.id)) {
          if (hasMb && hasMb.id !== protectedId) setBlank(hasMb.id);
          return;
        }
        // 2) 既有版本（研究匯入或會員建的）同品項同年份 → 合併
        const pool = exVersions.filter((v) => !v.mbid && !usedV.has(v.id) && y && v.year.slice(0, 4) === y);
        const pick =
          pool.find((v) => (x.phys.length > 1) === /\d+\s*x?\s*(CD|LP|DVD)|2xCD|2CD|豪華/i.test(`${v.packaging}${v.edition}`)) ?? pool[0];
        if (pick) {
          usedV.add(pick.id);
          if (pick.id === protectedId) {
            // 第 3 則收藏掛的版本：預設整列不碰；手動設定 protectedShare.fillBlank 列出的欄位，原本空白才補（不寫 mbid）
            const only = manual.protectedShare?.fillBlank ?? [];
            if (only.length) {
              setBlank(pick.id, only);
              report.受保護略過.push(`版本 id ${pick.id}「${pick.edition}」對上 ${r.id}，只補空白的 ${only.join("、")}，其他欄位與 mbid 不動（第 ${PROTECTED_SHARE} 則收藏）`);
            } else report.受保護略過.push(`版本 id ${pick.id}「${pick.edition}」對上 ${r.id}，整列不動（第 ${PROTECTED_SHARE} 則收藏）`);
            return;
          }
          report.合併版本.push(`版本 id ${pick.id}「${pick.edition}」← ${r.id}`);
          if (lines_.length && pick.trackList === "[]") report.帶曲目版本++;
          lines.push(`UPDATE versions SET mbid = ${q(r.id)} WHERE id = ${pick.id} AND mbid IS NULL AND NOT EXISTS (SELECT 1 FROM versions WHERE mbid = ${q(r.id)});`);
          setBlank(pick.id);
          return;
        }
        // 3) 新版本
        const key = `${region}`;
        // 首版＝發行年跟這個 release-group 最早發行年同一年、且是該地區最早的一筆；晚於最早發行年的算再版
        let tag = "";
        if (y && year && y > year) tag = "再版";
        else if (y && y === year && !firstYear.has(key)) {
          firstYear.set(key, y);
          tag = "首版";
        }
        let ed = [y, `${region}${tag}`, media].filter(Boolean).join(" ");
        const extra = r.disambiguation || (norm(r.title) !== norm(g.rg.title) ? r.title : "");
        if (extra) ed += `（${extra}）`;
        if (editions.has(ed) && labels[0]) ed += `（${labels[0]}）`;
        for (let k = 2; editions.has(ed); k++) ed = ed.replace(/（\d+）$/, "") + `（${k}）`;
        editions.add(ed);
        report.新版本++;
        if (lines_.length) report.帶曲目版本++;
        const nextV = `'v' || (COALESCE((SELECT MAX(CAST(SUBSTR(version_id, 2) AS INTEGER)) FROM versions WHERE item_ref = ${I}), 0) + 1)`;
        lines.push(
          `INSERT INTO versions (item_ref, version_id, edition, year, region, label, catalog, barcode, packaging, contents, tracks, identify_by, data_status, sort, status, mbid, source, release_date, track_list) ` +
            `SELECT ${I}, ${nextV}, ${[ed, y, region, fill.label, fill.catalog || "待查證", fill.barcode || "無條碼", pack, contents, fill.tracks, "", "待確認"].map(q).join(", ")}, ` +
            `${exVersions.length + idx}, 'approved', ${q(r.id)}, 'musicbrainz', ${q(d)}, ${q(fill.track_list || "[]")} ` +
            `WHERE ${I} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM versions WHERE mbid = ${q(r.id)});`,
        );
      });
    }
  }

  const out = join(root, ".wrangler", `import-musicbrainz${set === "awards" ? "-awards" : ""}.sql`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join("\n") + "\n");

  const summary = {
    環境: remote ? "remote" : "local",
    批次: set,
    藝人: {
      名單: own.length,
      對應成功: own.filter((m) => m.status === "ok").length,
      對應不到: own.filter((m) => m.status !== "ok").map((m) => ({ 藝人: m.name, 識別碼: m.slug, 原因: m.reason, 候選: m.candidates.map((c) => `${c.name}｜${c.country || "國家未標"}｜${c.type || "類型未標"}｜${c.mbid}`) })),
      對應成功清單: own.filter((m) => m.status === "ok").map((m) => ({ 藝人: m.name, 識別碼: m.slug, mbid: m.mbid, 依據: m.reason })),
    },
    MusicBrainz: { release: seenRelease.size, 收錄的release_group: groups.size, 跳過: skipped, 跳過明細: skippedList },
    計畫: {
      新系列: report.新系列.length,
      合併系列: report.合併系列.length,
      新品項: report.新品項,
      新版本: report.新版本,
      合併版本: report.合併版本.length,
      帶曲目的版本: report.帶曲目版本,
      明細: report,
    },
    匯入前: before,
    受保護版本id: protectedId,
  };
  const reportFile = join(root, ".wrangler", `import-musicbrainz${set === "awards" ? "-awards" : ""}-report${remote ? "-remote" : ""}.json`);
  writeFileSync(reportFile, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, MusicBrainz: { ...summary.MusicBrainz, 跳過明細: `${skippedList.length} 筆（見報告檔）` }, 計畫: { ...summary.計畫, 明細: "見報告檔" } }, null, 2));

  if (dry) {
    console.log(`--dry-run：SQL 寫在 ${out}（${lines.length} 句），沒有執行`);
    mergeSeries({ query, wrangler, target, q, norm, manual, dry, summary, reportFile });
    return;
  }
  if (remote) {
    console.log("\n== 匯入前先備份正式站 ==");
    const b = spawnSync(process.execPath, ["scripts/backup.mjs", "--remote"], { cwd: root, stdio: "inherit" });
    if (b.status !== 0) {
      console.error("備份失敗，停止匯入");
      process.exit(1);
    }
  }
  console.log(`\n== 執行匯入（${lines.length} 句） ==`);
  const r = wrangler(["d1", "execute", "DB", ...target, "--file", out, ...(remote ? ["--yes"] : [])]);
  if (r.status !== 0) process.exit(r.status ?? 1);
  const after = query(
    `SELECT (SELECT COUNT(*) FROM series WHERE source = 'musicbrainz') AS s, (SELECT COUNT(*) FROM items WHERE source = 'musicbrainz') AS i, ` +
      `(SELECT COUNT(*) FROM versions WHERE source = 'musicbrainz') AS v, (SELECT COUNT(*) FROM series WHERE mbid IS NOT NULL AND source IS NULL) AS sm, ` +
      `(SELECT COUNT(*) FROM versions WHERE mbid IS NOT NULL AND source IS NULL) AS vm, (SELECT COUNT(*) FROM versions WHERE track_list <> '[]') AS vt`,
  )[0];
  const delta = Object.fromEntries(Object.keys(after).map((k) => [k, after[k] - before[k]]));
  summary.匯入後 = after;
  summary.本次實際變化 = { 新系列: delta.s, 新品項: delta.i, 新版本: delta.v, 合併系列: delta.sm, 合併版本: delta.vm, 有曲目的版本增加: delta.vt };
  writeFileSync(reportFile, JSON.stringify(summary, null, 2));
  console.log("本次實際變化：", JSON.stringify(summary.本次實際變化));
  mergeSeries({ query, wrangler, target, q, norm, manual, dry, summary, reportFile });
}

/* ---------- 系列合併（2026-09-28 MusicBrainz 後續） ----------
 * 同一作品被拆成兩個系列（例：夜貓組《健康歌曲》研究匯入的 2024 黑膠、MusicBrainz 匯入的 2017 CD）：
 * - from 底下的品項（含已刪除的）整個搬到 into，版本跟著品項走，不重建、不改 id，所以版本的照片辨識、仿冒、我有等以 id 或鍵掛的資料都跟著
 * - 引用 from 系列鍵的地方（收藏、我有／想要、成交、檢舉／申訴／裁決／鎖定／編輯紀錄）改成 into 的鍵，規則同 lib/server/duplicates.ts 的藝人合併
 * - from 軟刪除（deleted_at），寫 series_redirects 舊 → 新（proxy.ts 301），連續合併只轉一次；寫 admin_log
 * - 全部放在一次 d1 execute --command（D1 把同一次請求的多句當一個交易，中途失敗整批不生效）
 * - 品項類型撞到（兩邊都有 CD）就停下不合併，要人工處理
 * - 資料守恆：合併前後 series、items、versions 等各表總數必須相同，不同就報錯
 * - 重跑：from 已刪除且轉址已在 → 略過
 */
const COUNT_TABLES = ["series", "items", "versions", "shares", "holdings", "deals", "reports", "appeals", "target_decisions", "page_locks", "revisions", "version_marks", "version_fakes", "photos", "comments"];
function mergeSeries({ query, wrangler, target, q, norm, manual, dry, summary, reportFile }) {
  const list = manual.mergeSeries ?? [];
  if (!list.length) return;
  summary.系列合併 = [];
  const counts = () => query(`SELECT ${COUNT_TABLES.map((t) => `(SELECT COUNT(*) FROM ${t}) AS ${t}`).join(", ")}`)[0];
  for (const m of list) {
    const [fs, fn] = m.from.split("/");
    const [is, inn] = m.into.split("/");
    const [from] = query(`SELECT id, artist_slug AS slug, no, title, year, deleted_at AS del FROM series WHERE artist_slug = ${q(fs)} AND no = ${Number(fn)}`);
    const [into] = query(`SELECT id, artist_slug AS slug, no, title, year, deleted_at AS del FROM series WHERE artist_slug = ${q(is)} AND no = ${Number(inn)}`);
    const [redir] = query(`SELECT new_key AS k FROM series_redirects WHERE old_key = ${q(m.from)}`);
    if (from?.del && redir?.k === m.into) {
      console.log(`系列合併 ${m.from} → ${m.into}：已經合併過，略過`);
      summary.系列合併.push({ ...m, 結果: "已經合併過，略過" });
      continue;
    }
    if (!from || !into || from.del || into.del) throw new Error(`系列合併 ${m.from} → ${m.into}：找不到系列或已刪除`);
    if (m.title && (norm(from.title) !== norm(m.title) || norm(into.title) !== norm(m.title))) throw new Error(`系列合併 ${m.from} → ${m.into}：標題對不上（${from.title}／${into.title}）`);
    const fromItems = query(`SELECT id, item_id AS itemId, kind FROM items WHERE series_id = ${from.id}`);
    const intoItems = query(`SELECT id, item_id AS itemId, kind FROM items WHERE series_id = ${into.id}`);
    const clash = fromItems.filter((a) => intoItems.some((b) => b.itemId === a.itemId));
    if (clash.length) throw new Error(`系列合併 ${m.from} → ${m.into}：品項撞到（${clash.map((x) => x.itemId).join("、")}），要人工處理`);
    const moved = fromItems.length ? query(`SELECT COUNT(*) AS n FROM versions WHERE item_ref IN (${fromItems.map((i) => i.id).join(",")})`)[0].n : 0;

    const oldKey = m.from;
    const newKey = m.into;
    const st = [];
    const now = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
    st.push(`UPDATE items SET series_id = ${into.id} WHERE series_id = ${from.id}`);
    st.push(`UPDATE shares SET series_key = ${q(newKey)} WHERE series_key = ${q(oldKey)}`);
    for (const [table, col] of [["holdings", "target_key"], ["deals", "version_key"]]) {
      st.push(`UPDATE ${table} SET ${col} = ${q(newKey)} WHERE ${col} = ${q(oldKey)}`);
      st.push(`UPDATE ${table} SET ${col} = ${q(newKey + "#")} || substr(${col}, ${oldKey.length + 2}) WHERE substr(${col}, 1, ${oldKey.length + 1}) = ${q(oldKey + "#")}`);
    }
    // 合集標記（2026-10-01）：同一則合集同一個鍵只有一列，撞到就保留原本那列
    st.push(`UPDATE OR IGNORE collection_tags SET target_key = ${q(newKey)} WHERE target_key = ${q(oldKey)}`);
    st.push(`UPDATE OR IGNORE collection_tags SET target_key = ${q(newKey + "#")} || substr(target_key, ${oldKey.length + 2}) WHERE substr(target_key, 1, ${oldKey.length + 1}) = ${q(oldKey + "#")}`);
    for (const table of ["reports", "appeals", "target_decisions", "page_locks", "revisions"]) {
      if (table === "target_decisions" || table === "page_locks") {
        // 一個對象一列：into 已經有就保留 into 的，from 那列留著不動（不刪，守恆），只是不再有人查
        st.push(`UPDATE ${table} SET target = ${q(`series:${newKey}`)} WHERE target = ${q(`series:${oldKey}`)} AND NOT EXISTS (SELECT 1 FROM ${table} WHERE target = ${q(`series:${newKey}`)})`);
      } else st.push(`UPDATE ${table} SET target = ${q(`series:${newKey}`)} WHERE target = ${q(`series:${oldKey}`)}`);
      for (const p of ["item:", "version:"]) {
        const op = `${p}${oldKey}#`;
        st.push(`UPDATE ${table} SET target = ${q(`${p}${newKey}#`)} || substr(target, ${op.length + 1}) WHERE substr(target, 1, ${op.length}) = ${q(op)}`);
      }
    }
    st.push(`UPDATE series SET deleted_at = ${now}, updated_at = ${now} WHERE id = ${from.id}`);
    st.push(`DELETE FROM series_redirects WHERE old_key = ${q(newKey)}`);
    st.push(`UPDATE series_redirects SET new_key = ${q(newKey)} WHERE new_key = ${q(oldKey)}`);
    st.push(`INSERT INTO series_redirects (old_key, new_key, created_by) VALUES (${q(oldKey)}, ${q(newKey)}, 'import-musicbrainz')`);
    st.push(
      `INSERT INTO admin_log (admin_id, action, target, detail) VALUES ('import-musicbrainz', '合併系列', ${q(`series:${newKey}`)}, ${q(JSON.stringify({ from: oldKey, into: newKey, items: fromItems.map((i) => i.itemId), versions: moved, reason: m.reason ?? "" }))})`,
    );
    const plan = { ...m, from系列: from, into系列: into, 搬動品項: fromItems, 搬動版本數: moved, SQL: st };
    if (dry) {
      console.log(`系列合併（dry-run，不執行）${oldKey}《${from.title}》${from.year} → ${newKey}《${into.title}》${into.year}：品項 ${fromItems.length}、版本 ${moved}`);
      summary.系列合併.push({ ...plan, 結果: "dry-run" });
      continue;
    }
    const before = counts();
    const r = wrangler(["d1", "execute", "DB", ...target, "--command", st.join(";\n") + ";", ...(target.includes("--remote") ? ["--yes"] : [])], true);
    if (r.status !== 0) {
      console.error(r.stdout, r.stderr);
      throw new Error(`系列合併 ${oldKey} → ${newKey} 失敗（整批不生效）`);
    }
    const after = counts();
    const diff = COUNT_TABLES.filter((t) => before[t] !== after[t]);
    const [chk] = query(
      `SELECT (SELECT COUNT(*) FROM items WHERE series_id = ${from.id}) AS left_, (SELECT COUNT(*) FROM items WHERE series_id = ${into.id}) AS now_, (SELECT deleted_at FROM series WHERE id = ${from.id}) AS del, (SELECT new_key FROM series_redirects WHERE old_key = ${q(oldKey)}) AS redir`,
    );
    const ok = !diff.length && chk.left_ === 0 && chk.now_ === intoItems.length + fromItems.length && chk.del && chk.redir === newKey;
    summary.系列合併.push({ ...plan, 合併前總數: before, 合併後總數: after, 總數有變的表: diff, 檢查: chk, 結果: ok ? "完成" : "檢查不過" });
    writeFileSync(reportFile, JSON.stringify(summary, null, 2));
    console.log(`系列合併 ${oldKey} → ${newKey}：品項 ${fromItems.length}、版本 ${moved}；各表總數${diff.length ? `有變：${diff.join("、")}` : "前後相同"}；轉址 ${chk.redir}`);
    if (!ok) throw new Error(`系列合併 ${oldKey} → ${newKey} 檢查不過：${JSON.stringify({ diff, chk })}`);
  }
  writeFileSync(reportFile, JSON.stringify(summary, null, 2));
}
