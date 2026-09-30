CREATE TABLE `spotify_artists` (
	`artist_slug` text PRIMARY KEY NOT NULL,
	`spotify_id` text NOT NULL,
	`source` text NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`albums` text,
	`albums_at` text,
	`drawn_on` text,
	`track_id` text,
	`title` text,
	`album_name` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spotify_draws` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`artist_slug` text NOT NULL,
	`track_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`album_id` text DEFAULT '' NOT NULL,
	`album_name` text DEFAULT '' NOT NULL,
	`drawn_on` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `spotify_draws_artist_idx` ON `spotify_draws` (`artist_slug`,`id`);--> statement-breakpoint
CREATE INDEX `spotify_draws_day_idx` ON `spotify_draws` (`drawn_on`);--> statement-breakpoint
CREATE TABLE `spotify_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
