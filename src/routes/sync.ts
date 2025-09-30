'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { syncAll } from '../sync/orchestrator.js';

const syncPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	fastify.post('/v1/sync', async (_req, _reply) => {
		const result = await syncAll();
		return result;
	});
	done();
};

export default fp(syncPlugin);
