'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import os from 'node:os';

const started = Date.now();

const metricsPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	fastify.get('/metrics', async (_req, reply) => {
		const lines: string[] = [];
		lines.push('# HELP up 1 if the service is up');
		lines.push('# TYPE up gauge');
		lines.push('up 1');
		lines.push(
			'# HELP process_start_time_seconds Start time of the process since unix epoch in seconds.',
		);
		lines.push('# TYPE process_start_time_seconds gauge');
		lines.push(`process_start_time_seconds ${Math.floor(started / 1000)}`);
		lines.push('# HELP nodejs_memory_rss_bytes Resident set size in bytes.');
		lines.push('# TYPE nodejs_memory_rss_bytes gauge');
		lines.push(`nodejs_memory_rss_bytes ${process.memoryUsage().rss}`);
		reply.header('Content-Type', 'text/plain; version=0.0.4');
		return lines.join('\n') + '\n';
	});
	done();
};

export default fp(metricsPlugin);
