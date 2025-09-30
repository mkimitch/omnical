'use strict';
import { DateTime } from 'luxon';
import {
	deleteRawEventsByUid,
	getExistingUpdatedTs,
	listEnabledCalendars,
	updateCalendarSyncToken,
	upsertRawEvent,
} from '../db/repo.js';
import { getValidAccessToken } from '../google/oauth.js';
import { logger } from '../logging/logger.js';

type GoogleEventTime = { date?: string; dateTime?: string; timeZone?: string };
type GoogleEvent = {
	description?: string;
	end?: GoogleEventTime;
	id: string;
	location?: string;
	originalStartTime?: GoogleEventTime;
	recurrence?: string[];
	recurringEventId?: string;
	start?: GoogleEventTime;
	status?: string;
	summary?: string;
	transparency?: string;
	updated?: string;
};

const gBase = 'https://www.googleapis.com/calendar/v3/calendars';

const toUtcIso = (
	t: GoogleEventTime | undefined,
	fallbackIso?: string,
): { iso: string; allDay: boolean } => {
	if (!t) {
		return { iso: fallbackIso ?? DateTime.utc().toISO(), allDay: false };
	}
	if (t.date) {
		const start = DateTime.fromISO(t.date, { zone: 'utc' }).startOf('day');
		return { iso: start.toISO()!, allDay: true };
	}
	if (t.dateTime) {
		const dt = DateTime.fromISO(t.dateTime);
		return { iso: dt.toUTC().toISO()!, allDay: false };
	}
	return { iso: fallbackIso ?? DateTime.utc().toISO(), allDay: false };
};

const parseRecurrence = (
	recurrence: string[] | undefined,
): { rrule: string | null; exdates: string[]; rdates: string[] } => {
	if (!recurrence || recurrence.length === 0) return { rrule: null, exdates: [], rdates: [] };
	let rrule: string | null = null;
	const exdates: string[] = [];
	for (const line of recurrence) {
		if (line.startsWith('RRULE')) rrule = line.trim();
		if (line.startsWith('EXDATE')) {
			// Handle formats like: EXDATE;TZID=America/Los_Angeles:20240112T090000,20240113T090000
			const parts = line.split(':');
			const prefix = parts[0] ?? '';
			const vals = parts.slice(1).join(':');
			const tzMatch = /TZID=([^;:]+)/.exec(prefix);
			const zone = tzMatch?.[1] ?? 'utc';
			for (const v of vals.split(',')) {
				const trimmed = v.trim();
				if (!trimmed) continue;
				const dt = DateTime.fromFormat(trimmed, "yyyyMMdd'T'HHmmss", { zone });
				if (dt.isValid) exdates.push(dt.toUTC().toISO()!);
			}
		}
	}
	return { rrule, exdates, rdates: [] };
};

const mapGoogleEvent = (
	calId: string,
	ge: GoogleEvent,
): { row: Parameters<typeof upsertRawEvent>[0]; recurrenceId: string | null } | null => {
	const uid = ge.id;
	const status = ge.status ?? null;
	const updatedTs = ge.updated ? DateTime.fromISO(ge.updated).toMillis() : Date.now();
	const isOverride = !!ge.recurringEventId && !!ge.originalStartTime;
	const orig = isOverride ? toUtcIso(ge.originalStartTime) : null;
	const start = toUtcIso(ge.start, orig?.iso ?? undefined);
	const end = toUtcIso(ge.end, orig?.iso ?? undefined);
	const tzid = ge.start?.timeZone ?? ge.end?.timeZone ?? null;
	const rec = parseRecurrence(ge.recurrence);
	const recurrenceId = isOverride ? orig!.iso : null;
	// Special handling for cancelled single events (no times): delete existing rows
	if ((ge.status ?? '').toLowerCase() === 'cancelled' && !isOverride) {
		return {
			recurrenceId: null,
			row: {
				all_day: start.allDay ? 1 : 0,
				calendar_id: calId,
				description: typeof ge.description === 'string' ? ge.description : null,
				end_iso: end.iso!,
				location: ge.location ?? null,
				recurrence_id: null,
				recurrence_json: JSON.stringify(rec),
				source_json: JSON.stringify(ge),
				start_iso: start.iso!,
				status: 'cancelled',
				summary: ge.summary ?? null,
				tzid,
				uid,
				updated_ts: updatedTs,
			},
		};
	}
	return {
		recurrenceId: recurrenceId,
		row: {
			all_day: start.allDay ? 1 : 0,
			calendar_id: calId,
			description: typeof ge.description === 'string' ? ge.description : null,
			end_iso: end.iso!,
			location: ge.location ?? null,
			recurrence_id: recurrenceId,
			recurrence_json: JSON.stringify(rec),
			source_json: JSON.stringify(ge),
			start_iso: start.iso!,
			status,
			summary: ge.summary ?? null,
			tzid,
			uid,
			updated_ts: updatedTs,
		},
	};
};

