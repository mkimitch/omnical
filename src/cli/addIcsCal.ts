'use strict';
import 'dotenv/config';
import { upsertCalendarIcs } from '../db/repo.js';
import { logger } from '../logging/logger.js';

const main = async () => {
	const url = process.argv[2];
	const label = process.argv[3];
	if (!url) {
		// eslint-disable-next-line no-console
		console.error('Usage: yarn add:ics <icsUrl> [label]');
		process.exit(1);
	}
	const row = upsertCalendarIcs(url, label);
	logger.info({ id: row.id, icsUrl: row.ics_url }, 'ICS calendar added');
	// eslint-disable-next-line no-console
	console.log('OK:', row);
};

main();
