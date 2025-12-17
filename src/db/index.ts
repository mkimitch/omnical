'use strict';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnv } from '../config/env.js';
import { logger } from '../logging/logger.js';

const splitSqlStatements = (sql: string): string[] => {
	const out: string[] = [];
	let cur = '';
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i]!;
		const prev = i > 0 ? sql[i - 1] : '';
		if (!inDouble && ch === "'" && prev !== '\\') inSingle = !inSingle;
		if (!inSingle && ch === '"' && prev !== '\\') inDouble = !inDouble;
		if (!inSingle && !inDouble && ch === ';') {
			const stmt = cur.trim();
			if (stmt.length > 0) out.push(stmt);
			cur = '';
			continue;
		}
		cur += ch;
	}
	const last = cur.trim();
	if (last.length > 0) out.push(last);
	return out;
};

const applySqlMigrationFile = (sqlite: Database.Database, migPath: string) => {
	const sql = fs.readFileSync(migPath, 'utf8');
	const statements = splitSqlStatements(sql);
	for (const stmt of statements) {
		try {
			sqlite.exec(stmt);
		} catch (e: any) {
			const msg = typeof e?.message === 'string' ? e.message : '';
			const isDupCol = msg.toLowerCase().includes('duplicate column name');
			const isAddCol = stmt.toLowerCase().includes('add column');
			if (isDupCol && isAddCol) continue;
			throw e;
		}
	}
};

const applyManualSqlMigrations = (sqlite: Database.Database, migrationsFolder: string) => {
	ensureMigrationsTable(sqlite);
	const applied = getAppliedMigrations(sqlite);
	const migFiles = fs
		.readdirSync(migrationsFolder)
		.filter((f) => /^\d{3}_.+\.sql$/.test(f))
		.sort((a, b) => a.localeCompare(b));

	for (const migFile of migFiles) {
		if (applied.has(migFile)) continue;
		const migPath = path.join(migrationsFolder, migFile);
		if (!fs.existsSync(migPath)) continue;
		applySqlMigrationFile(sqlite, migPath);
		markMigrationApplied(sqlite, migFile);
		logger.info({ migPath }, 'Manual SQL migration applied');
	}
	sqlite.pragma('foreign_keys = ON');
};

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
		logger.warn({ err }, 'Drizzle migrator failed; continuing with manual SQL migrations');
	}

	try {
		applyManualSqlMigrations(sqlite, migrationsFolder);
	} catch (e) {
		logger.error({ e }, 'Manual SQL migrations failed');
		throw e;
	}
	return { sqlite, db };
};
