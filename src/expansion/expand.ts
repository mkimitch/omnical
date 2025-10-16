'use strict';
import { DateTime } from 'luxon';
import rrulePkg from 'rrule';
const { RRule, RRuleSet, rrulestr } = rrulePkg;
import { getDb } from '../db/conn.js';
import { listEnabledCalendars } from '../db/repo.js';
import { LruCache } from '../util/lru.js';

export type EventOut = {
	allDay: boolean;
	calendarId: string;
	description: string | null;
	end: string; // ISO
	location: string | null;
	recurrence: { isRecurring: boolean; masterUid?: string; recurrenceId?: string };
	source: { type: 'google' | 'ics'; id: string };
	start: string; // ISO
	status: string | null;
	summary: string | null;
	uid: string;
};

const intersects = (aStart: DateTime, aEnd: DateTime, bStart: DateTime, bEnd: DateTime): boolean =>
	aStart < bEnd && aEnd > bStart;

const parseRecurrence = (
	json: string | null,
): { rrule: string | null; exdates: string[]; rdates: string[] } => {
	if (!json) return { rrule: null, exdates: [], rdates: [] };
	try {
		const data = JSON.parse(json) as {
			rrule?: string | null;
			exdates?: string[];
			rdates?: string[];
		};
		return {
			rrule: data.rrule ?? null,
			exdates: data.exdates ?? [],
			rdates: data.rdates ?? [],
		};
	} catch {
		return { rrule: null, exdates: [], rdates: [] };
	}
};

const buildSet = (
	dtstart: Date,
	rruleStr: string,
	exdates: string[],
	rdates: string[],
): InstanceType<typeof RRuleSet> => {
	const set = new RRuleSet();
	set.dtstart(dtstart);
	const rule = rrulestr(rruleStr, { dtstart }) as InstanceType<typeof RRule>;
	set.rrule(rule);
	for (const ex of exdates) set.exdate(DateTime.fromISO(ex, { zone: 'utc' }).toJSDate());
	for (const rd of rdates) set.rdate(DateTime.fromISO(rd, { zone: 'utc' }).toJSDate());
	return set;
};

type RawRow = {
	all_day: number;
	calendar_id: string;
	description: string | null;
	end_iso: string;
	location: string | null;
	recurrence_id: string | null;
	recurrence_json: string | null;
	source_json: string;
	start_iso: string;
	status: string | null;
	summary: string | null;
	tzid: string | null;
	uid: string;
	updated_ts: number;
};

