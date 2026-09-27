CREATE TABLE `artist_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artist_slug` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`r2_key` text NOT NULL,
	`thumb_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`submitter_id` text,
	`author` text DEFAULT '' NOT NULL,
	`author_url` text,
	`license` text NOT NULL,
	`license_url` text,
	`source_url` text,
	`source_file` text,
	`occasion` text DEFAULT '' NOT NULL,
	`occasion_date` text DEFAULT '' NOT NULL,
	`agreed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`activated_at` text,
	`handled_at` text,
	`handled_by` text,
	`note` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artist_photos_artist_idx` ON `artist_photos` (`artist_slug`,`status`);--> statement-breakpoint
CREATE INDEX `artist_photos_status_idx` ON `artist_photos` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `artist_photos_submitter_idx` ON `artist_photos` (`submitter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artist_photos_r2key_idx` ON `artist_photos` (`r2_key`);--> statement-breakpoint
CREATE INDEX `artist_photos_thumbkey_idx` ON `artist_photos` (`thumb_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `artist_photos_active_uq` ON `artist_photos` (`artist_slug`) WHERE status = 'active';--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_photos_insert` AFTER INSERT ON `artist_photos` WHEN NEW.`status` = 'active' BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_photos_update` AFTER UPDATE ON `artist_photos` WHEN OLD.`status` = 'active' OR NEW.`status` = 'active' BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_photos_delete` AFTER DELETE ON `artist_photos` WHEN OLD.`status` = 'active' BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
