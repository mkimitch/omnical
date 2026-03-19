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
	icon: text('icon'),
	sortOrder: integer('sort_order').default(0),
	description: text('description'),
	filterJson: text('filter_json'),
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
	transparency: text('transparency').default('opaque'),
});

export const oauthTokens = sqliteTable('oauth_tokens', {
	provider: text('provider').primaryKey(), // 'google'
	payloadEncrypted: text('payload_encrypted').notNull(),
	updatedAt: integer('updated_at').notNull(),
});

export const taskLists = sqliteTable('task_lists', {
	id: text('id').primaryKey(), // gtlist_{sha1(googleId).slice(0,12)}
	googleTaskListId: text('google_task_list_id').notNull(),
	label: text('label'),
	color: text('color'),
	enabled: integer('enabled').notNull().default(1),
	sortOrder: integer('sort_order').default(0),
	lastSyncedAt: integer('last_synced_at'), // epoch ms of max(task.updated) seen; NULL = never synced
	updatedAt: integer('updated_at').notNull(),
});

export const rawTasks = sqliteTable('raw_tasks', {
	taskListId: text('task_list_id').notNull(), // references task_lists.id (unenforced)
	taskId: text('task_id').notNull(), // Google's task ID
	title: text('title'),
	notes: text('notes'),
	status: text('status').notNull().default('needsAction'), // 'needsAction' | 'completed'
	dueIso: text('due_iso'), // UTC date ISO or NULL (date-only from Google)
	completedIso: text('completed_iso'), // UTC datetime ISO or NULL
	deleted: integer('deleted').notNull().default(0),
	hidden: integer('hidden').notNull().default(0),
	position: text('position'), // lexicographic ordering string
	parent: text('parent'), // parent task_id for subtasks; NULL = top-level
	updatedTs: integer('updated_ts').notNull(), // epoch ms
	sourceJson: text('source_json').notNull(), // raw Google Task JSON
});