export const expandWindow = async (
	startIso: string,
	endIso: string,
	includeCancelled: boolean,
): Promise<EventOut[]> => {
	const start = DateTime.fromISO(startIso, { zone: 'utc' });
	const end = DateTime.fromISO(endIso, { zone: 'utc' });
	if (!start.isValid || !end.isValid || end <= start) throw new Error('Invalid time window');
	const { sqlite } = getDb();
	const enabled = listEnabledCalendars();
	const enabledIds = enabled.map((c) => c.id);
	if (enabledIds.length === 0) return [];

	// Simple LRU cache with 30s TTL
	const cache = expandCache;
	const cacheKey = JSON.stringify({
		s: start.toISO(),
		e: end.toISO(),
		c: includeCancelled,
		ids: enabledIds,
	});
	const cached = cache.get(cacheKey);
	if (cached) return cached;
	const calTypeById = new Map(enabled.map((c) => [c.id, c.type as 'google' | 'ics']));

	const qMarks = enabledIds.map(() => '?').join(',');
	// Masters with RRULEs that could generate occurrences before 'end'
	const masters = sqlite
		.prepare(
			`SELECT * FROM raw_events WHERE recurrence_id IS NULL AND recurrence_json IS NOT NULL
			 AND calendar_id IN (${qMarks}) AND start_iso <= ?`,
		)
		.all(...enabledIds, end.toISO()) as RawRow[];
	// Overrides that fall within the window
	const overrides = sqlite
		.prepare(
			`SELECT * FROM raw_events WHERE recurrence_id IS NOT NULL
			 AND calendar_id IN (${qMarks}) AND recurrence_id >= ? AND recurrence_id <= ?`,
		)
		.all(...enabledIds, start.toISO(), end.toISO()) as RawRow[];
	// Singles intersecting window
	const singles = sqlite
		.prepare(
			`SELECT * FROM raw_events WHERE recurrence_id IS NULL AND recurrence_json IS NULL
			 AND calendar_id IN (${qMarks}) AND start_iso < ? AND end_iso > ?`,
		)
		.all(...enabledIds, end.toISO(), start.toISO()) as RawRow[];

	const overridesByKey = new Map<string, RawRow>();
	for (const o of overrides) {
		if (o.recurrence_id) overridesByKey.set(`${o.calendar_id}::${o.uid}::${o.recurrence_id}`, o);
	}

	const results: EventOut[] = [];
	// Expand masters
	for (const m of masters) {
		const { rrule, exdates, rdates } = parseRecurrence(m.recurrence_json);
		if (!rrule) continue;
		const dtstart = DateTime.fromISO(m.start_iso, { zone: 'utc' }).toJSDate();
		const set = buildSet(dtstart, rrule, exdates, rdates);
		const durationMs =
			DateTime.fromISO(m.end_iso).toMillis() - DateTime.fromISO(m.start_iso).toMillis();
		const occ = set.between(start.toJSDate(), end.toJSDate(), true);
		for (const o of occ) {
			const occStart = DateTime.fromJSDate(o, { zone: 'utc' });
			const recurrenceId = occStart.toISO()!;
			const override = overridesByKey.get(`${m.calendar_id}::${m.uid}::${recurrenceId}`);
			if (override) {
				if (!includeCancelled && (override.status ?? '').toLowerCase() === 'cancelled') continue;
				results.push({
					allDay: override.all_day === 1,
					calendarId: m.calendar_id,
					description: override.description,
					end: DateTime.fromISO(override.end_iso, { zone: 'utc' }).toISO()!,
					location: override.location,
					recurrence: { isRecurring: true, masterUid: m.uid, recurrenceId },
					source: { type: calTypeById.get(m.calendar_id)!, id: m.uid },
					start: DateTime.fromISO(override.start_iso, { zone: 'utc' }).toISO()!,
					status: override.status,
					summary: override.summary,
					uid: m.uid,
				});
				continue;
			}
			// Base instance
			const instStart = occStart;
			const instEnd = instStart.plus({ milliseconds: durationMs });
			results.push({
				allDay: m.all_day === 1,
				calendarId: m.calendar_id,
				description: m.description,
				end: instEnd.toISO()!,
				location: m.location,
				recurrence: { isRecurring: true, masterUid: m.uid, recurrenceId },
				source: { type: calTypeById.get(m.calendar_id)!, id: m.uid },
				start: instStart.toISO()!,
				status: m.status,
				summary: m.summary,
				uid: m.uid,
			});
		}
	}
	// Add singles
	for (const s of singles) {
		if (!includeCancelled && (s.status ?? '').toLowerCase() === 'cancelled') continue;
		results.push({
			allDay: s.all_day === 1,
			calendarId: s.calendar_id,
			description: s.description,
			end: DateTime.fromISO(s.end_iso, { zone: 'utc' }).toISO()!,
			location: s.location,
			recurrence: { isRecurring: false },
			source: { type: calTypeById.get(s.calendar_id)!, id: s.uid },
			start: DateTime.fromISO(s.start_iso, { zone: 'utc' }).toISO()!,
			status: s.status,
			summary: s.summary,
			uid: s.uid,
		});
	}
	results.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
	cache.set(cacheKey, results);
	return results;
};

// module-level cache instance
const expandCache = new LruCache<EventOut[]>({ ttlMs: 30_000, maxSize: 200 });
