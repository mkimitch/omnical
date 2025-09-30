'use strict';
import { DateTime } from 'luxon';
import ical from 'node-ical';
import type { CalendarRow, RawEventRow } from '../db/repo.js';
import { listEnabledCalendars, updateCalendarIcsState, upsertRawEvent } from '../db/repo.js';
import { logger } from '../logging/logger.js';

const headerOrNull = (res: Response, name: string): string | null => {
	const v = res.headers.get(name);
	return v && v.length > 0 ? v : null;
};

const mapIcalEventToRows = (cal: CalendarRow, ev: any): RawEventRow[] => {
	// node-ical ICalEvent shape
	const uid: string = ev.uid || `${cal.id}-${ev.id}`;
	const recurrenceId: string | null = ev.recurrenceid
		? DateTime.fromJSDate(ev.recurrenceid, { zone: 'utc' }).toISO()
		: null;
	const startIso = DateTime.fromJSDate(ev.start, { zone: 'utc' }).toISO()!;
	const endIso = DateTime.fromJSDate(ev.end, { zone: 'utc' }).toISO()!;
	const allDay = (() => {
		try {
			const dur = DateTime.fromISO(endIso).toMillis()! - DateTime.fromISO(startIso).toMillis()!;
			return ev.datetype === 'date' || dur === 86_400_000 ? 1 : 0;
		} catch {
			return 0;
		}
	})();
	const rruleStr = ev.rrule ? String(ev.rrule.toString()) : null;
	const exdates: string[] = ev.exdate
		? (Object.values(ev.exdate) as Date[]).map((d) => DateTime.fromJSDate(d, { zone: 'utc' }).toISO()!)
		: [];
	const rdates: string[] = Array.isArray(ev.rdate)
		? (ev.rdate as Date[]).map((d) => DateTime.fromJSDate(d, { zone: 'utc' }).toISO()!)
		: [];
	const hasRecurrence = rruleStr !== null || exdates.length > 0 || rdates.length > 0;
	const recurrenceJson = hasRecurrence
		? JSON.stringify({ rrule: rruleStr, exdates, rdates })
		: null;
	const row: RawEventRow = {
		calendar_id: cal.id,
		uid,
		recurrence_id: recurrenceId,
		updated_ts: Date.now(),
		status: ev.status ?? null,
		all_day: allDay,
		start_iso: startIso,
		end_iso: endIso,
		tzid: (ev.rrule?.origOptions?.tzid as string | undefined) ?? null,
		summary: ev.summary ?? null,
		location: ev.location ?? null,
		description: typeof ev.description === 'string' ? ev.description : null,
		recurrence_json: recurrenceJson,
		source_json: JSON.stringify({
			uid: ev.uid,
			start: ev.start,
			end: ev.end,
			status: ev.status,
			summary: ev.summary,
			location: ev.location,
			description: ev.description,
			recurrenceid: ev.recurrenceid,
			rrule: rruleStr,
			exdate: exdates,
			rdate: rdates,
		}),
	};
	return [row];
};

const upsertIcsText = (cal: CalendarRow, icsText: string): number => {
	let count = 0;
	const parsed = ical.parseICS(icsText);
	for (const key of Object.keys(parsed)) {
		const comp = parsed[key] as any;
		if (!comp || comp.type !== 'VEVENT') continue;
		const rows = mapIcalEventToRows(cal, comp);
		for (const row of rows) {
			upsertRawEvent(row);
			count++;
		}
	}
	return count;
};

export const syncIcsCalendars = async (): Promise<{ updated: number; calendars: string[] }> => {
	const enabled = listEnabledCalendars().filter((c) => c.type === 'ics');
	let updated = 0;
	const calendars: string[] = [];
	for (const cal of enabled) {
		if (!cal.ics_url) continue;
		try {
			const headers: Record<string, string> = {
				Accept: 'text/calendar, text/plain, */*',
				'User-Agent': 'omnical/0.1 (+local)',
			};
			if (cal.ics_etag) headers['If-None-Match'] = cal.ics_etag;
			if (cal.ics_last_mod) headers['If-Modified-Since'] = cal.ics_last_mod;
			const res = await fetch(cal.ics_url, { headers });
			logger.info(
				{ cal: cal.id, status: res.status, ct: res.headers.get('content-type') },
				'ICS fetch response',
			);
			if (res.status === 304) {
				logger.info({ cal: cal.id }, 'ICS not modified');
				continue;
			}
			if (!res.ok) {
				throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
			}
			const text = await res.text();
			const count = upsertIcsText(cal, text);
			const etag = headerOrNull(res, 'etag');
			const lastMod = headerOrNull(res, 'last-modified');
			updateCalendarIcsState(cal.id, etag, lastMod);
			updated += count;
			calendars.push(cal.id);
			logger.info({ cal: cal.id, count }, 'ICS synced');
		} catch (err) {
			logger.error({ cal: cal.id, err }, 'ICS sync failed');
		}
	}
	return { updated, calendars };
};
