CREATE TABLE `takedown_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`claimant_name` text NOT NULL,
	`claimant_email` text NOT NULL,
	`claimant_phone` text DEFAULT '' NOT NULL,
	`claimant_address` text DEFAULT '' NOT NULL,
	`role` text NOT NULL,
	`right_type` text NOT NULL,
	`work` text NOT NULL,
	`urls` text DEFAULT '[]' NOT NULL,
	`detail` text NOT NULL,
	`shares` text DEFAULT '[]' NOT NULL,
	`member_id` text,
	`counter_text` text,
	`counter_at` text,
	`forwarded_at` text,
	`restore_due` text,
	`strike` integer DEFAULT 0 NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `takedown_notices_status_idx` ON `takedown_notices` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `takedown_notices_member_idx` ON `takedown_notices` (`member_id`);--> statement-breakpoint
CREATE TABLE `terms_consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`via` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `terms_consents_user_idx` ON `terms_consents` (`user_id`,`id`);--> statement-breakpoint
ALTER TABLE `deletion_requests` ADD `reburned_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_version` text;--> statement-breakpoint
ALTER TABLE `users` ADD `terms_accepted_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `copyright_strikes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 既有已執行的刪帳：沒有留下收藏照片（或當時勾了一併刪除）的，不用重燒，reburned_at 補成執行時間；
-- 留下照片的維持 NULL，後台「刪帳申請」會列成待重燒（舊浮水印確實還印著原帳號名）
UPDATE `deletion_requests` SET `reburned_at` = `handled_at` WHERE `status` = 'done' AND `reburned_at` IS NULL AND NOT EXISTS (SELECT 1 FROM `photos` p WHERE p.`owner_id` = `deletion_requests`.`user_id` AND p.`deleted_at` IS NULL AND p.`purpose` = 'share');
