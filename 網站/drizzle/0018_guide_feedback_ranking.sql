CREATE TABLE `feedback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`user_id` text,
	`photo_key` text,
	`thumb_key` text,
	`photo_bytes` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`handled_by` text,
	`handled_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_status_idx` ON `feedback` (`status`,`id`);--> statement-breakpoint
CREATE TABLE `rankings` (
	`board` text NOT NULL,
	`pos` integer NOT NULL,
	`user_id` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`board`, `pos`)
);
--> statement-breakpoint
CREATE INDEX `rankings_user_idx` ON `rankings` (`user_id`,`board`);