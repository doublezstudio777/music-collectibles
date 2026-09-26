CREATE TABLE `admin_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`admin_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_log_created_idx` ON `admin_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `appeals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`by_id` text NOT NULL,
	`text` text NOT NULL,
	`photo_ids` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `appeals_target_idx` ON `appeals` (`target`);--> statement-breakpoint
CREATE INDEX `appeals_status_idx` ON `appeals` (`status`);--> statement-breakpoint
CREATE TABLE `artists` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`kind` text DEFAULT '藝人' NOT NULL,
	`gender` text,
	`region` text,
	`tagline` text DEFAULT '' NOT NULL,
	`intro` text DEFAULT '[]' NOT NULL,
	`awards` text DEFAULT '[]' NOT NULL,
	`wiki_url` text,
	`wiki_license` text,
	`wiki_fetched_at` text,
	`source` text,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_by` text,
	`last_edit_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `artists_status_idx` ON `artists` (`status`);--> statement-breakpoint
CREATE TABLE `counters` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_series_item_uq` ON `items` (`series_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`from_id` text,
	`text` text,
	`offer_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `messages_thread_idx` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`buyer_id` text NOT NULL,
	`thread_id` integer NOT NULL,
	`kind` text NOT NULL,
	`price` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `offers_share_idx` ON `offers` (`share_no`);--> statement-breakpoint
CREATE INDEX `offers_buyer_idx` ON `offers` (`buyer_id`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`purpose` text DEFAULT 'share' NOT NULL,
	`share_no` integer,
	`r2_key` text NOT NULL,
	`thumb_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `photos_share_idx` ON `photos` (`share_no`);--> statement-breakpoint
CREATE INDEX `photos_owner_idx` ON `photos` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_target_reporter_uq` ON `reports` (`target`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `reports_target_idx` ON `reports` (`target`);--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artist_slug` text NOT NULL,
	`no` integer NOT NULL,
	`title` text NOT NULL,
	`name` text NOT NULL,
	`series_type` text DEFAULT '' NOT NULL,
	`credits` text DEFAULT '[]' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '[]' NOT NULL,
	`guests` text DEFAULT '[]' NOT NULL,
	`compilation` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_by` text,
	`last_edit_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_artist_no_uq` ON `series` (`artist_slug`,`no`);--> statement-breakpoint
CREATE INDEX `series_status_idx` ON `series` (`status`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`no` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`author_id` text NOT NULL,
	`what` text NOT NULL,
	`kind` text NOT NULL,
	`kind_note` text,
	`story` text DEFAULT '' NOT NULL,
	`about` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`series_key` text,
	`item_id` text,
	`version_id` text,
	`ref_photo` integer DEFAULT 0 NOT NULL,
	`color` text DEFAULT '' NOT NULL,
	`sale_state` text DEFAULT 'share' NOT NULL,
	`price` integer,
	`sold_price` integer,
	`sold_to` text,
	`sold_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `shares_author_idx` ON `shares` (`author_id`);--> statement-breakpoint
CREATE INDEX `shares_series_idx` ON `shares` (`series_key`);--> statement-breakpoint
CREATE TABLE `target_decisions` (
	`target` text PRIMARY KEY NOT NULL,
	`decision` text NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_reads` (
	`thread_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`last_message_id` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`thread_id`, `user_id`)
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`buyer_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_share_buyer_uq` ON `threads` (`share_no`,`buyer_id`);--> statement-breakpoint
CREATE INDEX `threads_buyer_idx` ON `threads` (`buyer_id`);--> statement-breakpoint
CREATE TABLE `version_fakes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_ref` integer NOT NULL,
	`name` text NOT NULL,
	`seen` text DEFAULT '' NOT NULL,
	`rows` text DEFAULT '[]' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `version_fakes_version_idx` ON `version_fakes` (`version_ref`);--> statement-breakpoint
CREATE TABLE `version_marks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version_ref` integer NOT NULL,
	`label` text NOT NULL,
	`text` text NOT NULL,
	`photo_note` text,
	`photo_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `version_marks_version_idx` ON `version_marks` (`version_ref`);--> statement-breakpoint
CREATE TABLE `versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_ref` integer NOT NULL,
	`version_id` text NOT NULL,
	`edition` text NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`region` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`catalog` text DEFAULT '待查證' NOT NULL,
	`barcode` text DEFAULT '無條碼' NOT NULL,
	`packaging` text DEFAULT '' NOT NULL,
	`contents` text DEFAULT '' NOT NULL,
	`tracks` text DEFAULT '' NOT NULL,
	`identify_by` text DEFAULT '' NOT NULL,
	`data_status` text DEFAULT '待確認' NOT NULL,
	`color` text DEFAULT '#22334D' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `versions_item_version_uq` ON `versions` (`item_ref`,`version_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `deletion_requested_at` text;