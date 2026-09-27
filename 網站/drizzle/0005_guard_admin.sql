CREATE TABLE `user_activity` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`country` text NOT NULL,
	PRIMARY KEY(`user_id`, `day`, `country`)
);
--> statement-breakpoint
CREATE INDEX `user_activity_day_idx` ON `user_activity` (`day`);--> statement-breakpoint
CREATE TABLE `user_geo` (
	`user_id` text PRIMARY KEY NOT NULL,
	`register_country` text,
	`last_login_country` text,
	`last_login_at` text
);
--> statement-breakpoint
-- 按讚、我有、想要不再讓整頁快取作廢（讚數改由 /api/counts 取得）。只拿掉觸發器，表與資料不動
DROP TRIGGER IF EXISTS `cv_likes_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cv_likes_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cv_likes_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cv_holdings_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cv_holdings_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `cv_holdings_delete`;
