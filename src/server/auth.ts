'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { loadEnv } from '../config/env.js';

const authPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	const env = loadEnv();
	fastify.addHook('onRequest', (req, reply, next) => {
		if (req.url === '/healthz' || req.url.startsWith('/metrics')) return next();
		const apiKey = req.headers['x-api-key'];
		if (!apiKey || apiKey !== env.API_KEY) {
			reply.code(401).send({ ok: false, error: 'Unauthorized' });
			return;
		}
		next();
	});
	done();
};

export default fp(authPlugin);