export type SyncSummary = { updated: number; calendars: string[] };

export const syncGoogleCalendars = async (): Promise<SyncSummary> => {
	const enabled = listEnabledCalendars().filter((c) => c.type === 'google');
	if (enabled.length === 0) return { updated: 0, calendars: [] };
	let totalUpdated = 0;
	const calendars: string[] = [];
	let accessToken: string | null = null;
	try {
		accessToken = await getValidAccessToken();
	} catch (e) {
		logger.warn('No valid Google OAuth tokens found; skipping Google sync');
		return { updated: 0, calendars: [] };
	}
	for (const cal of enabled) {
		if (!cal.google_cal_id) continue;
		try {
			const encodedCalId = encodeURIComponent(cal.google_cal_id);
			let pageToken: string | undefined;
			let nextSyncToken: string | undefined;
			let updatedCount = 0;
			const isIncremental = !!cal.sync_token;
			let incrementalToken = cal.sync_token ?? undefined;
			const doFetch = async () => {
				const params = new URLSearchParams();
				params.set('showDeleted', 'true');
				params.set('showHiddenInvitations', 'false');
				params.set('singleEvents', 'false');
				params.set('maxResults', '2500');
				if (pageToken) params.set('pageToken', pageToken);
				if (incrementalToken) params.set('syncToken', incrementalToken);
				const url = `${gBase}/${encodedCalId}/events?${params.toString()}`;
				const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken!}` } });
				if (res.status === 410) {
					// Invalid sync token: clear and force full sync
					updateCalendarSyncToken(cal.id, null);
					incrementalToken = undefined;
					pageToken = undefined;
					return await doFetch();
				}
				if (!res.ok) {
					throw new Error(`Google events.list failed ${res.status} ${res.statusText}`);
				}
				const json = (await res.json()) as any;
				const items: GoogleEvent[] = json.items ?? [];
				for (const it of items) {
					const mapped = mapGoogleEvent(cal.id, it);
					if (!mapped) continue;
					const existingTs = getExistingUpdatedTs(cal.id, mapped.row.uid, mapped.row.recurrence_id);
					if (existingTs !== null && existingTs >= mapped.row.updated_ts) continue;
					// For cancelled single events, Google may omit start/end; we choose to delete existing rows
					if ((it.status ?? '').toLowerCase() === 'cancelled' && !it.recurringEventId) {
						deleteRawEventsByUid(cal.id, it.id);
						updatedCount++;
						continue;
					}
					upsertRawEvent(mapped.row);
					updatedCount++;
				}
				pageToken = json.nextPageToken;
				nextSyncToken = json.nextSyncToken ?? nextSyncToken;
				return { hasMore: !!pageToken, nextSyncToken };
			};

			while (true) {
				const { hasMore } = await doFetch();
				if (!hasMore) break;
			}
			if (nextSyncToken) updateCalendarSyncToken(cal.id, nextSyncToken);
			totalUpdated += updatedCount;
			calendars.push(cal.id);
			logger.info(
				{ cal: cal.id, updated: updatedCount, incremental: isIncremental },
				'Google synced',
			);
		} catch (err) {
			logger.error({ cal: cal.id, err }, 'Google sync failed');
		}
	}
	return { updated: totalUpdated, calendars };
};
