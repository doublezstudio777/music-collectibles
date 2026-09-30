ALTER TABLE `users` ADD `links` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `fav_artists` text DEFAULT '[]' NOT NULL;