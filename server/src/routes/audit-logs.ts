import { Router } from 'express';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db.ts';
import { auditLogs, type AuditLog } from '../schema.ts';

export const auditLogsRouter = Router();

const auditQuerySchema = z.object({
  entity: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(120).optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE', 'REVOKE', 'ROTATE']).optional(),
  actor: z.string().trim().max(120).optional(),
  from: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/audit-logs — read the append-only audit trail. */
auditLogsRouter.get('/', async (req, res) => {
  const query = auditQuerySchema.parse(req.query);

  if (query.from && query.to && query.from > query.to) {
    res.status(400).json({ error: 'from must be earlier than or equal to to' });
    return;
  }

  const conditions: SQL[] = [];
  if (query.entity) conditions.push(eq(auditLogs.entity, query.entity));
  if (query.entityId) conditions.push(eq(auditLogs.entityId, query.entityId));
  if (query.action) conditions.push(eq(auditLogs.action, query.action));
  if (query.actor) conditions.push(eq(auditLogs.actor, query.actor));
  if (query.from) conditions.push(gte(auditLogs.occurredAt, query.from));
  if (query.to) conditions.push(lte(auditLogs.occurredAt, query.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(auditLogs).where(where),
  ]);

  res.json({
    items: items satisfies AuditLog[],
    total: Number(totalRows[0]?.value ?? 0),
    limit: query.limit,
    offset: query.offset,
  });
});
