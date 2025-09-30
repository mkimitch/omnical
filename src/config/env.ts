/*
	Zod-validated environment configuration
*/
'use strict';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
	API_KEY: z.string().min(8),
	BIND_ADDR: z.string().default('127.0.0.1'),
	DATA_DIR: z.string().default('./data'),
	DB_PATH: z.string().default('./data/cal.db'),
	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	GOOGLE_SCOPES: z.string().default('https://www.googleapis.com/auth/calendar.readonly'),
	ICS_URLS: z.string().optional(),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	OAUTH_ENCRYPTION_KEY: z
		.string()
		.length(44, { message: 'OAUTH_ENCRYPTION_KEY must be 32-byte base64 (44 chars)' })
		.optional(),
	PORT: z.coerce.number().int().positive().default(8787),
	SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(300000),
});

export type Env = z.infer<typeof envSchema> & {
	icsUrls: string[];
};

export const loadEnv = (): Env => {
	const parsed = envSchema.safeParse(process.env);
	if (!parsed.success) {
		// Format Zod errors nicely
		const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
		throw new Error(`Invalid environment variables:\n${issues}`);
	}
	const env = parsed.data;
	// Ensure data dir exists
	const dataDir = path.resolve(env.DATA_DIR);
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
	return { ...env, icsUrls: env.ICS_URLS ? env.ICS_URLS.split(',').map((s) => s.trim()) : [] };
};
