'use strict';
import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { initDb } from './index.js';

let sqliteInst: Database.Database | null = null;
let drizzleDb: BetterSQLite3Database | null = null;

export const getDb = () => {
	if (!sqliteInst || !drizzleDb) {
		const { sqlite, db } = initDb();
		sqliteInst = sqlite as unknown as Database.Database;
		drizzleDb = db as unknown as BetterSQLite3Database;
	}
	return { sqlite: sqliteInst!, db: drizzleDb! };
};
