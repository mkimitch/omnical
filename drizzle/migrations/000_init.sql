-- Drizzle SQL migration: initial schema
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"label" text,
	"color" text,
	"enabled" integer NOT NULL DEFAULT 1,
	"google_cal_id" text,
	"sync_token" text,
	"ics_url" text,
	"ics_etag" text,
	"ics_last_mod" text,
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"description" text,
	"updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "raw_events" (
	"calendar_id" text NOT NULL,
	"uid" text NOT NULL,
	"recurrence_id" text,
	"updated_ts" integer NOT NULL,
	"status" text,
	"all_day" integer NOT NULL,
	"start_iso" text NOT NULL,
	"end_iso" text NOT NULL,
	"tzid" text,
	"summary" text,
	"location" text,
	"description" text,
	"recurrence_json" text,
	"source_json" text NOT NULL
);

-- Unique index that treats NULL recurrence_id as 'master'
CREATE UNIQUE INDEX IF NOT EXISTS "raw_events_cal_uid_reckey" ON "raw_events" (
	"calendar_id",
	"uid",
	COALESCE("recurrence_id", 'master')
);

-- Helpful indices for time-window queries
CREATE INDEX IF NOT EXISTS "raw_events_start_end" ON "raw_events" ("start_iso", "end_iso");
CREATE INDEX IF NOT EXISTS "raw_events_cal_start" ON "raw_events" ("calendar_id", "start_iso");
CREATE INDEX IF NOT EXISTS "raw_events_cal_uid" ON "raw_events" ("calendar_id", "uid");

CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"provider" text PRIMARY KEY NOT NULL,
	"payload_encrypted" text NOT NULL,
	"updated_at" integer NOT NULL
);

COMMIT;
