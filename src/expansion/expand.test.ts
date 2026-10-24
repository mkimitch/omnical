import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '../db/conn.js';
import { upsertRawEvent, type RawEventRow } from '../db/repo.js';
import eventsPlugin from '../routes/events.js';
import { parseGoogleRecurrence } from '../sync/google.js';
import { expandWindow, type EventOut } from './expand.js';

// Exercise the real SQL selection, expansion, override matching, and API route
// against an isolated database. Never initialize or write the production DB.
vi.mock('../db/conn.js', async () => {
	const { default: Database } = await import('better-sqlite3');
	const sqlite = new Database(':memory:');
	return { getDb: () => ({ sqlite }) };
});
vi.mock('../logging/logger.js', () => ({ logger: {} }));

const { sqlite } = getDb();
const app = Fastify();
const rule = 'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261103T055959Z;INTERVAL=1;BYDAY=MO';
const master: RawEventRow = {
	calendar_id: 'test-calendar',
	uid: 'samana',
	summary: 'Samana swim 🏊🏽‍♀️',
	start_iso: '2026-09-15T00:00:00.000Z',
	end_iso: '2026-09-15T00:45:00.000Z',
	tzid: 'America/Chicago',
	all_day: 0,
	recurrence_id: null,
	recurrence_json: JSON.stringify({ rrule: rule, exdates: [], rdates: [] }),
	source_json: '{}',
	status: 'confirmed',
	updated_ts: 1,
	description: null,
	location: null,
	transparency: 'opaque',
};
let revision = 0;

beforeAll(async () => {
	sqlite.exec(readFileSync('drizzle/migrations/000_init.sql', 'utf8'));
	sqlite.exec(readFileSync('drizzle/migrations/003_add_transparency.sql', 'utf8'));
	sqlite.exec('ALTER TABLE calendars ADD COLUMN filter_json TEXT');
	await app.register(eventsPlugin);
});

beforeEach(() => {
	sqlite.exec('DELETE FROM raw_events; DELETE FROM calendars');
	// Changing the calendar revision also isolates expandWindow's cache per test.
	sqlite
		.prepare('INSERT INTO calendars (id, type, enabled, updated_at) VALUES (?, ?, 1, ?)')
		.run(master.calendar_id, 'google', ++revision);
	upsertRawEvent(master);
});

afterAll(async () => {
	await app.close();
	sqlite.close();
});

const expand = (start = '2026-10-01T00:00:00Z', end = '2026-11-11T00:00:00Z', cancelled = false) =>
	expandWindow(start, end, cancelled);

const override = (original: string, actual: string, status = 'confirmed') => {
	upsertRawEvent({
		...master,
		uid: `samana_${original}`,
		recurrence_id: original,
		recurrence_json: null,
		source_json: JSON.stringify({ recurringEventId: master.uid }),
		start_iso: actual,
		end_iso: DateTime.fromISO(actual).toUTC().plus({ minutes: 45 }).toISO()!,
		status,
	});
};

const query = async (start: string, end: string, clientZone?: string): Promise<EventOut[]> => {
	const params = new URLSearchParams({ start, end });
	if (clientZone) params.set('clientZone', clientZone);
	const response = await app.inject({ method: 'GET', url: `/v1/events?${params}` });
	expect(response.statusCode).toBe(200);
	return response.json();
};

