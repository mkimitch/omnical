import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/conn.js';
import { upsertRawEvent, type RawEventRow } from '../db/repo.js';
import calendarsPlugin from '../routes/calendars.js';
import eventsPlugin from '../routes/events.js';
import icsPlugin from '../routes/ics.js';
import { expandWindow, summaryHasExcludedPrefix, type EventOut } from './expand.js';

// Real SQL and routes, isolated from source calendars and the persistent database.
vi.mock('../db/conn.js', async () => {
	const { default: Database } = await import('better-sqlite3');
	const sqlite = new Database(':memory:');
	return { getDb: () => ({ sqlite }) };
});
vi.mock('../logging/logger.js', () => ({ logger: {} }));

const { sqlite } = getDb();
const app = Fastify();
const start = '2026-10-01T00:00:00.000Z';
const end = '2026-10-04T00:00:00.000Z';
const prefixRule = { enabled: true, summary: { excludePrefixes: ['Canceled', 'Cancelled'] } };
const base: RawEventRow = {
	calendar_id: 'filtered',
	uid: 'event',
	summary: 'Regular Appointment',
	start_iso: '2026-10-01T10:00:00.000Z',
	end_iso: '2026-10-01T11:00:00.000Z',
	all_day: 0,
	tzid: 'UTC',
	recurrence_id: null,
	recurrence_json: null,
	status: 'confirmed',
	description: 'Original description',
	location: 'Original location',
	transparency: 'opaque',
	source_json: '{"transparency":"opaque"}',
	updated_ts: 1,
};
let revision = 0;

