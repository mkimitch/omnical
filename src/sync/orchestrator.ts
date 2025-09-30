'use strict';
import { syncGoogleCalendars } from './google.js';
import { syncIcsCalendars } from './ics.js';

export type SyncResult = {
	google: { updated: number; calendars: string[] };
	ics: { updated: number; calendars: string[] };
};

export const syncAll = async (): Promise<SyncResult> => {
	const [g, i] = await Promise.all([syncGoogleCalendars(), syncIcsCalendars()]);
	return { google: g, ics: i };
};