describe('recurring events through expansion and /v1/events', () => {
	it('expands the exact Samana fixture on Monday evening, not Sunday', async () => {
		const events = await expand('2026-10-04T00:00:00Z', '2026-10-07T00:00:00Z');
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			start: '2026-10-06T00:00:00.000Z',
			end: '2026-10-06T00:45:00.000Z',
			allDay: false,
			recurrence: { masterUid: 'samana', recurrenceId: '2026-10-06T00:00:00.000Z' },
		});
		expect(events.some((e) => e.start === '2026-10-05T00:00:00.000Z')).toBe(false);
	});

	it('keeps 19:00 across DST without double correction and honors the series end', async () => {
		const events = await expand();
		expect(events.map((e) => e.start)).toEqual([
			'2026-10-06T00:00:00.000Z',
			'2026-10-13T00:00:00.000Z',
			'2026-10-20T00:00:00.000Z',
			'2026-10-27T00:00:00.000Z',
			'2026-11-03T01:00:00.000Z',
		]);
		for (const event of events) {
			expect(DateTime.fromISO(event.start).setZone(master.tzid!).hour).toBe(19);
			expect(event.recurrence.recurrenceId).toBe(event.start);
		}
		expect(events.at(-1)?.end).toBe('2026-11-03T01:45:00.000Z');
	});

	it.each([
		['20261103T005959Z', false],
		['20261103T010000Z', true],
	])('compares UTC UNTIL=%s inclusively against the resolved instant', async (until, included) => {
		upsertRawEvent({
			...master,
			recurrence_json: JSON.stringify({ rrule: rule.replace('20261103T055959Z', until) }),
		});
		const events = await expand('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z');
		expect(events.map((e) => e.start)).toEqual(included ? ['2026-11-03T01:00:00.000Z'] : []);
	});

	it('preserves the Aadi/Dhruv Saturday control', async () => {
		upsertRawEvent({
			...master,
			summary: 'Aadi Dhruv swim class',
			start_iso: '2026-09-19T18:30:00.000Z',
			end_iso: '2026-09-19T19:30:00.000Z',
			recurrence_json: JSON.stringify({
				rrule: 'RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261115T055959Z;INTERVAL=1;BYDAY=SA',
			}),
		});
		expect(await expand('2026-10-03T00:00:00Z', '2026-10-04T00:00:00Z')).toMatchObject([
			{ start: '2026-10-03T18:30:00.000Z', end: '2026-10-03T19:30:00.000Z' },
		]);
	});

	it('preserves local time across the spring DST transition', async () => {
		upsertRawEvent({
			...master,
			start_iso: '2026-03-03T01:00:00.000Z',
			end_iso: '2026-03-03T01:45:00.000Z',
			recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2' }),
		});
		expect(
			(await expand('2026-03-01T00:00:00Z', '2026-03-20T00:00:00Z')).map((e) => e.start),
		).toEqual(['2026-03-03T01:00:00.000Z', '2026-03-10T00:00:00.000Z']);
	});

	it('preserves UTC UNTIL for a positive-offset timezone and an exact window boundary', async () => {
		upsertRawEvent({
			...master,
			tzid: 'Asia/Tokyo',
			start_iso: '2026-10-04T16:00:00.000Z',
			end_iso: '2026-10-04T16:45:00.000Z',
			recurrence_json: JSON.stringify({
				rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261011T160000Z',
			}),
		});
		expect(
			(await expand('2026-10-11T16:00:00.000Z', '2026-10-19T00:00:00Z')).map((e) => e.start),
		).toEqual(['2026-10-11T16:00:00.000Z']);
	});

	it('evaluates month-day semantics in the source timezone', async () => {
		upsertRawEvent({
			...master,
			start_iso: '2026-09-01T00:00:00.000Z',
			end_iso: '2026-09-01T00:45:00.000Z',
			recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3' }),
		});
		expect((await expand()).map((e) => e.start)).toEqual([
			'2026-10-01T00:00:00.000Z',
			'2026-11-01T00:00:00.000Z',
		]);
	});

	it('keeps timed events without TZID in UTC', async () => {
		upsertRawEvent({
			...master,
			tzid: null,
			start_iso: '2026-10-26T19:00:00.000Z',
			end_iso: '2026-10-26T19:45:00.000Z',
			recurrence_json: JSON.stringify({ rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=2' }),
		});
		expect((await expand()).map((e) => e.start)).toEqual([
			'2026-10-26T19:00:00.000Z',
			'2026-11-02T19:00:00.000Z',
		]);
	});

	it.each(['2026-10-06T00:00:00.000Z', '2026-11-03T01:00:00.000Z'])(
		'matches cancellation at original start %s',
		async (original) => {
			override(original, original, 'cancelled');
			expect((await expand()).some((e) => e.recurrence.recurrenceId === original)).toBe(false);
			expect(
				(await expand(undefined, undefined, true)).filter(
					(e) => e.recurrence.recurrenceId === original,
				),
			).toMatchObject([{ start: original, status: 'cancelled' }]);
		},
	);

	it.each([
		['2026-10-06T00:00:00.000Z', '2026-10-07T02:00:00.000Z'],
		['2026-11-03T01:00:00.000Z', '2026-11-04T03:00:00.000Z'],
	])('matches a moved occurrence by original start %s', async (original, actual) => {
		override(original, actual);
		const events = await expand();
		expect(events.filter((e) => e.recurrence.recurrenceId === original)).toMatchObject([
			{ start: actual, recurrence: { masterUid: master.uid, recurrenceId: original } },
		]);
		expect(events.some((e) => e.start === original)).toBe(false);
		// Query only the moved date: original recurrence lies outside this window.
		const end = DateTime.fromISO(actual).plus({ hours: 1 }).toISO()!;
		expect(await expand(actual, end)).toMatchObject([
			{ start: actual, recurrence: { recurrenceId: original } },
		]);
	});

	it('matches UTC and TZID EXDATE/RDATE values before and after DST', async () => {
		const recurrence = parseGoogleRecurrence([
			rule,
			'EXDATE:20261006T000000Z',
			'EXDATE;TZID=America/Chicago:20261102T190000',
			'RDATE;TZID=America/Chicago:20261007T190000,20261104T190000',
			'RDATE:20261008T000000Z,20261110T010000Z',
		]);
		upsertRawEvent({ ...master, recurrence_json: JSON.stringify(recurrence) });
		const events = await expand();
		expect(events.map((e) => e.start)).toEqual([
			'2026-10-08T00:00:00.000Z',
			'2026-10-13T00:00:00.000Z',
			'2026-10-20T00:00:00.000Z',
			'2026-10-27T00:00:00.000Z',
			'2026-11-05T01:00:00.000Z',
			'2026-11-10T01:00:00.000Z',
		]);
		for (const event of events) expect(event.recurrence.recurrenceId).toBe(event.start);
	});

	it('lets EXDATE exclude an RDATE and supports RDATE-only recurrence', async () => {
		upsertRawEvent({
			...master,
			recurrence_json: JSON.stringify({
				rrule: null,
				rdates: ['2026-10-08T00:00:00.000Z', '2026-11-05T01:00:00.000Z'],
				exdates: ['2026-10-08T00:00:00.000Z'],
			}),
		});
		expect((await expand()).map((e) => e.start)).toEqual(['2026-11-05T01:00:00.000Z']);
	});

	it('matches an override of an added RDATE after DST', async () => {
		const original = '2026-11-05T01:00:00.000Z';
		upsertRawEvent({
			...master,
			recurrence_json: JSON.stringify({ rrule: rule, rdates: [original] }),
		});
		override(original, '2026-11-05T03:00:00.000Z');
		expect((await expand()).filter((e) => e.recurrence.recurrenceId === original)).toMatchObject([
			{ start: '2026-11-05T03:00:00.000Z', recurrence: { recurrenceId: original } },
		]);
	});

	it('handles ICS embedded DTSTART/TZID using the same local-time representation', async () => {
		upsertRawEvent({
			...master,
			recurrence_json: JSON.stringify({
				rrule: `DTSTART;TZID=America/Chicago:20260914T190000\n${rule}`,
			}),
		});
		expect((await expand()).at(-1)?.start).toBe('2026-11-03T01:00:00.000Z');
	});

	it('leaves all-day dates outside timed timezone conversion across DST', async () => {
		upsertRawEvent({
			...master,
			all_day: 1,
			start_iso: '2026-10-26T00:00:00.000Z',
			end_iso: '2026-10-27T00:00:00.000Z',
			recurrence_json: JSON.stringify(
				parseGoogleRecurrence([
					'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=3',
					'EXDATE;VALUE=DATE:20261109',
					'RDATE;VALUE=DATE:20261104',
				]),
			),
		});
		expect((await expand()).map((e) => [e.start, e.end, e.allDay])).toEqual([
			['2026-10-26T00:00:00.000Z', '2026-10-27T00:00:00.000Z', true],
			['2026-11-02T00:00:00.000Z', '2026-11-03T00:00:00.000Z', true],
			['2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z', true],
		]);
		expect(
			await query('2026-11-01T00:00:00Z', '2026-11-04T00:00:00Z', 'America/Chicago'),
		).toMatchObject([
			{
				start: '2026-11-02T00:00:00.000-06:00',
				end: '2026-11-03T00:00:00.000-06:00',
				allDay: true,
			},
		]);
	});

	it.each([
		[undefined, '2026-10-06T00:00:00.000Z', '2026-11-03T01:00:00.000Z'],
		['America/Chicago', '2026-10-05T19:00:00.000-05:00', '2026-11-02T19:00:00.000-06:00'],
	])('serves correct /v1/events instants with clientZone=%s', async (zone, october, november) => {
		const events = await query('2026-10-04T00:00:00Z', '2026-11-11T00:00:00Z', zone);
		expect(events[0]?.start).toBe(october);
		expect(events.at(-1)?.start).toBe(november);
		expect(events.at(-1)?.recurrence.recurrenceId).toBe('2026-11-03T01:00:00.000Z');
	});
});
