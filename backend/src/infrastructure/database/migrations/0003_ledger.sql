CREATE TABLE `postings` (
	`transaction_id` text NOT NULL,
	`position` integer NOT NULL,
	`account_id` text,
	`category_id` text,
	`system_role` text,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `position`),
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "postings_exactly_one_target" CHECK(("postings"."account_id" IS NOT NULL) + ("postings"."category_id" IS NOT NULL) + ("postings"."system_role" IS NOT NULL) = 1)
);
--> statement-breakpoint
CREATE INDEX `postings_account_id_idx` ON `postings` (`account_id`);--> statement-breakpoint
CREATE INDEX `postings_category_id_idx` ON `postings` (`category_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`exchange_rate` text,
	`voided_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
