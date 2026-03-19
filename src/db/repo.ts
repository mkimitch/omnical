'use strict';
import { loadEnv } from '../config/env.js';
import { sha1 } from '../util/hash.js';
import { getDb } from './conn.js';

export type CalendarRow = {
	color: string | null;
	description: string | null;
	enabled: number;
	filter_json: string | null;
	google_cal_id: string | null;
	icon: string | null;
	ics_etag: string | null;
	ics_last_mod: string | null;
	ics_url: string | null;
	id: string;
	label: string | null;
	sort_order: number | null;
	sync_token: string | null;
	type: 'google' | 'ics';
	updated_at: number;
};

export const listCalendars = (): CalendarRow[] => {
	const { sqlite } = getDb();
	return sqlite
		.prepare('SELECT * FROM calendars ORDER BY sort_order ASC, id ASC')
		.all() as CalendarRow[];
};

export const listEnabledCalendars = (): CalendarRow[] => {
	const { sqlite } = getDb();
	return sqlite
		.prepare('SELECT * FROM calendars WHERE enabled = 1 ORDER BY sort_order ASC, id ASC')
		.all() as CalendarRow[];
};

export const getCalendarById = (id: string): CalendarRow | null => {
	const { sqlite } = getDb();
	const row = sqlite.prepare('SELECT * FROM calendars WHERE id = ?').get(id);
	return row ? (row as CalendarRow) : null;
};

export const upsertCalendarIcs = (url: string, label?: string): CalendarRow => {
	const { sqlite } = getDb();
	const id = `ics_${sha1(url).slice(0, 12)}`;
	sqlite
		.prepare(
			`INSERT INTO calendars (id, type, label, color, enabled, google_cal_id, sync_token, ics_url, ics_etag, ics_last_mod, updated_at)
			 VALUES (@id, 'ics', COALESCE(@label, @ics_url), NULL, 1, NULL, NULL, @ics_url, NULL, NULL, @updated_at)
			 ON CONFLICT(id) DO UPDATE SET label = COALESCE(@label, calendars.label), ics_url = excluded.ics_url, updated_at = excluded.updated_at`,
		)
		.run({ id, label: label ?? null, ics_url: url, updated_at: Date.now() });
	return sqlite.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as CalendarRow;
};

export const ensureIcsCalendarsFromEnv = (): CalendarRow[] => {
	const env = loadEnv();
	const rows: CalendarRow[] = [];
	for (const url of env.icsUrls) {
		rows.push(upsertCalendarIcs(url));
	}
	return rows;
};

export const upsertCalendarGoogle = (googleCalId: string, label?: string): CalendarRow => {
	const { sqlite } = getDb();
	const id = `gcal_${sha1(googleCalId).slice(0, 12)}`;
	sqlite
		.prepare(
			`INSERT INTO calendars (id, type, label, color, enabled, google_cal_id, sync_token, ics_url, ics_etag, ics_last_mod, updated_at)
			 VALUES (@id, 'google', COALESCE(@label, @google_cal_id), NULL, 1, @google_cal_id, NULL, NULL, NULL, NULL, @updated_at)
			 ON CONFLICT(id) DO UPDATE SET label = COALESCE(@label, calendars.label), google_cal_id = excluded.google_cal_id, updated_at = excluded.updated_at`,
		)
		.run({ id, label: label ?? null, google_cal_id: googleCalId, updated_at: Date.now() });
	return sqlite.prepare('SELECT * FROM calendars WHERE id = ?').get(id) as CalendarRow;
};

export type RawEventRow = {
	all_day: number; // 0/1
	calendar_id: string;
	description: string | null;
	end_iso: string; // UTC ISO
	location: string | null;
	recurrence_id: string | null;
	recurrence_json: string | null;
	source_json: string;
	start_iso: string; // UTC ISO
	status: string | null;
	summary: string | null;
	transparency: string | null; // 'opaque' | 'transparent'
	tzid: string | null;
	uid: string;
	updated_ts: number;
};

export const deleteRawEventsByCalendar = (calendarId: string): void => {
	const { sqlite } = getDb();
	sqlite.prepare('DELETE FROM raw_events WHERE calendar_id = ?').run(calendarId);
};

export const deleteRawEventsByUid = (calendarId: string, uid: string): void => {
	const { sqlite } = getDb();
	sqlite.prepare('DELETE FROM raw_events WHERE calendar_id = ? AND uid = ?').run(calendarId, uid);
};

