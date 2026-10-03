CREATE TABLE `spotify_match` (
	`artist_slug` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`reason` text DEFAULT 'visible' NOT NULL,
	`outcome` text,
	`spotify_id` text,
	`note` text DEFAULT '' NOT NULL,
	`preset_id` text,
	`preset_note` text DEFAULT '' NOT NULL,
	`rejected_ids` text DEFAULT '[]' NOT NULL,
	`tries` integer DEFAULT 0 NOT NULL,
	`next_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`checked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spotify_match_queue_idx` ON `spotify_match` (`status`,`next_at`);--> statement-breakpoint
-- 資料（2026-10-03）：使用者的判斷（spotify-manual.json 的 rejected、whenVisible；之後改判斷用 spotify-match.mjs --sync-decisions）
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note) VALUES ('aaa-hyukoh', 'rejected', 'manual', 'rejected', '合作名義（HYUKOH 與落日飛車），Spotify 的 AAA 是日本團，使用者確認不是（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET status='rejected', outcome='rejected', note=excluded.note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('dac-zaoyuan', 'waiting', 'manual', '["0nWX29koulPYFLJoMxIpJx"]', '合作名義，候選 Dac 是個人，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('james-lee', 'waiting', 'manual', '["4QHci6hVY85I6xSIu0W4k6"]', '候選 James Lee 沒有作品可證明是李銖銜，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('jihu', 'waiting', 'manual', '["5sR9BwbhwlsifEWrlw4uEF"]', '候選作品《母亲的河》《彝部分》跟站上對不上，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('kiki', 'waiting', 'manual', '["6MG7fjH9YBryqLT03MnwQM","0UMs6dTf23FC2fHc40fXNS","30FDJPN3RtwJZ20g5YGCRX","6hJtgCB3L5cnJSND7sp6GU","5RlTfdqlSGGASLxhDAHYtP"]', '同名候選太多、都對不上，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('roger-lin', 'waiting', 'manual', '["6asKuZzheNBzgXUD6x1aFh"]', '名稱太常見、作品對不上，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, rejected_ids, note) VALUES ('ye-jun-lin', 'waiting', 'manual', '["1X9fWntid7DkW6GcQLJsHM"]', '候選沒有作品可比，不配（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET rejected_ids=excluded.rejected_ids, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('aiko-tomi', 'waiting', 'manual', '24jBJ64cYnyWF53EKv6K9t', '富愛子＝Aiko Tomi，名稱對得上；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('brandon-lin', 'waiting', 'manual', '34uAT9ljsrLL2g7kx8lDZW', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('dao-che-ru-ku', 'waiting', 'manual', '5dnOo3EpTCmEnLwoC4tP78', 'Reversing into Garage 有《燒香拜佛》，跟站上作品同名；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('dciv', 'waiting', 'manual', '1ek0Tv8frXGgW6GCCE2jit', 'DCIV《Lost, Then Found》＝站上《失而復得》；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('destroyers', 'waiting', 'manual', '0n2SzMMLz0dcLCTFvKkxO7', '擊沈女孩 DESTROYERS，名稱對得上；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('knowtis', 'waiting', 'manual', '2jKpRyJAY8BCqYkuTRYnZu', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('n-y-p-d', 'waiting', 'manual', '0uGCA6uvmofOBLPplBhyAY', 'Spotify 名稱「N.Y.P.D. 南洋派對」完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('sonia-calico', 'waiting', 'manual', '7yZgyvPwZiP9D6ZvGrH1oB', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('thats-my-shhh', 'waiting', 'manual', '5iUU1iEJjzYNmZv8l2rMVp', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('tu-ling-yin-le-shi-yan-shi', 'waiting', 'manual', '7e44osCQ7ppxzkZO5R1viO', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('von-citizen', 'waiting', 'manual', '6y3CdH55aic6K8tT1NgRQ6', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('xiao-qin', 'waiting', 'manual', '2SaFT3GC9SqxdEw4K8a0kr', '名稱完全相同；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, preset_id, preset_note) VALUES ('yufu', 'waiting', 'manual', '4lq7hzzPRSVIU1bvThHpPj', '兩位同名 Yufu 中有作品的那位（Heal Me Good、CINEMAPHONIC Live）；使用者確認，藝人頁出現時才寫入（2026-10-03 使用者確認）') ON CONFLICT(artist_slug) DO UPDATE SET preset_id=excluded.preset_id, preset_note=excluded.preset_note, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
-- 目前藝人頁有顯示、這次比對過還沒對到的：記成比對過，下次每月重跑（觸發 B）再查
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('a-luo-ka-li-ting-ba-qi-la', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('huang-jing-shi-yi', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('huang-qi-shan', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('lin-yu-ting', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('su-yu-han', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('zheng-nan', 'done', 'seed', 'shell', 'Spotify 同名候選沒頭像也沒作品、作品標題搜尋也對不到（2026-10-03 顯示中補對）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
INSERT INTO spotify_match (artist_slug, status, reason, outcome, note, checked_at) VALUES ('james-lee', 'done', 'seed', 'doubt', '唯一同名候選 James Lee 使用者確認不配（2026-10-03）', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(artist_slug) DO UPDATE SET status='done', reason='seed', outcome=excluded.outcome, note=excluded.note, checked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
--> statement-breakpoint
-- 每月重跑從 2026-11 開始（這個月剛跑過）
--> statement-breakpoint
INSERT INTO spotify_state (key, value) VALUES ('auto_month', '2026-10') ON CONFLICT(key) DO NOTHING;
