'use strict';
import { DateTime } from 'luxon';
import rrulePkg from 'rrule';
import { getDb } from '../db/conn.js';
import { listEnabledCalendars } from '../db/repo.js';
import { LruCache } from '../util/lru.js';
const { RRule, RRuleSet, rrulestr } = rrulePkg;

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

type CalendarFilterConfig = {
	enabled?: boolean;
	allDay?: {
		excludeKeywords?: string[];
		allowKeywords?: string[];
	};
	dedupe?: {
		enabled?: boolean;
		acrossCalendars?: boolean;
		group?: string;
		caseInsensitiveSummary?: boolean;
		requireNonEmptySummary?: boolean;
	};
};

const parseCalendarFilterConfig = (json: string | null): CalendarFilterConfig | null => {
	if (!json) return null;
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		return parsed as CalendarFilterConfig;
	} catch {
		return null;
	}
};

const includesAny = (haystackLower: string, needles: string[]): boolean => {
	for (const n of needles) {
		const needle = n.trim().toLowerCase();
		if (needle.length === 0) continue;
		if (haystackLower.includes(needle)) return true;
	}
	return false;
};

const normalizeSummary = (summary: string, caseInsensitive: boolean): string => {
	const trimmed = summary.trim();
	return caseInsensitive ? trimmed.toLowerCase() : trimmed;
};

const eventRichnessScore = (e: EventOut): number => {
	let score = 0;
	if (typeof e.location === 'string' && e.location.trim().length > 0) score += 1;
	if (typeof e.description === 'string' && e.description.trim().length > 0) score += 1;
	if (typeof e.status === 'string' && e.status.trim().length > 0) score += 1;
	return score;
};

const passesCalendarFilters = (e: EventOut, cfg: CalendarFilterConfig | null): boolean => {
	if (!cfg || cfg.enabled !== true) return true;
	if (e.allDay) {
		const deny = cfg.allDay?.excludeKeywords ?? [];
		if (deny.length > 0) {
			const allow = cfg.allDay?.allowKeywords ?? [];
			const text = `${e.summary ?? ''}\n${e.description ?? ''}\n${e.location ?? ''}`.toLowerCase();
			if (allow.length > 0 && includesAny(text, allow)) return true;
			if (includesAny(text, deny)) return false;
		}
	}
	return true;
};

