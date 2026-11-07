import { Router } from 'express';
import { and, count, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db.ts';
import { recordAudit, withAudit } from '../lib/audit.ts';
import { formatApiKeyPrefix, generateApiKey } from '../lib/api-keys.ts';
import { HttpError } from '../middleware/error-handler.ts';
import { apiKeys, type ApiKey } from '../schema.ts';
import { listUsage, usageQuerySchema } from './usage.ts';

export const apiKeysRouter = Router();

const scopeSchema = z.enum(['mail:send']);

const expiresAtSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value))
  .refine((date) => date.getTime() > Date.now(), 'expiresAt must be in the future');

const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).nullish(),
  scopes: z.array(scopeSchema).min(1, 'At least one scope is required').max(5).default(['mail:send']),
  expiresAt: expiresAtSchema.nullish(),
});

const updateApiKeySchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    scopes: z.array(scopeSchema).min(1).max(5).optional(),
    expiresAt: z.union([expiresAtSchema, z.null()]).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field is required');

const listQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'REVOKED']).optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idSchema = z.uuid('Invalid API key id');

const revokeSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

const KEY_NOTICE = 'Store this key now. It is shown only once and cannot be recovered.';

/** Public projection — key_hash is intentionally never exposed. */
function publicApiKey(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    description: apiKey.description,
    prefix: formatApiKeyPrefix(apiKey.keyPrefix, apiKey.keyLast4),
    status: apiKey.status,
    scopes: apiKey.scopes,
    expiresAt: apiKey.expiresAt,
    lastUsedAt: apiKey.lastUsedAt,
    revokedAt: apiKey.revokedAt,
    revokedReason: apiKey.revokedReason,
    createdAt: apiKey.createdAt,
    createdBy: apiKey.createdBy,
    updatedAt: apiKey.updatedAt,
    updatedBy: apiKey.updatedBy,
    deletedAt: apiKey.deletedAt,
  };
}

async function findApiKeyOrThrow(id: string): Promise<ApiKey> {
  const [apiKey] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), isNull(apiKeys.deletedAt)));

  if (!apiKey) throw new HttpError(404, 'API key not found');
  return apiKey;
}

/** POST /api/api-keys — register a key. The plaintext secret is returned once. */
apiKeysRouter.post('/', async (req, res) => {
  const data = createApiKeySchema.parse(req.body);
  const generated = generateApiKey();
  const context = req.auditContext;

  const created = await withAudit(context, async (tx) => {
    const [row] = await tx
      .insert(apiKeys)
      .values({
        name: data.name,
        description: data.description ?? null,
        scopes: data.scopes,
        expiresAt: data.expiresAt ?? null,
        keyPrefix: generated.keyPrefix,
        keyLast4: generated.keyLast4,
        keyHash: generated.keyHash,
        createdBy: context.actor,
        updatedBy: context.actor,
      })
      .returning();

    await recordAudit(tx, context, {
      entity: 'api_key',
      entityId: row.id,
      action: 'CREATE',
      changes: { after: { name: row.name, scopes: row.scopes, status: row.status } },
    });

    return row;
  });

  res.status(201).json({
    ...publicApiKey(created),
    key: generated.key,
    keyNotice: KEY_NOTICE,
  });
});

/** GET /api/api-keys — paginated list of active/revoked keys (never deleted). */
apiKeysRouter.get('/', async (req, res) => {
  const { status, search, limit, offset } = listQuerySchema.parse(req.query);

  const conditions: SQL[] = [isNull(apiKeys.deletedAt)];
  if (status) conditions.push(eq(apiKeys.status, status));
  if (search) {
    const pattern = '%' + search + '%';
    conditions.push(or(like(apiKeys.name, pattern), like(apiKeys.keyPrefix, pattern)) as SQL);
  }

  const where = and(...conditions);

  const [items, totalRows] = await Promise.all([
    db.select().from(apiKeys).where(where).orderBy(desc(apiKeys.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(apiKeys).where(where),
  ]);

  res.json({
    items: items.map(publicApiKey),
    total: Number(totalRows[0]?.value ?? 0),
    limit,
    offset,
  });
});

/** GET /api/api-keys/:id */
apiKeysRouter.get('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const apiKey = await findApiKeyOrThrow(id);
  res.json(publicApiKey(apiKey));
});

/** GET /api/api-keys/:id/usage — email-call history for one key. */
apiKeysRouter.get('/:id/usage', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  await findApiKeyOrThrow(id);

  const query = usageQuerySchema.omit({ apiKeyId: true }).parse(req.query);
  const result = await listUsage({ ...query, apiKeyId: id });

  res.json({ ...result, limit: query.limit, offset: query.offset });
});

