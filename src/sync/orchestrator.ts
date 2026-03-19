'use strict';
import { syncGoogleCalendars } from './google.js';
import { syncIcsCalendars } from './ics.js';
import { syncGoogleTasks } from './tasks.js';

export type SyncResult = {
	google: { updated: number; calendars: string[] };
	ics: { updated: number; calendars: string[] };
	tasks: { updated: number; taskLists: string[] };
};

export const syncAll = async (): Promise<SyncResult> => {
	const [g, i, t] = await Promise.all([syncGoogleCalendars(), syncIcsCalendars(), syncGoogleTasks()]);
	return { google: g, ics: i, tasks: t };
};
