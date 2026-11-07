import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';
import * as schema from './schema.ts';

const dbPath = env.DATABASE_URL.startsWith('file:')
  ? env.DATABASE_URL.slice(5)
  : env.DATABASE_URL;

const resolvedPath = path.resolve(process.cwd(), dbPath);
const dir = path.dirname(resolvedPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const sqlite = new Database(resolvedPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export async function closeDb(): Promise<void> {
  sqlite.close();
}
