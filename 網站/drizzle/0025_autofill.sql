CREATE TABLE `autofill_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`addition_id` integer NOT NULL,
	`type` text NOT NULL,
	`ref` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`confidence` text,
	`result` text DEFAULT '{}' NOT NULL,
	`applied` text DEFAULT '{}' NOT NULL,
	`decision` text,
	`hint` text,
	`tries` integer DEFAULT 0 NOT NULL,
	`next_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `autofill_jobs_addition_uq` ON `autofill_jobs` (`addition_id`);--> statement-breakpoint
CREATE INDEX `autofill_jobs_status_idx` ON `autofill_jobs` (`status`,`next_at`);--> statement-breakpoint
CREATE TABLE `autofill_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
