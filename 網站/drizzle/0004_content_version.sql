CREATE TABLE `content_version` (
	`id` integer PRIMARY KEY NOT NULL,
	`v` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `content_version` (`id`, `v`) VALUES (1, 0);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artists_insert` AFTER INSERT ON `artists` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artists_update` AFTER UPDATE ON `artists` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artists_delete` AFTER DELETE ON `artists` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_series_insert` AFTER INSERT ON `series` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_series_update` AFTER UPDATE ON `series` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_series_delete` AFTER DELETE ON `series` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_items_insert` AFTER INSERT ON `items` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_items_update` AFTER UPDATE ON `items` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_items_delete` AFTER DELETE ON `items` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_versions_insert` AFTER INSERT ON `versions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_versions_update` AFTER UPDATE ON `versions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_versions_delete` AFTER DELETE ON `versions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_marks_insert` AFTER INSERT ON `version_marks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_marks_update` AFTER UPDATE ON `version_marks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_marks_delete` AFTER DELETE ON `version_marks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_fakes_insert` AFTER INSERT ON `version_fakes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_fakes_update` AFTER UPDATE ON `version_fakes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_version_fakes_delete` AFTER DELETE ON `version_fakes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_shares_insert` AFTER INSERT ON `shares` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_shares_update` AFTER UPDATE ON `shares` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_shares_delete` AFTER DELETE ON `shares` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_photos_insert` AFTER INSERT ON `photos` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_photos_update` AFTER UPDATE ON `photos` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_photos_delete` AFTER DELETE ON `photos` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_users_insert` AFTER INSERT ON `users` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_users_update` AFTER UPDATE ON `users` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_users_delete` AFTER DELETE ON `users` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_likes_insert` AFTER INSERT ON `likes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_likes_update` AFTER UPDATE ON `likes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_likes_delete` AFTER DELETE ON `likes` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_holdings_insert` AFTER INSERT ON `holdings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_holdings_update` AFTER UPDATE ON `holdings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_holdings_delete` AFTER DELETE ON `holdings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_reports_insert` AFTER INSERT ON `reports` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_reports_update` AFTER UPDATE ON `reports` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_reports_delete` AFTER DELETE ON `reports` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_target_decisions_insert` AFTER INSERT ON `target_decisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_target_decisions_update` AFTER UPDATE ON `target_decisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_target_decisions_delete` AFTER DELETE ON `target_decisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_settings_insert` AFTER INSERT ON `settings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_settings_update` AFTER UPDATE ON `settings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_settings_delete` AFTER DELETE ON `settings` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_revisions_insert` AFTER INSERT ON `revisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_revisions_update` AFTER UPDATE ON `revisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_revisions_delete` AFTER DELETE ON `revisions` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_deals_insert` AFTER INSERT ON `deals` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_deals_update` AFTER UPDATE ON `deals` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_deals_delete` AFTER DELETE ON `deals` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_offers_insert` AFTER INSERT ON `offers` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_offers_update` AFTER UPDATE ON `offers` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_offers_delete` AFTER DELETE ON `offers` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_redirects_insert` AFTER INSERT ON `artist_redirects` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_redirects_update` AFTER UPDATE ON `artist_redirects` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_artist_redirects_delete` AFTER DELETE ON `artist_redirects` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_page_locks_insert` AFTER INSERT ON `page_locks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_page_locks_update` AFTER UPDATE ON `page_locks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `cv_page_locks_delete` AFTER DELETE ON `page_locks` BEGIN UPDATE `content_version` SET `v` = `v` + 1 WHERE `id` = 1; END;