export const deleteRawEventByRecurrence = (
	calendarId: string,
	uid: string,
	recurrenceId: string,
): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare(
			"DELETE FROM raw_events WHERE calendar_id = ? AND uid = ? AND COALESCE(recurrence_id, 'master') = ?",
		)
		.run(calendarId, uid, recurrenceId ?? 'master');
};

export const upsertRawEvent = (row: RawEventRow): void => {
	const { sqlite } = getDb();
	const reckey = row.recurrence_id ?? 'master';
	// Delete existing row (by calendar_id, uid, and normalized recurrence key)
	sqlite
		.prepare(
			"DELETE FROM raw_events WHERE calendar_id = ? AND uid = ? AND COALESCE(recurrence_id, 'master') = ?",
		)
		.run(row.calendar_id, row.uid, reckey);
	// Insert fresh row
	sqlite
		.prepare(
			`INSERT INTO raw_events (
				calendar_id, uid, recurrence_id, updated_ts, status, all_day, start_iso, end_iso, tzid,
				summary, location, description, recurrence_json, source_json, transparency
			) VALUES (@calendar_id, @uid, @recurrence_id, @updated_ts, @status, @all_day, @start_iso, @end_iso, @tzid,
				@summary, @location, @description, @recurrence_json, @source_json, @transparency)`,
		)
		.run(row);
};

export const getExistingUpdatedTs = (
	calendarId: string,
	uid: string,
	recurrenceId: string | null,
): number | null => {
	const { sqlite } = getDb();
	const reckey = recurrenceId ?? 'master';
	const row = sqlite
		.prepare(
			"SELECT updated_ts FROM raw_events WHERE calendar_id = ? AND uid = ? AND COALESCE(recurrence_id, 'master') = ?",
		)
		.get(calendarId, uid, reckey) as { updated_ts: number } | undefined;
	return row ? row.updated_ts : null;
};

export const updateCalendarSyncToken = (id: string, syncToken: string | null): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare('UPDATE calendars SET sync_token = @syncToken, updated_at = @updatedAt WHERE id = @id')
		.run({ id, syncToken, updatedAt: Date.now() });
};

export const updateCalendarIcsState = (
	id: string,
	etag: string | null,
	lastMod: string | null,
): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare(
			'UPDATE calendars SET ics_etag = @etag, ics_last_mod = @lastMod, updated_at = @updatedAt WHERE id = @id',
		)
		.run({ id, etag, lastMod, updatedAt: Date.now() });
};

export type CalendarUpdateFields = {
	color?: string | null;
	description?: string | null;
	enabled?: boolean;
	filter_json?: string | null;
	icon?: string | null;
	label?: string | null;
	sort_order?: number | null;
};

export const updateCalendar = (id: string, fields: CalendarUpdateFields): CalendarRow | null => {
	const { sqlite } = getDb();
	const updates: string[] = [];
	const params: Record<string, any> = { id, updatedAt: Date.now() };

	if (fields.label !== undefined) {
		updates.push('label = @label');
		params.label = fields.label;
	}
	if (fields.color !== undefined) {
		updates.push('color = @color');
		params.color = fields.color;
	}
	if (fields.filter_json !== undefined) {
		updates.push('filter_json = @filter_json');
		params.filter_json = fields.filter_json;
	}
	if (fields.icon !== undefined) {
		updates.push('icon = @icon');
		params.icon = fields.icon;
	}
	if (fields.description !== undefined) {
		updates.push('description = @description');
		params.description = fields.description;
	}
	if (fields.sort_order !== undefined) {
		updates.push('sort_order = @sort_order');
		params.sort_order = fields.sort_order;
	}
	if (fields.enabled !== undefined) {
		updates.push('enabled = @enabled');
		params.enabled = fields.enabled ? 1 : 0;
	}

	if (updates.length === 0) return getCalendarById(id);

	const sql = `UPDATE calendars SET ${updates.join(', ')}, updated_at = @updatedAt WHERE id = @id`;
	sqlite.prepare(sql).run(params);
	return getCalendarById(id);
};

export const deleteCalendar = (id: string): boolean => {
	const { sqlite } = getDb();
	// Delete all raw events for this calendar
	sqlite.prepare('DELETE FROM raw_events WHERE calendar_id = ?').run(id);
	// Delete the calendar itself
	const result = sqlite.prepare('DELETE FROM calendars WHERE id = ?').run(id);
	return result.changes > 0;
};

// ---------------------------------------------------------------------------
// Task Lists
// ---------------------------------------------------------------------------

