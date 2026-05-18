CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`bio` text,
	`telegram_chat_id` text,
	`availability` text DEFAULT '{"tz":null,"windows":[],"blackouts":[]}' NOT NULL,
	`avatar_url` text,
	`timezone` text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_slug_unique` ON `teachers` (`slug`);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_email_unique` ON `teachers` (`email`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`starts_at_utc` integer NOT NULL,
	`duration_minutes` integer DEFAULT 60 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`visitor_name` text NOT NULL,
	`visitor_email` text NOT NULL,
	`contact_pref` text NOT NULL,
	`contact_value` text NOT NULL,
	`visitor_intent` text,
	`visitor_timezone` text,
	`notes_internal` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT `sessions_status_check` CHECK(status IN ('pending', 'confirmed', 'cancelled', 'rejected', 'no_show', 'completed')),
	CONSTRAINT `sessions_contact_pref_check` CHECK(contact_pref IN ('email', 'whatsapp', 'phone'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_teacher_slot_confirmed` ON `sessions` (`teacher_id`,`starts_at_utc`) WHERE status = 'confirmed';
--> statement-breakpoint
CREATE INDEX `sessions_status_created_idx` ON `sessions` (`status`,`created_at`) WHERE status = 'pending';
--> statement-breakpoint
CREATE INDEX `sessions_teacher_starts_idx` ON `sessions` (`teacher_id`,`starts_at_utc`);
--> statement-breakpoint
CREATE INDEX `sessions_starts_idx` ON `sessions` (`starts_at_utc`);
