'use strict';
import 'dotenv/config';
import { upsertCalendarGoogle } from '../db/repo.js';
import { logger } from '../logging/logger.js';

const main = async () => {
	const calId = process.argv[2];
	const label = process.argv[3];
	if (!calId) {
		// eslint-disable-next-line no-console
		console.error('Usage: yarn add:gcal <googleCalendarId> [label]');
		process.exit(1);
	}
	const row = upsertCalendarGoogle(calId, label);
	logger.info({ id: row.id, googleCalId: row.google_cal_id }, 'Google calendar added');
	// eslint-disable-next-line no-console
	console.log('OK:', row);
};

main();
