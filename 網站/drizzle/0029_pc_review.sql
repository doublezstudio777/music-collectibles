CREATE TABLE `retired_handles` (
	`handle` text PRIMARY KEY NOT NULL,
	`retired_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