const getOverrideMasterUid = (row: RawRow): string => {
	try {
		const src = JSON.parse(row.source_json) as { recurringEventId?: string } | null;
		if (src && typeof src.recurringEventId === 'string' && src.recurringEventId.length > 0) {
			return src.recurringEventId;
		}
	} catch {}
	return row.uid;
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
	opts?: { crossCalendarDedupe?: boolean },
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
		x: opts?.crossCalendarDedupe === true,
		cals: enabled.map((c) => ({ id: c.id, u: c.updated_at })),
	});
	const cached = cache.get(cacheKey);
	if (cached) return cached;
	const calTypeById = new Map(enabled.map((c) => [c.id, c.type as 'google' | 'ics']));
	const calFilterById = new Map(
		enabled.map((c) => [c.id, parseCalendarFilterConfig(c.filter_json)]),
	);
	const calRankById = new Map(enabled.map((c, idx) => [c.id, idx]));

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
	// Singles intersecting window (recurrence_id NULL). Some rows may carry an empty recurrence_json; filter in TS.
	const singles = sqlite
		.prepare(
			`SELECT * FROM raw_events WHERE recurrence_id IS NULL
			 AND calendar_id IN (${qMarks}) AND start_iso < ? AND end_iso > ?`,
		)
		.all(...enabledIds, end.toISO(), start.toISO()) as RawRow[];
	const movedOverrides = sqlite
		.prepare(
			`SELECT * FROM raw_events WHERE recurrence_id IS NOT NULL
			 AND calendar_id IN (${qMarks}) AND start_iso < ? AND end_iso > ?
			 AND (recurrence_id < ? OR recurrence_id > ?)`,
		)
		.all(...enabledIds, end.toISO(), start.toISO(), start.toISO(), end.toISO()) as RawRow[];

	const overridesByKey = new Map<string, RawRow>();
	for (const o of overrides) {
		if (o.recurrence_id) {
			const masterUid = getOverrideMasterUid(o);
			overridesByKey.set(`${o.calendar_id}::${masterUid}::${o.recurrence_id}`, o);
		}
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
			const override = overridesByKey.get(
				`${m.calendar_id}::${getOverrideMasterUid(m)}::${recurrenceId}`,
			);
			if (override) {
				if (!includeCancelled && (override.status ?? '').toLowerCase() === 'cancelled') continue;
				results.push({
					allDay: override.all_day === 1,
					calendarId: m.calendar_id,
					description: override.description,
					end: DateTime.fromISO(override.end_iso, { zone: 'utc' }).toISO()!,
					location: override.location,
					recurrence: { isRecurring: true, masterUid: getOverrideMasterUid(m), recurrenceId },
					source: { type: calTypeById.get(m.calendar_id)!, id: m.uid },
					start: DateTime.fromISO(override.start_iso, { zone: 'utc' }).toISO()!,
					status: override.status,
					summary: override.summary,
					uid: m.uid,
				});
				continue;
			}
			// Base instance
			let instStart = occStart;
			if (m.tzid && m.all_day === 0) {
				const zone = m.tzid;
				const baseLocal = DateTime.fromISO(m.start_iso, { zone });
				const occLocal = occStart.setZone(zone);
				const deltaMin = baseLocal.offset - occLocal.offset;
				if (deltaMin !== 0) {
					instStart = instStart.plus({ minutes: deltaMin });
				}
			}
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
		const r = parseRecurrence(s.recurrence_json);
		if (r.rrule || r.exdates.length > 0 || r.rdates.length > 0) continue;
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
	for (const o of movedOverrides) {
		if (!includeCancelled && (o.status ?? '').toLowerCase() === 'cancelled') continue;
		const masterUid = getOverrideMasterUid(o);
		results.push({
			allDay: o.all_day === 1,
			calendarId: o.calendar_id,
			description: o.description,
			end: DateTime.fromISO(o.end_iso, { zone: 'utc' }).toISO()!,
			location: o.location,
			recurrence: { isRecurring: true, masterUid, recurrenceId: o.recurrence_id! },
			source: { type: calTypeById.get(o.calendar_id)!, id: o.uid },
			start: DateTime.fromISO(o.start_iso, { zone: 'utc' }).toISO()!,
			status: o.status,
			summary: o.summary,
			uid: o.uid,
		});
	}
	const filtered = results.filter((e) => {
		if (!(DateTime.fromISO(e.start) < end && DateTime.fromISO(e.end) > start)) return false;
		return passesCalendarFilters(e, calFilterById.get(e.calendarId) ?? null);
	});

	const kept: EventOut[] = [];
	const bestByKey = new Map<string, { e: EventOut; rank: number; score: number; uid: string }>();
	for (const e of filtered) {
		const cfg = calFilterById.get(e.calendarId) ?? null;
		const d = cfg?.dedupe;
		if (!d || d.enabled !== true) {
			kept.push(e);
			continue;
		}
		const requireNonEmpty = d.requireNonEmptySummary !== false;
		const rawSummary = e.summary ?? '';
		if (requireNonEmpty && rawSummary.trim().length === 0) {
			kept.push(e);
			continue;
		}
		const caseInsensitive = d.caseInsensitiveSummary !== false;
		const normSummary = normalizeSummary(rawSummary, caseInsensitive);
		const allowCross = opts?.crossCalendarDedupe === true && d.acrossCalendars === true;
		const group =
			allowCross && typeof d.group === 'string' && d.group.trim().length > 0
				? d.group.trim()
				: '__all__';
		const bucket = allowCross ? `g:${group}` : `c:${e.calendarId}`;
		const key = `${bucket}::${normSummary}::${e.allDay ? 1 : 0}::${e.start}::${e.end}`;
		const rank = calRankById.get(e.calendarId) ?? 999_999;
		const score = eventRichnessScore(e);
		const uid = e.uid;
		const existing = bestByKey.get(key);
		if (!existing) {
			bestByKey.set(key, { e, rank, score, uid });
			continue;
		}
		if (rank < existing.rank) {
			bestByKey.set(key, { e, rank, score, uid });
			continue;
		}
		if (rank > existing.rank) continue;
		if (score > existing.score) {
			bestByKey.set(key, { e, rank, score, uid });
			continue;
		}
		if (score < existing.score) continue;
		if (uid.localeCompare(existing.uid) < 0) {
			bestByKey.set(key, { e, rank, score, uid });
		}
	}

	const deduped = [...kept, ...Array.from(bestByKey.values(), (v) => v.e)];
	deduped.sort((a, b) => {
		if (a.start !== b.start) return a.start < b.start ? -1 : 1;
		if (a.end !== b.end) return a.end < b.end ? -1 : 1;
		const ra = calRankById.get(a.calendarId) ?? 999_999;
		const rb = calRankById.get(b.calendarId) ?? 999_999;
		if (ra !== rb) return ra - rb;
		const sa = (a.summary ?? '').localeCompare(b.summary ?? '');
		if (sa !== 0) return sa;
		return a.uid.localeCompare(b.uid);
	});
	cache.set(cacheKey, deduped);
	return deduped;
};

// module-level cache instance
const expandCache = new LruCache<EventOut[]>({ ttlMs: 30_000, maxSize: 200 });
