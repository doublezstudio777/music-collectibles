-- MusicBrainz 匯入與曲目（2026-09-28）：只新增欄位與索引，不動既有資料
ALTER TABLE `artists` ADD `mbid` text;--> statement-breakpoint
ALTER TABLE `items` ADD `source` text;--> statement-breakpoint
ALTER TABLE `series` ADD `mbid` text;--> statement-breakpoint
ALTER TABLE `series` ADD `source` text;--> statement-breakpoint
CREATE INDEX `series_mbid_idx` ON `series` (`mbid`);--> statement-breakpoint
ALTER TABLE `versions` ADD `mbid` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `source` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `release_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `track_list` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `versions_mbid_idx` ON `versions` (`mbid`);