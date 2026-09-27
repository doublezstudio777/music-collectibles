CREATE TABLE `level_overrides` (
	`user_id` text PRIMARY KEY NOT NULL,
	`level` integer NOT NULL,
	`reason` text NOT NULL,
	`by_admin` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suspensions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`by_admin` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `suspensions_user_idx` ON `suspensions` (`user_id`,`started_at`);--> statement-breakpoint
-- 遷移前就停權的帳號補一筆停權紀錄：時間與說明取最近一次「停權會員」的操作紀錄，沒有就用帳號最後更新時間
INSERT INTO `suspensions` (`user_id`, `reason`, `note`, `started_at`, `by_admin`)
SELECT u.id, 'other',
  COALESCE((SELECT json_extract(l.detail, '$.reason') FROM admin_log l WHERE l.target = 'user:' || u.handle AND l.action = '停權會員' ORDER BY l.id DESC LIMIT 1), '上線前停權，原因未記錄'),
  COALESCE((SELECT l.created_at FROM admin_log l WHERE l.target = 'user:' || u.handle AND l.action = '停權會員' ORDER BY l.id DESC LIMIT 1), u.updated_at),
  COALESCE((SELECT l.admin_id FROM admin_log l WHERE l.target = 'user:' || u.handle AND l.action = '停權會員' ORDER BY l.id DESC LIMIT 1), '')
FROM users u WHERE u.status = 'suspended';