export type TaskListRow = {
	id: string;
	google_task_list_id: string;
	label: string | null;
	color: string | null;
	enabled: number; // 0/1
	sort_order: number | null;
	last_synced_at: number | null; // epoch ms of max(task.updated) seen
	updated_at: number;
};

export const upsertTaskList = (googleTaskListId: string, label?: string): TaskListRow => {
	const { sqlite } = getDb();
	const id = `gtlist_${sha1(googleTaskListId).slice(0, 12)}`;
	sqlite
		.prepare(
			`INSERT INTO task_lists (id, google_task_list_id, label, color, enabled, sort_order, last_synced_at, updated_at)
			 VALUES (@id, @google_task_list_id, COALESCE(@label, @google_task_list_id), NULL, 1, 0, NULL, @updated_at)
			 ON CONFLICT(id) DO UPDATE SET
			   label = COALESCE(@label, task_lists.label),
			   google_task_list_id = excluded.google_task_list_id,
			   updated_at = excluded.updated_at`,
		)
		.run({ id, google_task_list_id: googleTaskListId, label: label ?? null, updated_at: Date.now() });
	return sqlite.prepare('SELECT * FROM task_lists WHERE id = ?').get(id) as TaskListRow;
};

export const listTaskLists = (): TaskListRow[] => {
	const { sqlite } = getDb();
	return sqlite
		.prepare('SELECT * FROM task_lists ORDER BY sort_order ASC, id ASC')
		.all() as TaskListRow[];
};

export const listEnabledTaskLists = (): TaskListRow[] => {
	const { sqlite } = getDb();
	return sqlite
		.prepare('SELECT * FROM task_lists WHERE enabled = 1 ORDER BY sort_order ASC, id ASC')
		.all() as TaskListRow[];
};

export const getTaskListById = (id: string): TaskListRow | null => {
	const { sqlite } = getDb();
	const row = sqlite.prepare('SELECT * FROM task_lists WHERE id = ?').get(id);
	return row ? (row as TaskListRow) : null;
};

export const getTaskListByGoogleId = (googleTaskListId: string): TaskListRow | null => {
	const { sqlite } = getDb();
	const row = sqlite
		.prepare('SELECT * FROM task_lists WHERE google_task_list_id = ?')
		.get(googleTaskListId);
	return row ? (row as TaskListRow) : null;
};

export type TaskListUpdateFields = {
	color?: string | null;
	enabled?: boolean;
	label?: string | null;
	sort_order?: number | null;
};

export const updateTaskList = (id: string, fields: TaskListUpdateFields): TaskListRow | null => {
	const { sqlite } = getDb();
	const updates: string[] = [];
	const params: Record<string, any> = { id, updatedAt: Date.now() };

	if (fields.label !== undefined) {
		updates.push('label = @label');
		params.label = fields.label;
	}
	if (fields.color !== undefined) {
		updates.push('color = @color');
		params.color = fields.color;
	}
	if (fields.sort_order !== undefined) {
		updates.push('sort_order = @sort_order');
		params.sort_order = fields.sort_order;
	}
	if (fields.enabled !== undefined) {
		updates.push('enabled = @enabled');
		params.enabled = fields.enabled ? 1 : 0;
	}

	if (updates.length === 0) return getTaskListById(id);

	const sql = `UPDATE task_lists SET ${updates.join(', ')}, updated_at = @updatedAt WHERE id = @id`;
	sqlite.prepare(sql).run(params);
	return getTaskListById(id);
};

export const disableTaskList = (id: string): TaskListRow | null => {
	const { sqlite } = getDb();
	sqlite
		.prepare('UPDATE task_lists SET enabled = 0, updated_at = ? WHERE id = ?')
		.run(Date.now(), id);
	return getTaskListById(id);
};

export const updateTaskListSyncState = (id: string, lastSyncedAt: number): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare(
			'UPDATE task_lists SET last_synced_at = @lastSyncedAt, updated_at = @updatedAt WHERE id = @id',
		)
		.run({ id, lastSyncedAt, updatedAt: Date.now() });
};

// ---------------------------------------------------------------------------
// Raw Tasks
// ---------------------------------------------------------------------------

export type RawTaskRow = {
	task_list_id: string;
	task_id: string;
	title: string | null;
	notes: string | null;
	status: string; // 'needsAction' | 'completed'
	due_iso: string | null;
	completed_iso: string | null;
	deleted: number; // 0/1
	hidden: number; // 0/1
	position: string | null;
	parent: string | null;
	updated_ts: number; // epoch ms
	source_json: string;
};

