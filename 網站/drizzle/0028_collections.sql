CREATE TABLE `collection_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`target_key` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`photo_id` text,
	`x` real,
	`y` real,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_tags_share_target_uq` ON `collection_tags` (`share_no`,`target_key`);--> statement-breakpoint
CREATE INDEX `collection_tags_target_idx` ON `collection_tags` (`target_key`);--> statement-breakpoint
ALTER TABLE `shares` ADD `post_type` text DEFAULT 'single' NOT NULL;--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_collection_tags_insert` AFTER INSERT ON `collection_tags` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_collection_tags_update` AFTER UPDATE ON `collection_tags` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_collection_tags_delete` AFTER DELETE ON `collection_tags` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
