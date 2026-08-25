CREATE TABLE `whatsapp_sessions` (
	`phone` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'start' NOT NULL,
	`category` text,
	`search_results` text DEFAULT '[]' NOT NULL,
	`cart` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
