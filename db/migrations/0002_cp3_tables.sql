CREATE TABLE `notify_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`status` integer NOT NULL,
	`error_body` text,
	`attempt_number` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `notify_log_event_kind_check` CHECK(event_kind IN ('visitor_receipt', 'visitor_confirm', 'visitor_decline', 'visitor_cancel', 'maestro_fallback', 'maestro_failure')),
	CONSTRAINT `notify_log_channel_check` CHECK(channel IN ('telegram', 'resend'))
);
--> statement-breakpoint
CREATE TABLE `teacher_onboarding_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`teacher_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`ip` text NOT NULL,
	`hour_bucket` integer NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`ip`, `hour_bucket`)
);