export const upsertRawTask = (row: RawTaskRow): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare(
			`INSERT INTO raw_tasks (
				task_list_id, task_id, title, notes, status, due_iso, completed_iso,
				deleted, hidden, position, parent, updated_ts, source_json
			) VALUES (
				@task_list_id, @task_id, @title, @notes, @status, @due_iso, @completed_iso,
				@deleted, @hidden, @position, @parent, @updated_ts, @source_json
			)
			ON CONFLICT(task_list_id, task_id) DO UPDATE SET
				title = excluded.title,
				notes = excluded.notes,
				status = excluded.status,
				due_iso = excluded.due_iso,
				completed_iso = excluded.completed_iso,
				deleted = excluded.deleted,
				hidden = excluded.hidden,
				position = excluded.position,
				parent = excluded.parent,
				updated_ts = excluded.updated_ts,
				source_json = excluded.source_json`,
		)
		.run(row);
};

export const deleteRawTask = (taskListId: string, taskId: string): void => {
	const { sqlite } = getDb();
	sqlite
		.prepare('DELETE FROM raw_tasks WHERE task_list_id = ? AND task_id = ?')
		.run(taskListId, taskId);
};

export const deleteRawTasksByList = (taskListId: string): void => {
	const { sqlite } = getDb();
	sqlite.prepare('DELETE FROM raw_tasks WHERE task_list_id = ?').run(taskListId);
};

export const getTaskByIds = (taskListId: string, taskId: string): RawTaskRow | null => {
	const { sqlite } = getDb();
	const row = sqlite
		.prepare('SELECT * FROM raw_tasks WHERE task_list_id = ? AND task_id = ?')
		.get(taskListId, taskId);
	return row ? (row as RawTaskRow) : null;
};

export const getExistingTaskUpdatedTs = (taskListId: string, taskId: string): number | null => {
	const { sqlite } = getDb();
	const row = sqlite
		.prepare('SELECT updated_ts FROM raw_tasks WHERE task_list_id = ? AND task_id = ?')
		.get(taskListId, taskId) as { updated_ts: number } | undefined;
	return row ? row.updated_ts : null;
};

export type ListRawTasksOpts = {
	status?: 'needsAction' | 'completed' | 'all';
	dueBefore?: string | null;
	dueAfter?: string | null;
	showSubtasks?: boolean;
	showHidden?: boolean;
	order?: 'position' | 'due';
	limit?: number;
	offset?: number;
};

export const listRawTasks = (taskListId: string, opts: ListRawTasksOpts = {}): RawTaskRow[] => {
	const { sqlite } = getDb();
	const {
		status = 'needsAction',
		dueBefore,
		dueAfter,
		showSubtasks = false,
		showHidden = false,
		order = 'position',
		limit = 100,
		offset = 0,
	} = opts;

	const conditions: string[] = ['task_list_id = @taskListId', 'deleted = 0'];
	const params: Record<string, any> = { taskListId, limit, offset };

	if (status !== 'all') {
		conditions.push('status = @status');
		params.status = status;
	}
	if (!showSubtasks) conditions.push('parent IS NULL');
	if (!showHidden) conditions.push('hidden = 0');
	if (dueAfter) {
		conditions.push('due_iso >= @dueAfter');
		params.dueAfter = dueAfter;
	}
	if (dueBefore) {
		conditions.push('due_iso <= @dueBefore');
		params.dueBefore = dueBefore;
	}

	const orderClause =
		order === 'due' ? 'due_iso ASC NULLS LAST, position ASC' : 'position ASC';

	const sql = `SELECT * FROM raw_tasks WHERE ${conditions.join(' AND ')} ORDER BY ${orderClause} LIMIT @limit OFFSET @offset`;
	return sqlite.prepare(sql).all(params) as RawTaskRow[];
};

export const listRawTasksDueBetween = (startIso: string, endIso: string): RawTaskRow[] => {
	const { sqlite } = getDb();
	return sqlite
		.prepare(
			`SELECT * FROM raw_tasks
			 WHERE due_iso IS NOT NULL
			   AND due_iso >= ? AND due_iso <= ?
			   AND deleted = 0
			   AND hidden = 0
			   AND parent IS NULL
			   AND status = 'needsAction'
			 ORDER BY due_iso ASC, position ASC`,
		)
		.all(startIso, endIso) as RawTaskRow[];
};
