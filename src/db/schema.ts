'use strict';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const calendars = sqliteTable('calendars', {
	id: text('id').primaryKey(),
	type: text('type').notNull(), // 'google' | 'ics'
	label: text('label'),
	color: text('color'),
	enabled: integer('enabled').notNull().default(1),
	googleCalId: text('google_cal_id'),
	syncToken: text('sync_token'),
	icsUrl: text('ics_url'),
	icsEtag: text('ics_etag'),
	icsLastMod: text('ics_last_mod'),
	updatedAt: integer('updated_at').notNull(),
});

export const rawEvents = sqliteTable('raw_events', {
	calendarId: text('calendar_id').notNull(),
	uid: text('uid').notNull(),
	recurrenceId: text('recurrence_id'), // UTC ISO when present
	updatedTs: integer('updated_ts').notNull(), // epoch ms
	status: text('status'),
	allDay: integer('all_day').notNull(),
	startIso: text('start_iso').notNull(), // UTC ISO
	endIso: text('end_iso').notNull(), // UTC ISO
	tzid: text('tzid'),
	summary: text('summary'),
	location: text('location'),
	description: text('description'),
	recurrenceJson: text('recurrence_json'),
	sourceJson: text('source_json').notNull(),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
	provider: text('provider').primaryKey(), // 'google'
	payloadEncrypted: text('payload_encrypted').notNull(),
	updatedAt: integer('updated_at').notNull(),
});
