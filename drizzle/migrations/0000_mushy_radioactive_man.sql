CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`color` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`google_cal_id` text,
	`sync_token` text,
	`ics_url` text,
	`ics_etag` text,
	`ics_last_mod` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`provider` text PRIMARY KEY NOT NULL,
	`payload_encrypted` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `raw_events` (
	`calendar_id` text NOT NULL,
	`uid` text NOT NULL,
	`recurrence_id` text,
	`updated_ts` integer NOT NULL,
	`status` text,
	`all_day` integer NOT NULL,
	`start_iso` text NOT NULL,
	`end_iso` text NOT NULL,
	`tzid` text,
	`summary` text,
	`location` text,
	`description` text,
	`recurrence_json` text,
	`source_json` text NOT NULL
);
