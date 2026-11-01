import { sql } from 'drizzle-orm';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import type { NodePgTransaction } from 'drizzle-orm/node-postgres';
import { db } from '../db.ts';
import * as schema from '../schema.ts';

/** Identity and request metadata attached to every audited database write. */
export interface AuditContext {
  actor: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export type DbTransaction = NodePgTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export const systemAuditContext: AuditContext = {
  actor: 'system',
  requestId: null,
  ip: null,
  userAgent: null,
};

function safeSettingValue(value: string | null): string | null {
  if (!value) return null;
  // PostgreSQL session settings cannot contain NUL bytes.
  const cleaned = value.replace(/\u0000/g, '').slice(0, 500);
  return cleaned.length > 0 ? cleaned : null;
}

async function publishSetting(
  tx: DbTransaction,
  name: string,
  value: string | null,
): Promise<void> {
  const safe = safeSettingValue(value);
  if (!safe) return;
  await tx.execute(sql`select set_config(${name}, ${safe}, true)`);
}

/**
 * Runs work inside one transaction, publishing the audit actor/request metadata
 * as transaction-local settings. The triggers from migration 0002 read them to
 * fill created_by/updated_by and the audit_logs row, so every write path that
 * goes through this helper is attributed correctly.
 */
export async function withAudit<T>(
  context: AuditContext,
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await publishSetting(tx, 'app.actor', context.actor);
    await publishSetting(tx, 'app.request_id', context.requestId);
    await publishSetting(tx, 'app.ip', context.ip);
    await publishSetting(tx, 'app.user_agent', context.userAgent);
    return work(tx);
  });
}
