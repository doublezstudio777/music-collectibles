CREATE TABLE `artist_redirects` (
	`old_slug` text PRIMARY KEY NOT NULL,
	`new_slug` text NOT NULL,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artist_redirects_new_idx` ON `artist_redirects` (`new_slug`);