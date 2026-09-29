CREATE TABLE `photo_codes` (
	`code` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`photo_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `photos` ADD `verify_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `photos_verify_code_uq` ON `photos` (`verify_code`);