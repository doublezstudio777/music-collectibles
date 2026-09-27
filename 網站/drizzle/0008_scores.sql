CREATE TABLE `score_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`occurred_at` text NOT NULL,
	`available_at` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`detail` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_events_source_uq` ON `score_events` (`source`);--> statement-breakpoint
CREATE INDEX `score_events_user_idx` ON `score_events` (`user_id`,`kind`);--> statement-breakpoint
CREATE INDEX `score_events_kind_idx` ON `score_events` (`kind`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `user_scores` (
	`user_id` text PRIMARY KEY NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_titles` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`since` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `ref`)
);
--> statement-breakpoint
CREATE INDEX `user_titles_ref_idx` ON `user_titles` (`kind`,`ref`);