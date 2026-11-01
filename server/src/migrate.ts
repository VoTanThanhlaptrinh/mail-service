import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { closeDb, pool } from './db.ts';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '..', 'migrations');

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith('.sql')).sort();

    if (files.length === 0) {
      console.log(`No .sql files found in ${MIGRATIONS_DIR}`);
      return;
    }

    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM _migrations WHERE name = $1', [file]);
      if ((applied.rowCount ?? 0) > 0) {
        console.log(`- ${file} (already applied)`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`+ ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    client.release();
    await closeDb();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
