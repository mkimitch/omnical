'use strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';

const ensureMigrationsTable = (sqlite: Database.Database) => {
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at INTEGER NOT NULL
		)
	`);
};

const getAppliedMigrations = (sqlite: Database.Database): Set<string> => {
	ensureMigrationsTable(sqlite);
	const rows = sqlite.prepare('SELECT name FROM _migrations').all() as { name: string }[];
	return new Set(rows.map((r) => r.name));
};

const markMigrationApplied = (sqlite: Database.Database, name: string) => {
	sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(name, Date.now());
};

export const initDb = () => {
	const env = loadEnv();
	const dbPath = path.resolve(env.DB_PATH);
	const dir = path.dirname(dbPath);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	const sqlite = new Database(dbPath);
	// Pragmas for performance + durability balance
	sqlite.pragma('journal_mode = WAL');
	sqlite.pragma('synchronous = NORMAL');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite);
	// Run migrations
	const migrationsFolder = path.resolve('drizzle/migrations');
	try {
		migrate(db, { migrationsFolder });
		logger.info({ migrationsFolder }, 'Database migrated');
	} catch (err) {
		logger.warn({ err }, 'Drizzle migrator failed; attempting manual SQL migration fallback');
		try {
			// Apply only unapplied SQL migrations in order
			const migrations = ['000_init.sql'];
			const applied = getAppliedMigrations(sqlite);

			for (const migFile of migrations) {
				if (applied.has(migFile)) {
					logger.debug({ migFile }, 'Migration already applied, skipping');
					continue;
				}

				const migPath = path.join(migrationsFolder, migFile);
				if (fs.existsSync(migPath)) {
					const sql = fs.readFileSync(migPath, 'utf8');
					sqlite.exec(sql);
					markMigrationApplied(sqlite, migFile);
					logger.info({ migPath }, 'Manual SQL migration applied');
				}
			}
		} catch (e) {
			logger.error({ e }, 'Manual SQL migration fallback failed');
			throw e;
		}
	}
	return { sqlite, db };
};
