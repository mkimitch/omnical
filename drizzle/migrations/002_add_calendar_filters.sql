PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

ALTER TABLE "calendars" ADD COLUMN "filter_json" text;

COMMIT;
