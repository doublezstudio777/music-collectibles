CREATE TABLE `spotify_albums` (
	`album_id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`tracks` text DEFAULT '[]' NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
