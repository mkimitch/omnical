-- Add calendar customization columns
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "calendars" ADD COLUMN "icon" text;
ALTER TABLE "calendars" ADD COLUMN "sort_order" integer DEFAULT 0;
ALTER TABLE "calendars" ADD COLUMN "description" text;

COMMIT;
