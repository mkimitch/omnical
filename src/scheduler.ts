'use strict';
import { loadEnv } from './config/env.js';
import { logger } from './logging/logger.js';
import { syncAll } from './sync/orchestrator.js';

let running = false;

export const startScheduler = (): void => {
	const env = loadEnv();
	const interval = env.SYNC_INTERVAL_MS;
	const tick = async () => {
		if (running) return;
		running = true;
		const start = Date.now();
		try {
			const res = await syncAll();
			const dur = Date.now() - start;
			logger.info({ durMs: dur, res }, 'Periodic sync complete');
		} catch (err) {
			logger.error({ err }, 'Periodic sync failed');
		} finally {
			running = false;
		}
	};
	setInterval(tick, interval).unref();
	logger.info({ interval }, 'Scheduler started');
};
