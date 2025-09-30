'use strict';
import 'dotenv/config';
import { pollForToken, startDeviceAuth } from '../google/oauth.js';
import { logger } from '../logging/logger.js';

const main = async () => {
	try {
		const dc = await startDeviceAuth();
		// Friendly console output for device flow
		// eslint-disable-next-line no-console
		console.log('\nGoogle Device Authorization');
		// eslint-disable-next-line no-console
		console.log('===============================');
		// eslint-disable-next-line no-console
		console.log(`Open this URL: ${dc.verification_url}`);
		// eslint-disable-next-line no-console
		console.log(`Enter the code: ${dc.user_code}`);
		// eslint-disable-next-line no-console
		console.log('Waiting for you to authorize...\n');

		const tokens = await pollForToken(dc.device_code, dc.interval ?? 5);
		logger.info({ expiry: new Date(tokens.expiry_date).toISOString() }, 'Google tokens stored');
		// eslint-disable-next-line no-console
		console.log('Success! Tokens stored.');
		process.exit(0);
	} catch (err) {
		logger.error({ err }, 'Google device auth failed');
		// eslint-disable-next-line no-console
		console.error('Error:', err);
		process.exit(1);
	}
};

main();
