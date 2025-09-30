'use strict';
import type { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { DateTime } from 'luxon';
import fs from 'node:fs';
import path from 'node:path';

const healthPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
	fastify.get('/healthz', async () => {
		let version = '0.0.0';
		try {
			const p = path.resolve('package.json');
			const txt = fs.readFileSync(p, 'utf8');
			version = JSON.parse(txt).version ?? version;
		} catch {}
		return { ok: true, now: DateTime.utc().toMillis(), version };
	});
	done();
};

export default fp(healthPlugin);
