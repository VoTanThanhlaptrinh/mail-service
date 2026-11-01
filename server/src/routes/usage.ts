import { Router } from 'express';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db.ts';
import { formatApiKeyPrefix } from '../lib/api-keys.ts';
import { apiKeyUsageLogs, apiKeys, type ApiKeyUsageOutcome } from '../schema.ts';

export const usageRouter = Router();

export const usageQuerySchema = z.object({
  apiKeyId: z.uuid('Invalid API key id').optional(),
  mailId: z.uuid('Invalid mail id').optional(),
  outcome: z.enum(['SUCCESS', 'FAILED', 'REJECTED']).optional(),
  from: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  to: z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export interface UsageFilters {
  apiKeyId?: string;
  mailId?: string;
  outcome?: ApiKeyUsageOutcome;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

function buildUsageWhere(filters: UsageFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.apiKeyId) conditions.push(eq(apiKeyUsageLogs.apiKeyId, filters.apiKeyId));
  if (filters.mailId) conditions.push(eq(apiKeyUsageLogs.mailId, filters.mailId));
  if (filters.outcome) conditions.push(eq(apiKeyUsageLogs.outcome, filters.outcome));
  if (filters.from) conditions.push(gte(apiKeyUsageLogs.createdAt, filters.from));
  if (filters.to) conditions.push(lte(apiKeyUsageLogs.createdAt, filters.to));

  return conditions.length > 0 ? and(...conditions) : undefined;
}

/** Shared by GET /api/usage-logs and GET /api/api-keys/:id/usage. */
export async function listUsage(filters: UsageFilters) {
  const where = buildUsageWhere(filters);

  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: apiKeyUsageLogs.id,
        apiKeyId: apiKeyUsageLogs.apiKeyId,
        apiKeyName: apiKeys.name,
        apiKeyPrefix: apiKeys.keyPrefix,
        apiKeyLast4: apiKeys.keyLast4,
        mailId: apiKeyUsageLogs.mailId,
        action: apiKeyUsageLogs.action,
        outcome: apiKeyUsageLogs.outcome,
        httpMethod: apiKeyUsageLogs.httpMethod,
        path: apiKeyUsageLogs.path,
        statusCode: apiKeyUsageLogs.statusCode,
        errorCode: apiKeyUsageLogs.errorCode,
        errorMessage: apiKeyUsageLogs.errorMessage,
        durationMs: apiKeyUsageLogs.durationMs,
        requestId: apiKeyUsageLogs.requestId,
        ipAddress: apiKeyUsageLogs.ipAddress,
        userAgent: apiKeyUsageLogs.userAgent,
        metadata: apiKeyUsageLogs.metadata,
        createdAt: apiKeyUsageLogs.createdAt,
      })
      .from(apiKeyUsageLogs)
      .leftJoin(apiKeys, eq(apiKeyUsageLogs.apiKeyId, apiKeys.id))
      .where(where)
      .orderBy(desc(apiKeyUsageLogs.createdAt))
      .limit(filters.limit)
      .offset(filters.offset),
    db
      .select({ value: count() })
      .from(apiKeyUsageLogs)
      .where(where),
  ]);

  const items = rows.map(({ apiKeyLast4, ...row }) => ({
    ...row,
    apiKeyPrefix: row.apiKeyPrefix
      ? formatApiKeyPrefix(row.apiKeyPrefix, apiKeyLast4 ?? '')
      : null,
  }));

  return { items, total: Number(totalRows[0]?.value ?? 0) };
}

/** GET /api/usage-logs — global email-call history with filters. */
usageRouter.get('/', async (req, res) => {
  const query = usageQuerySchema.parse(req.query);

  if (query.from && query.to && query.from > query.to) {
    res.status(400).json({ error: 'from must be earlier than or equal to to' });
    return;
  }

  const result = await listUsage(query);
  res.json({ ...result, limit: query.limit, offset: query.offset });
});
