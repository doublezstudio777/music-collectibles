CREATE TABLE `artist_duplicate_marks` (
	`pair_key` text PRIMARY KEY NOT NULL,
	`decision` text DEFAULT 'not_duplicate' NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
