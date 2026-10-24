import { DateTime } from 'luxon';
import rrulePkg from 'rrule';

const { RRule, RRuleSet, rrulestr } = rrulePkg;

type RecurrenceInput = {
	startIso: string;
	rrule: string | null;
	exdates: string[];
	rdates: string[];
	// Null for all-day events and timed events without a source timezone.
	timeZone: string | null;
};

// RRule's UTC fields carry local calendar components, never an instant here.
const toWallClock = (instant: DateTime, zone: string): Date =>
	instant.setZone(zone).setZone('utc', { keepLocalTime: true }).toJSDate();

export const expandRecurrence = (
	input: RecurrenceInput,
	start: DateTime,
	end: DateTime,
): Date[] => {
	const { startIso, rrule, exdates, rdates, timeZone } = input;
	// This set always contains true UTC instants (UTC dates for all-day events).
	const set = new RRuleSet();
	const dtstart = DateTime.fromISO(startIso, { zone: 'utc' });
	if (rrule) {
		const parsed = rrulestr(rrule, { dtstart: dtstart.toJSDate() }) as InstanceType<typeof RRule>;
		if (timeZone) {
			const until = parsed.origOptions.until;
			const limit = until ? DateTime.fromJSDate(until, { zone: 'utc' }) : end;
			if (limit >= start) {
				// rrule 2.8.1's TZID conversion depends on the host timezone and checks
				// UNTIL before rezoning. Evaluate floating wall time, then resolve with
				// Luxon and enforce the original UTC UNTIL against the actual instant.
				const rule = new RRule({
					...parsed.origOptions,
					dtstart: toWallClock(dtstart, timeZone),
					tzid: undefined,
					until: null,
				});
				// Widen candidate bounds across offset transitions; filter real instants
				// below. This does not shift any generated occurrence.
				const candidates = rule.between(
					toWallClock(start.minus({ days: 1 }), timeZone),
					toWallClock((limit < end ? limit : end).plus({ days: 1 }), timeZone),
					true,
				);
				for (const candidate of candidates) {
					const instant = DateTime.fromJSDate(candidate, { zone: 'utc' })
						.setZone(timeZone, { keepLocalTime: true })
						.toUTC();
					if (
						instant >= start &&
						instant <= end &&
						(!until || instant.toMillis() <= until.getTime())
					) {
						set.rdate(instant.toJSDate());
					}
				}
			}
		} else {
			// Preserve the existing date-only / UTC recurrence path.
			set.dtstart(dtstart.toJSDate());
			set.rrule(parsed);
		}
	}
	// Normalized additions/exclusions are instants, so never rezone them. RDATE
	// is independent of RRULE's UNTIL; EXDATE takes precedence over both.
	for (const rd of rdates) set.rdate(DateTime.fromISO(rd, { zone: 'utc' }).toJSDate());
	for (const ex of exdates) set.exdate(DateTime.fromISO(ex, { zone: 'utc' }).toJSDate());
	return set.between(start.toJSDate(), end.toJSDate(), true);
};
