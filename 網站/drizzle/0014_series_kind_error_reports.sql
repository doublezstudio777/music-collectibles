CREATE TABLE `error_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`photo_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`handled_by` text,
	`handled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `error_reports_share_reporter_uq` ON `error_reports` (`share_no`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `error_reports_status_idx` ON `error_reports` (`status`,`id`);--> statement-breakpoint
ALTER TABLE `reports` ADD `photo_id` text;--> statement-breakpoint
ALTER TABLE `series` ADD `kind` text DEFAULT 'album' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `series_misc_uq` ON `series` (`artist_slug`) WHERE kind = 'misc';--> statement-breakpoint
ALTER TABLE `shares` ADD `pending_series_id` integer;--> statement-breakpoint
CREATE INDEX `shares_pending_series_idx` ON `shares` (`pending_series_id`);--> statement-breakpoint
-- 回填既有系列的類型（新欄位預設 album）：依 series_type 文字判斷，只改不是 album 的，其餘不動
UPDATE `series` SET `kind` = CASE
  WHEN `series_type` LIKE '%EP%' THEN 'ep'
  WHEN `series_type` LIKE '%單曲%' THEN 'single'
  WHEN `series_type` LIKE '%巡迴%' OR `series_type` LIKE '%演唱會%' OR `series_type` LIKE '%演出%' OR `series_type` LIKE '%音樂祭%' THEN 'tour'
  ELSE 'album' END
WHERE `series_type` LIKE '%EP%' OR `series_type` LIKE '%單曲%' OR `series_type` LIKE '%巡迴%' OR `series_type` LIKE '%演唱會%' OR `series_type` LIKE '%演出%' OR `series_type` LIKE '%音樂祭%';