/** PATCH /api/api-keys/:id — rename, change scopes or expiry. */
apiKeysRouter.patch('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = updateApiKeySchema.parse(req.body);
  const existing = await findApiKeyOrThrow(id);

  const updated = await withAudit(req.auditContext, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
        ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      })
      .where(eq(apiKeys.id, id))
      .returning();

    await recordAudit(tx, req.auditContext, {
      entity: 'api_key',
      entityId: id,
      action: 'UPDATE',
      changes: {
        before: { name: existing.name, description: existing.description, scopes: existing.scopes, expiresAt: existing.expiresAt },
        after: { name: row.name, description: row.description, scopes: row.scopes, expiresAt: row.expiresAt },
      },
    });

    return row;
  });

  res.json(publicApiKey(updated));
});

/** POST /api/api-keys/:id/revoke — permanently disable a key (idempotent guard). */
apiKeysRouter.post('/:id/revoke', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = revokeSchema.parse(req.body ?? {});
  const existing = await findApiKeyOrThrow(id);

  if (existing.status === 'REVOKED') {
    throw new HttpError(409, 'API key is already revoked');
  }

  const updated = await withAudit(req.auditContext, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: data.reason ?? 'Revoked via API',
      })
      .where(eq(apiKeys.id, id))
      .returning();

    await recordAudit(tx, req.auditContext, {
      entity: 'api_key',
      entityId: id,
      action: 'REVOKE',
      changes: {
        before: { status: existing.status },
        after: { status: 'REVOKED', revokedReason: data.reason ?? 'Revoked via API' },
      },
    });

    return row;
  });

  res.json(publicApiKey(updated));
});

/** POST /api/api-keys/:id/rotate — replace the secret in place, keeping history. */
apiKeysRouter.post('/:id/rotate', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const existing = await findApiKeyOrThrow(id);

  if (existing.status === 'REVOKED') {
    throw new HttpError(409, 'Cannot rotate a revoked API key');
  }

  const generated = generateApiKey();

  const updated = await withAudit(req.auditContext, async (tx) => {
    const [row] = await tx
      .update(apiKeys)
      .set({
        keyHash: generated.keyHash,
        keyPrefix: generated.keyPrefix,
        keyLast4: generated.keyLast4,
      })
      .where(eq(apiKeys.id, id))
      .returning();

    await recordAudit(tx, req.auditContext, {
      entity: 'api_key',
      entityId: id,
      action: 'ROTATE',
      changes: { key_rotated: true },
    });

    return row;
  });

  res.json({
    ...publicApiKey(updated),
    key: generated.key,
    keyNotice: KEY_NOTICE,
  });
});

/** DELETE /api/api-keys/:id — soft delete (kept in the audit trail forever). */
apiKeysRouter.delete('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const existing = await findApiKeyOrThrow(id);
  const now = new Date();

  await withAudit(req.auditContext, async (tx) => {
    await tx
      .update(apiKeys)
      .set({
        status: 'REVOKED',
        revokedAt: existing.revokedAt ?? now,
        revokedReason: existing.revokedReason ?? 'Deleted via API',
        deletedAt: now,
      })
      .where(eq(apiKeys.id, id));

    await recordAudit(tx, req.auditContext, {
      entity: 'api_key',
      entityId: id,
      action: 'DELETE',
      changes: {
        before: { status: existing.status, deletedAt: null },
        after: { status: 'REVOKED', deletedAt: now },
      },
    });
  });

  res.status(204).end();
});
