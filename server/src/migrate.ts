import { client, closeDb } from './db.ts';

async function main(): Promise<void> {
  console.log('Running SQLite migrations...');

  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS mails (
      id TEXT PRIMARY KEY,
      "to" TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
      error TEXT,
      sent_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS mails_status_idx ON mails (status);
    CREATE INDEX IF NOT EXISTS mails_created_at_idx ON mails (created_at);

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      key_prefix TEXT NOT NULL,
      key_last4 TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
      scopes TEXT NOT NULL DEFAULT '["mail:send"]',
      expires_at INTEGER,
      last_used_at INTEGER,
      revoked_at INTEGER,
      revoked_reason TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL DEFAULT 'system',
      deleted_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS api_keys_status_created_idx ON api_keys (status, created_at);
    CREATE INDEX IF NOT EXISTS api_keys_created_at_idx ON api_keys (created_at);

    CREATE TABLE IF NOT EXISTS api_key_usage_logs (
      id TEXT PRIMARY KEY,
      api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE RESTRICT,
      mail_id TEXT REFERENCES mails(id) ON DELETE SET NULL,
      action TEXT NOT NULL DEFAULT 'mail.send',
      outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILED', 'REJECTED')),
      http_method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER,
      error_code TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      request_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS api_key_usage_logs_key_created_idx ON api_key_usage_logs (api_key_id, created_at);
    CREATE INDEX IF NOT EXISTS api_key_usage_logs_mail_idx ON api_key_usage_logs (mail_id);
    CREATE INDEX IF NOT EXISTS api_key_usage_logs_created_at_idx ON api_key_usage_logs (created_at);
    CREATE INDEX IF NOT EXISTS api_key_usage_logs_outcome_idx ON api_key_usage_logs (outcome, created_at);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      occurred_at INTEGER NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      changes TEXT NOT NULL DEFAULT '{}',
      request_id TEXT,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity, entity_id, occurred_at);
    CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON audit_logs (occurred_at);
    CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor, occurred_at);
  `);

  const tableInfo = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mails'",
  );
  const sqlDef = (tableInfo.rows[0]?.sql as string | undefined) ?? '';
  if (sqlDef && !sqlDef.includes("'SENDING'")) {
    console.log("Upgrading mails table CHECK constraint to include 'SENDING'...");
    await client.execute('PRAGMA foreign_keys = OFF');
    await client.executeMultiple(`
      CREATE TABLE mails_new (
        id TEXT PRIMARY KEY,
        "to" TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED')),
        error TEXT,
        sent_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO mails_new (id, "to", subject, body, status, error, sent_at, created_at, updated_at)
        SELECT id, "to", subject, body, status, error, sent_at, created_at, updated_at FROM mails;
      DROP TABLE mails;
      ALTER TABLE mails_new RENAME TO mails;
      CREATE INDEX IF NOT EXISTS mails_status_idx ON mails (status);
      CREATE INDEX IF NOT EXISTS mails_created_at_idx ON mails (created_at);
    `);
    await client.execute('PRAGMA foreign_keys = ON');
    console.log('Mails table upgraded successfully.');
  }

  console.log('SQLite tables initialized successfully.');
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
