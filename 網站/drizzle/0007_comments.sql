CREATE TABLE `comment_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`comment_id` integer NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `comment_reports_uq` ON `comment_reports` (`comment_id`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `comment_reports_comment_idx` ON `comment_reports` (`comment_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`share_no` integer NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`deleted_at` text,
	`deleted_by` text,
	`hidden_at` text,
	`decision` text
);
--> statement-breakpoint
CREATE INDEX `comments_share_idx` ON `comments` (`share_no`,`id`);--> statement-breakpoint
CREATE INDEX `comments_author_idx` ON `comments` (`author_id`);