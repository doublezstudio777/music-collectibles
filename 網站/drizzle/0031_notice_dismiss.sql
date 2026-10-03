CREATE TABLE `user_notices` (
	`user_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
