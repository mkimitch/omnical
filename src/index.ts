import 'dotenv/config';
import Fastify from 'fastify';
import { loadEnv } from './config/env.js';
import { initDb } from './db/index.js';
import { ensureIcsCalendarsFromEnv } from './db/repo.js';
import { logger } from './logging/logger.js';
import calendarsPlugin from './routes/calendars.js';
import eventsPlugin from './routes/events.js';
import healthPlugin from './routes/health.js';
import icsPlugin from './routes/ics.js';
import metricsPlugin from './routes/metrics.js';
import syncPlugin from './routes/sync.js';
import { startScheduler } from './scheduler.js';
import authPlugin from './server/auth.js';
('use strict');

const main = async () => {
	const env = loadEnv();
	// Initialize DB (runs migrations)
	initDb();

	// Bootstrap ICS calendars from env if provided
	if (env.icsUrls.length > 0) {
		ensureIcsCalendarsFromEnv();
	}

	const app = Fastify({ logger });
	await app.register(authPlugin);
	await app.register(healthPlugin);
	await app.register(calendarsPlugin);
	await app.register(eventsPlugin);
	await app.register(icsPlugin);
	await app.register(syncPlugin);
	await app.register(metricsPlugin);

	try {
		await app.listen({ host: env.BIND_ADDR, port: env.PORT });
		logger.info({ addr: env.BIND_ADDR, port: env.PORT }, 'Server listening');
		startScheduler();
	} catch (err) {
		logger.error({ err }, 'Server failed to start');
		process.exit(1);
	}
};

main();
