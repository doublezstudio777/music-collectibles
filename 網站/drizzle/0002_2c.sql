CREATE TABLE `artist_dismissals` (
	`user_id` text NOT NULL,
	`artist_slug` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`user_id`, `artist_slug`)
);
--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`offer_id` integer,
	`version_key` text,
	`price` integer NOT NULL,
	`seller_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`sold_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`voided_at` text
);
--> statement-breakpoint
CREATE INDEX `deals_version_idx` ON `deals` (`version_key`,`sold_at`);--> statement-breakpoint
CREATE INDEX `deals_share_idx` ON `deals` (`share_no`);--> statement-breakpoint
CREATE TABLE `page_locks` (
	`target` text PRIMARY KEY NOT NULL,
	`locked_by` text NOT NULL,
	`locked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target` text NOT NULL,
	`field` text NOT NULL,
	`content` text NOT NULL,
	`summary` text NOT NULL,
	`author_id` text,
	`reverted_from` integer,
	`license` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `revisions_target_idx` ON `revisions` (`target`,`id`);--> statement-breakpoint
ALTER TABLE `artists` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `artists` ADD `display` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `series` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `shares` ADD `hidden_at` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `hidden_at` text;--> statement-breakpoint
CREATE INDEX `photos_r2key_idx` ON `photos` (`r2_key`);--> statement-breakpoint
CREATE INDEX `photos_thumbkey_idx` ON `photos` (`thumb_key`);