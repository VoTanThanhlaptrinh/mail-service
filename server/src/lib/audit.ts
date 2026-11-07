import { db } from '../db.ts';
import { auditLogs, type AuditChanges } from '../schema.ts';

/** Identity and request metadata attached to every audited database write. */
export interface AuditContext {
  actor: string;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
}

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const systemAuditContext: AuditContext = {
  actor: 'system',
  requestId: null,
  ip: null,
  userAgent: null,
};

export async function recordAudit(
  tx: DbTransaction,
  context: AuditContext,
  entry: {
    entity: string;
    entityId: string;
    action: string;
    changes?: AuditChanges;
  },
): Promise<void> {
  await tx.insert(auditLogs).values({
    entity: entry.entity,
    entityId: entry.entityId,
    action: entry.action,
    actor: context.actor,
    changes: entry.changes ?? {},
    requestId: context.requestId,
    ipAddress: context.ip,
    userAgent: context.userAgent,
    occurredAt: new Date(),
  });
}

/**
 * Runs work inside one transaction.
 */
export async function withAudit<T>(
  _context: AuditContext,
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    return work(tx);
  });
}
