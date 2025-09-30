'use strict';
import { loadEnv } from '../config/env.js';
import { sha1 } from '../util/hash.js';
import { getDb } from './conn.js';

export type CalendarRow = {
	color: string | null;
	description: string | null;
	enabled: number;
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
			 VALUES (@id, 'ics', @label, NULL, 1, NULL, NULL, @ics_url, NULL, NULL, @updated_at)
			 ON CONFLICT(id) DO UPDATE SET label = COALESCE(excluded.label, calendars.label), ics_url = excluded.ics_url, updated_at = excluded.updated_at`,
		)
		.run({ id, label: label ?? url, ics_url: url, updated_at: Date.now() });
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
			 VALUES (@id, 'google', @label, NULL, 1, @google_cal_id, NULL, NULL, NULL, NULL, @updated_at)
			 ON CONFLICT(id) DO UPDATE SET label = COALESCE(excluded.label, calendars.label), google_cal_id = excluded.google_cal_id, updated_at = excluded.updated_at`,
		)
		.run({ id, label: label ?? googleCalId, google_cal_id: googleCalId, updated_at: Date.now() });
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
				summary, location, description, recurrence_json, source_json
			) VALUES (@calendar_id, @uid, @recurrence_id, @updated_ts, @status, @all_day, @start_iso, @end_iso, @tzid,
				@summary, @location, @description, @recurrence_json, @source_json)`,
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