const addCalendar = (id: string, config: unknown = prefixRule, enabled = 1, rank = 0) => {
	sqlite
		.prepare(
			`INSERT INTO calendars
		(id, type, enabled, filter_json, updated_at, label, color, icon, description, sort_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			id,
			id === 'filtered' ? 'google' : 'ics',
			enabled,
			typeof config === 'string' ? config : JSON.stringify(config),
			++revision,
			'Original label',
			'#123456',
			'📅',
			'Calendar description',
			rank,
		);
};
const addEvent = (fields: Partial<RawEventRow> = {}) => upsertRawEvent({ ...base, ...fields });
const expand = (includeCancelled = false, crossCalendarDedupe = false) =>
	expandWindow(start, end, includeCancelled, { crossCalendarDedupe });
const request = (path: string, includeCancelled?: string) => {
	const query = new URLSearchParams({ start, end });
	if (includeCancelled !== undefined) query.set('includeCancelled', includeCancelled);
	return app.inject({ method: 'GET', url: `${path}?${query}` });
};

beforeAll(async () => {
	for (const file of ['000_init.sql', '002_add_calendar_filters.sql', '003_add_transparency.sql']) {
		sqlite.exec(readFileSync(`drizzle/migrations/${file}`, 'utf8'));
	}
	await app.register(calendarsPlugin);
	await app.register(eventsPlugin);
	await app.register(icsPlugin);
});
beforeEach(() => {
	sqlite.exec('DELETE FROM raw_events; DELETE FROM calendars');
});
afterAll(async () => {
	await app.close();
	sqlite.close();
});

describe('summary prefix matching', () => {
	it.each([
		['Canceled: Doctor Appointment', true],
		['CANCELLED - School Event', true],
		['Cancelled', true],
		['  canceled Team Meeting', true],
		['\t\nCancelled!', true],
		['Meeting About Canceled Events', false],
		['Cancellation Policy', false],
		['Uncanceled Appointment', false],
		['Regular Appointment', false],
		['Canceledness', false],
		['Canceled2', false],
		['Canceled_meeting', false],
		['Canceledé', false],
		['Canceled\u0301', false],
		['Cancelled—Meeting', true],
		[null, false],
		[undefined, false],
		['', false],
		['   ', false],
	])('matches %j: %s', (summary, excluded) => {
		expect(summaryHasExcludedPrefix(summary, prefixRule.summary.excludePrefixes)).toBe(excluded);
	});
	it('uses literal configurable prefixes, trims them, and ignores empty entries', () => {
		expect(summaryHasExcludedPrefix('  on HOLD: Meeting', [' ', ' On Hold '])).toBe(true);
		expect(summaryHasExcludedPrefix('A.B: Meeting', ['A.B'])).toBe(true);
		expect(summaryHasExcludedPrefix('AxB: Meeting', ['A.B'])).toBe(false);
		expect(summaryHasExcludedPrefix('Canceled: Meeting', ['Declined'])).toBe(false);
		expect(summaryHasExcludedPrefix('Regular Appointment', ['', ' '])).toBe(false);
	});
	it.each([undefined, null, 'Canceled', {}, [null, 42, {}]])(
		'ignores malformed optional prefixes: %j',
		(prefixes) => {
			expect(summaryHasExcludedPrefix('Canceled: Meeting', prefixes)).toBe(false);
		},
	);
});

describe('calendar filtering and enablement', () => {
	it.each([0, 1])(
		'filters timed/all-day=%s without changing retained event data',
		async (allDay) => {
			addCalendar('filtered');
			addEvent({ uid: 'excluded', all_day: allDay, summary: 'Canceled: Appointment' });
			addEvent({ all_day: allDay });
			addEvent({ uid: 'empty', all_day: allDay, summary: null });
			const events = await expand();
			expect(events.map((event) => event.uid).sort()).toEqual(['empty', 'event']);
			expect(events.find((event) => event.uid === 'event')).toEqual({
				allDay: allDay === 1,
				calendarId: base.calendar_id,
				uid: base.uid,
				summary: base.summary,
				description: base.description,
				location: base.location,
				start: base.start_iso,
				end: base.end_iso,
				status: base.status,
				recurrence: { isRecurring: false },
				source: { type: 'google', id: base.uid },
				timeTransparency: {
					blocksTime: true,
					value: 'opaque',
					source: { provider: 'google', rawValue: 'opaque' },
				},
			});
		},
	);
	it.each([
		null,
		'{invalid',
		{},
		{ enabled: true },
		{ summary: prefixRule.summary },
		{ ...prefixRule, enabled: false },
		{ enabled: true, summary: { excludePrefixes: [] } },
	])('leaves title filtering off for %j', async (config) => {
		addCalendar('filtered', config);
		addEvent({ summary: 'Canceled: Appointment' });
		expect(await expand()).toHaveLength(1);
	});
	it('only applies enabled rules on the owning enabled calendar', async () => {
		addCalendar('filtered');
		addCalendar('unfiltered', null);
		addCalendar('disabled', prefixRule, 0);
		for (const calendarId of ['filtered', 'unfiltered', 'disabled']) {
			addEvent({ calendar_id: calendarId, summary: 'Cancelled: Appointment' });
		}
		expect((await expand()).map((event) => event.calendarId)).toEqual(['unfiltered']);
	});
});

describe('existing all-day and dedupe rules', () => {
	it('keeps all-day keyword exceptions scoped to keyword exclusions', async () => {
		addCalendar('filtered', {
			...prefixRule,
			allDay: { excludeKeywords: [' pTo '], allowKeywords: [' sMrUtU '] },
		});
		for (const [uid, summary, allDay] of [
			['excluded-keyword', 'Team PTO', 1],
			['allowed-keyword', 'Smrutu PTO', 1],
			['excluded-title', 'Canceled: Smrutu PTO', 1],
			['timed-keyword', 'Team PTO', 0],
		] as const)
			addEvent({ uid, summary, all_day: allDay });
		expect((await expand()).map((event) => event.uid).sort()).toEqual([
			'allowed-keyword',
			'timed-keyword',
		]);
	});
	it('preserves per-calendar dedupe, richness selection, and empty-summary behavior', async () => {
		addCalendar('filtered', { ...prefixRule, dedupe: { enabled: true } });
		addEvent({ uid: 'poor', description: null, location: null });
		addEvent({ uid: 'rich', summary: '  REGULAR APPOINTMENT ' });
		addEvent({ uid: 'empty-a', summary: null });
		addEvent({ uid: 'empty-b', summary: '' });
		addEvent({ uid: 'excluded', summary: 'Cancelled' });
		expect((await expand()).map((event) => event.uid).sort()).toEqual([
			'empty-a',
			'empty-b',
			'rich',
		]);
	});
	it('filters before cross-calendar dedupe and preserves groups and calendar ranking', async () => {
		const dedupe = { enabled: true, acrossCalendars: true, group: 'mirrors' };
		addCalendar('filtered', { ...prefixRule, dedupe });
		addCalendar('mirror', { dedupe }, 1, 1);
		addCalendar('separate', { dedupe: { ...dedupe, group: 'separate' } }, 1, 2);
		for (const calendarId of ['filtered', 'mirror', 'separate']) {
			addEvent({ calendar_id: calendarId });
			addEvent({ calendar_id: calendarId, uid: 'title', summary: 'Canceled: Appointment' });
		}
		const events = await expand(false, true);
		expect(events.map((event) => `${event.calendarId}/${event.uid}`).sort()).toEqual([
			'filtered/event',
			'mirror/title',
			'separate/event',
			'separate/title',
		]);
		expect(await expand()).toHaveLength(5);
	});
});

describe('recurring title filters', () => {
	it.each([0, 1])('uses final occurrence titles for timed/all-day=%s', async (allDay) => {
		addCalendar('filtered');
		const master = {
			all_day: allDay,
			start_iso: start,
			end_iso: allDay ? '2026-10-02T00:00:00.000Z' : '2026-10-01T01:00:00.000Z',
			recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=DAILY;COUNT=3' }),
		};
		addEvent({ ...master, uid: 'excluded-series', summary: 'Cancelled: Series' });
		addEvent({ ...master, uid: 'regular-series' });
		for (const [uid, summary] of [
			['excluded-series', 'Restored occurrence'],
			['regular-series', 'Canceled: Occurrence'],
		]) {
			addEvent({
				...master,
				uid,
				summary,
				recurrence_json: null,
				recurrence_id: start,
				source_json: JSON.stringify({ recurringEventId: uid }),
			});
		}
		const events = await expand();
		expect(events.map((event) => event.summary)).toEqual([
			'Restored occurrence',
			'Regular Appointment',
			'Regular Appointment',
		]);
		expect(events.every((event) => event.recurrence.isRecurring)).toBe(true);
		expect(events[0]?.recurrence).toEqual({
			isRecurring: true,
			masterUid: 'excluded-series',
			recurrenceId: start,
		});
	});
	it('filters moved overrides whose original dates are outside the window', async () => {
		addCalendar('filtered');
		addEvent({ summary: 'Canceled: Moved', recurrence_id: '2026-09-01T10:00:00.000Z' });
		expect(await expand(true)).toEqual([]);
	});
	it.each([false, true])(
		'preserves override status filtering with includeCancelled=%s',
		async (includeCancelled) => {
			addCalendar('filtered');
			for (const [uid, summary] of [
				['status', 'Regular occurrence'],
				['title', 'Cancelled: Occurrence'],
			]) {
				addEvent({ uid, recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=DAILY;COUNT=1' }) });
				addEvent({ uid, summary, recurrence_id: base.start_iso, status: 'cancelled' });
			}
			expect((await expand(includeCancelled)).map((event) => event.uid)).toEqual(
				includeCancelled ? ['status'] : [],
			);
		},
	);
});

const seedEndpointEvents = () => {
	addCalendar('filtered');
	addEvent();
	addEvent({
		uid: 'title',
		summary: 'Canceled: Timed',
		start_iso: '2026-10-01T08:00:00.000Z',
		end_iso: '2026-10-01T09:00:00.000Z',
	});
	addEvent({
		uid: 'all-day',
		summary: 'Cancelled',
		all_day: 1,
		start_iso: '2026-10-02T00:00:00.000Z',
		end_iso: '2026-10-03T00:00:00.000Z',
	});
	addEvent({
		uid: 'status',
		summary: 'Status-only cancellation',
		status: 'CANCELLED',
		start_iso: '2026-10-01T12:00:00.000Z',
		end_iso: '2026-10-01T13:00:00.000Z',
	});
	addEvent({ uid: 'both', summary: 'Cancelled: Title and status', status: 'cancelled' });
	for (const [uid, summary] of [
		['series', 'Regular series'],
		['excluded-series', 'Canceled: Series'],
	]) {
		const hour = uid === 'series' ? 14 : 16;
		addEvent({
			uid,
			summary,
			recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=DAILY;COUNT=2' }),
			start_iso: `2026-10-01T${hour}:00:00.000Z`,
			end_iso: `2026-10-01T${hour + 1}:00:00.000Z`,
		});
	}
};

describe.each([undefined, 'false', 'true'])('endpoint includeCancelled=%s', (includeCancelled) => {
	it('returns only surviving events and keeps status filtering independent', async () => {
		seedEndpointEvents();
		const response = await request('/v1/events', includeCancelled);
		expect(response.statusCode).toBe(200);
		const events = response.json<EventOut[]>();
		expect(events.map((event) => event.uid)).toEqual(
			includeCancelled === 'true'
				? ['event', 'status', 'series', 'series']
				: ['event', 'series', 'series'],
		);
	});
	it('excludes filtered intervals from both calendar and merged free/busy', async () => {
		seedEndpointEvents();
		const response = await request('/v1/freebusy', includeCancelled);
		expect(response.statusCode).toBe(200);
		const expected = [
			{ start: base.start_iso, end: base.end_iso },
			{ start: '2026-10-01T14:00:00.000Z', end: '2026-10-01T15:00:00.000Z' },
			{ start: '2026-10-02T14:00:00.000Z', end: '2026-10-02T15:00:00.000Z' },
		];
		const body = response.json<{
			calendars: Record<string, { start: string; end: string }[]>;
			merged: { start: string; end: string }[];
		}>();
		// Free/busy currently serializes in the server's timezone; compare instants.
		const asUtc = (intervals: { start: string; end: string }[]) =>
			intervals.map((interval) => ({
				start: new Date(interval.start).toISOString(),
				end: new Date(interval.end).toISOString(),
			}));
		expect(Object.keys(body.calendars)).toEqual(['filtered']);
		expect(asUtc(body.calendars.filtered!)).toEqual(expected);
		expect(asUtc(body.merged)).toEqual(expected);
	});
	it('serializes only surviving occurrences to ICS', async () => {
		seedEndpointEvents();
		const response = await request('/v1/ics', includeCancelled);
		expect(response.statusCode).toBe(200);
		expect(response.headers['content-type']).toContain('text/calendar');
		expect(response.body.match(/BEGIN:VEVENT/g)).toHaveLength(3);
		expect(response.body).not.toMatch(/Canceled|Cancelled|Status-only cancellation/);
		expect(response.body).toContain('DESCRIPTION:Original description\r\n');
		expect(response.body).toContain('LOCATION:Original location\r\n');
	});
});

describe('configuration persistence', () => {
	it.each(['object', 'string'])(
		'merges and stores %s rules while preserving calendar metadata',
		async (format) => {
			const original = {
				enabled: false,
				allDay: { excludeKeywords: ['PTO'], allowKeywords: ['Smruti'] },
				dedupe: { enabled: true, acrossCalendars: true, group: 'mirrors' },
				summary: { excludePrefixes: ['Declined'], custom: true },
			};
			addCalendar('filtered', original);
			addEvent({ summary: 'Canceled: Appointment' });
			expect(await expand()).toHaveLength(1);
			const before = (await app.inject('/v1/calendars/filtered')).json();
			const config = JSON.parse(before.filterJson) as typeof original;
			config.enabled = true;
			config.summary.excludePrefixes.push('Canceled', 'Cancelled');
			const response = await app.inject({
				method: 'PUT',
				url: '/v1/calendars/filtered',
				payload: { filterJson: format === 'string' ? JSON.stringify(config) : config },
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({
				...before,
				filterJson: JSON.stringify(config),
				updatedAt: expect.any(Number),
			});
			expect(await expand()).toEqual([]); // Same window: calendar update invalidates the cached result.
		},
	);
	it('querying all endpoints leaves raw events and calendar settings unchanged', async () => {
		seedEndpointEvents();
		const rows = sqlite.prepare('SELECT * FROM raw_events').all();
		const calendars = sqlite.prepare('SELECT * FROM calendars').all();
		for (const path of ['/v1/events', '/v1/freebusy', '/v1/ics']) {
			expect((await request(path)).statusCode).toBe(200);
		}
		expect(sqlite.prepare('SELECT * FROM raw_events').all()).toEqual(rows);
		expect(sqlite.prepare('SELECT * FROM calendars').all()).toEqual(calendars);
	});
});
