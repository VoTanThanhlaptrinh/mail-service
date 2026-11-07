import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';
import * as schema from './schema.ts';

/**
 * DATABASE_URL accepts either:
 *  - a remote libSQL / Turso URL ("libsql://<db>.turso.io", "https://...") — needs TURSO_AUTH_TOKEN
 *  - a local SQLite file ("file:./data/mail.db" or a plain path such as "./data/mail.db")
 */
const REMOTE_PROTOCOLS = /^(libsql|https?|wss?):\/\//i;

function resolveDatabase(): { url: string; authToken?: string; isLocalFile: boolean } {
  const raw = env.DATABASE_URL;

  if (REMOTE_PROTOCOLS.test(raw)) {
    return { url: raw, authToken: env.TURSO_AUTH_TOKEN || undefined, isLocalFile: false };
  }

  if (env.IS_SERVERLESS) {
    console.error(
      'DATABASE_URL must be a remote libSQL/Turso URL (libsql://...) on Vercel: the serverless ' +
        'filesystem is ephemeral, so a local SQLite file would lose its data.',
    );
    process.exit(1);
  }

  const filePath = raw.startsWith('file:') ? raw.slice(5) : raw;
  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

  // Use a file: URL with forward slashes so Windows drive letters work too.
  return { url: `file:${resolvedPath.replaceAll('\\', '/')}`, isLocalFile: true };
}

const database = resolveDatabase();

export const client = createClient({ url: database.url, authToken: database.authToken });

if (database.isLocalFile) {
  // Remote libSQL enforces foreign keys by default; do the same for local files.
  await client.execute('PRAGMA foreign_keys = ON');
}

export const db = drizzle(client, { schema });

export async function closeDb(): Promise<void> {
  client.close();
}
