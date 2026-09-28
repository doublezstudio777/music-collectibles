CREATE TABLE `catalog_addition_edits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`addition_id` integer NOT NULL,
	`by_id` text NOT NULL,
	`from_name` text NOT NULL,
	`to_name` text NOT NULL,
	`from_year` text DEFAULT '' NOT NULL,
	`to_year` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `catalog_addition_edits_addition_idx` ON `catalog_addition_edits` (`addition_id`);--> statement-breakpoint
CREATE TABLE `catalog_additions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`ref` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`confirmed_at` text,
	`confirmed_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_additions_ref_uq` ON `catalog_additions` (`type`,`ref`);--> statement-breakpoint
CREATE INDEX `catalog_additions_by_idx` ON `catalog_additions` (`created_by`);--> statement-breakpoint
ALTER TABLE `shares` ADD `custom_what` text;