import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.ts';
import * as schema from './schema.ts';

/**
 * Connection settings, in priority order:
 *  1. TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) — remote Turso / libSQL ("libsql://<db>.turso.io")
 *  2. DATABASE_URL — a local SQLite file ("file:./data/mail.db" or "./data/mail.db"),
 *     or a remote libSQL URL as well (used with TURSO_AUTH_TOKEN)
 */
const REMOTE_PROTOCOLS = /^(libsql|https?|wss?):\/\//i;

function resolveDatabase(): { url: string; authToken?: string; isLocalFile: boolean } {
  const raw = env.TURSO_DATABASE_URL || env.DATABASE_URL;

  if (REMOTE_PROTOCOLS.test(raw)) {
    if (!env.TURSO_AUTH_TOKEN) {
      console.error('TURSO_AUTH_TOKEN is empty: a remote Turso database needs an auth token.');
      process.exit(1);
    }
    return { url: raw, authToken: env.TURSO_AUTH_TOKEN, isLocalFile: false };
  }

  if (env.IS_SERVERLESS) {
    console.error(
      'Set TURSO_DATABASE_URL (libsql://...) and TURSO_AUTH_TOKEN on Vercel: the serverless ' +
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
