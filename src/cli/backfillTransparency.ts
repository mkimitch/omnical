'use strict';
/**
 * Backfill script for transparency column on raw_events table.
 * 
 * This script reads the source_json for each event and extracts the transparency
 * value from the original source data, then updates the transparency column.
 * 
 * Usage: npx tsx src/cli/backfillTransparency.ts
 * 
 * Safe to run multiple times (idempotent).
 */

import { getDb } from '../db/conn.js';

type RawEventRow = {
	calendar_id: string;
	uid: string;
	recurrence_id: string | null;
	source_json: string;
	transparency: string | null;
};

type CalendarRow = {
	id: string;
	type: 'google' | 'ics';
};

const normalizeGoogleTransparency = (value: string | undefined): 'opaque' | 'transparent' => {
	if (!value) return 'opaque';
	const lower = value.toLowerCase();
	return lower === 'transparent' ? 'transparent' : 'opaque';
};

const normalizeIcsTransparency = (value: string | undefined | null): 'opaque' | 'transparent' => {
	if (!value) return 'opaque';
	const upper = value.toUpperCase().trim();
	return upper === 'TRANSPARENT' ? 'transparent' : 'opaque';
};

const extractTransparency = (
	sourceJson: string,
	calType: 'google' | 'ics',
): 'opaque' | 'transparent' => {
	try {
		const parsed = JSON.parse(sourceJson) as Record<string, unknown>;
		if (calType === 'google') {
			const val = parsed.transparency;
			return normalizeGoogleTransparency(typeof val === 'string' ? val : undefined);
		} else {
			const val = parsed.transp;
			return normalizeIcsTransparency(typeof val === 'string' ? val : undefined);
		}
	} catch {
		return 'opaque';
	}
};

const main = async () => {
	console.log('Starting transparency backfill...');
	
	const { sqlite } = getDb();
	
	// Get calendar types
	const calendars = sqlite.prepare('SELECT id, type FROM calendars').all() as CalendarRow[];
	const calTypeById = new Map(calendars.map((c) => [c.id, c.type]));
	console.log(`Found ${calendars.length} calendars`);
	
	// Get all events that need backfill (transparency is NULL or we want to re-verify)
	const events = sqlite
		.prepare('SELECT calendar_id, uid, recurrence_id, source_json, transparency FROM raw_events')
		.all() as RawEventRow[];
	console.log(`Found ${events.length} events to process`);
	
	const updateStmt = sqlite.prepare(
		"UPDATE raw_events SET transparency = @transparency WHERE calendar_id = @calendar_id AND uid = @uid AND COALESCE(recurrence_id, 'master') = @reckey"
	);
	
	let updated = 0;
	let skipped = 0;
	
	for (const event of events) {
		const calType = calTypeById.get(event.calendar_id);
		if (!calType) {
			console.warn(`Unknown calendar type for calendar_id: ${event.calendar_id}`);
			skipped++;
			continue;
		}
		
		const extractedTransparency = extractTransparency(event.source_json, calType);
		
		// Only update if different from current value
		if (event.transparency !== extractedTransparency) {
			const reckey = event.recurrence_id ?? 'master';
			updateStmt.run({
				transparency: extractedTransparency,
				calendar_id: event.calendar_id,
				uid: event.uid,
				reckey,
			});
			updated++;
		} else {
			skipped++;
		}
	}
	
	console.log(`Backfill complete: ${updated} updated, ${skipped} skipped (already correct)`);
};

main().catch((err) => {
	console.error('Backfill failed:', err);
	process.exit(1);
});
