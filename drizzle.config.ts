'use strict';
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
	dialect: 'sqlite',
	schema: './src/db/schema.ts',
	out: './drizzle/migrations',
	dbCredentials: {
		url: process.env.DB_PATH ?? './data/cal.db',
	},
	strict: true,
	verbose: true,
});
