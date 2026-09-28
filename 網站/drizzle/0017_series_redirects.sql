CREATE TABLE `series_redirects` (
	`old_key` text PRIMARY KEY NOT NULL,
	`new_key` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `series_redirects_new_idx` ON `series_redirects` (`new_key`);