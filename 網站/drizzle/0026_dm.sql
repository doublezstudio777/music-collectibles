CREATE TABLE `dm_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`reporter_id` text NOT NULL,
	`reported_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`handled_by` text,
	`handled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dm_reports_thread_reporter_uq` ON `dm_reports` (`thread_id`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `dm_reports_status_idx` ON `dm_reports` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `dm_reports_reported_idx` ON `dm_reports` (`reported_id`);--> statement-breakpoint
CREATE TABLE `user_blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`blocker_id`, `blocked_id`)
);
--> statement-breakpoint
CREATE INDEX `user_blocks_blocked_idx` ON `user_blocks` (`blocked_id`);--> statement-breakpoint
DROP INDEX `threads_share_buyer_uq`;--> statement-breakpoint
ALTER TABLE `threads` ADD `peer_id` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `pair_key` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `started_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `threads_pair_uq` ON `threads` (`pair_key`) WHERE pair_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_peer_idx` ON `threads` (`peer_id`);--> statement-breakpoint
CREATE INDEX `threads_started_idx` ON `threads` (`buyer_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `threads_share_buyer_uq` ON `threads` (`share_no`,`buyer_id`) WHERE share_no > 0;--> statement-breakpoint
-- 既有對話補 started_at（第一則訊息時間），每日開新對話上限才算得到今天以前開的
UPDATE `threads` SET `started_at` = (SELECT MIN(`created_at`) FROM `messages` WHERE `messages`.`thread_id` = `threads`.`id`) WHERE `started_at` IS NULL;