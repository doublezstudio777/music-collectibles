CREATE TABLE `deletion_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`handled_at` text,
	`handled_by` text,
	`delete_photos` integer DEFAULT 0 NOT NULL,
	`result` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deletion_requests_status_idx` ON `deletion_requests` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `deletion_requests_user_idx` ON `deletion_requests` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_name_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`old_name` text NOT NULL,
	`new_name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `user_name_changes_user_idx` ON `user_name_changes` (`user_id`,`id`);--> statement-breakpoint
ALTER TABLE `users` ADD `name_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `name_changed_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_key` text;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `users_name_key_idx` ON `users` (`name_key`);