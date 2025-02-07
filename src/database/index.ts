import { PostgresDatabaseAdapter } from '../adapter-postgres/src/index.ts';
import { SqliteDatabaseAdapter } from '../adapter-sqlite/src/index.ts';
import Database from 'better-sqlite3';
import path from 'path';

export function initializeDatabase(dataDir: string) {
  if (process.env.POSTGRES_URL) {
    const db = new PostgresDatabaseAdapter({
      connectionString: process.env.POSTGRES_URL,
    });
    return db;
  } else {
    const filePath = process.env.SQLITE_FILE ?? path.resolve(dataDir, 'db.sqlite');
    // ":memory:";
    const db = new SqliteDatabaseAdapter(new Database(filePath));
    return db;
  }
}
