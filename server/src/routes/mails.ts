import { Router } from 'express';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { ZodError, z } from 'zod';
import { db } from '../db.ts';
import { mails } from '../schema.ts';
import { optionalApiKey } from '../middleware/api-key-auth.ts';
import { HttpError } from '../middleware/error-handler.ts';
import { recordUsage } from '../services/usage.ts';

export const mailsRouter = Router();

const statusSchema = z.enum(['QUEUED', 'SENT', 'FAILED']);

const createMailSchema = z.object({
  to: z.email('Must be a valid email address'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(20_000),
});

const updateMailSchema = z.object({
  status: statusSchema,
  error: z.string().max(2_000).nullish(),
});

const listQuerySchema = z.object({
  status: statusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const idSchema = z.uuid('Invalid mail id');

/** GET /api/mails — paginated list with optional status filter and free-text search. */
mailsRouter.get('/', async (req, res) => {
  const { status, search, limit, offset } = listQuerySchema.parse(req.query);

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(mails.status, status));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(ilike(mails.to, pattern), ilike(mails.subject, pattern)) as SQL);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [items, totalRows] = await Promise.all([
    db.select().from(mails).where(where).orderBy(desc(mails.createdAt)).limit(limit).offset(offset),
    db.select({ value: count() }).from(mails).where(where),
  ]);

  res.json({ items, total: Number(totalRows[0]?.value ?? 0), limit, offset });
});

/** GET /api/mails/:id */
mailsRouter.get('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const [mail] = await db.select().from(mails).where(eq(mails.id, id));

  if (!mail) throw new HttpError(404, 'Mail not found');
  res.json(mail);
});

/** POST /api/mails — queue a new mail. */
mailsRouter.post('/', async (req, res) => {
  const data = createMailSchema.parse(req.body);
  const [mail] = await db.insert(mails).values(data).returning();
  res.status(201).json(mail);
});

function sendErrorCode(status: number): string {
  if (status === 404) return 'MAIL_NOT_FOUND';
  if (status === 409) return 'MAIL_ALREADY_SENT';
  if (status === 400) return 'INVALID_REQUEST';
  return 'MAIL_SEND_FAILED';
}

/**
 * POST /api/mails/:id/send — placeholder transport: marks the mail as sent.
 *
 * An API key is optional; when one is used the call is written to
 * api_key_usage_logs (SUCCESS here, FAILED in the catch) without ever changing
 * the response the admin UI already relies on.
 */
mailsRouter.post('/:id/send', optionalApiKey, async (req, res) => {
  const startedAt = Date.now();
  const rawId = typeof req.params.id === 'string' ? req.params.id : '';
  const context = req.auditContext;

  const logUsage = async (input: {
    outcome: 'SUCCESS' | 'FAILED';
    statusCode: number;
    mailId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }) => {
    if (!req.apiKey) return;

    await recordUsage({
      apiKeyId: req.apiKey.id,
      mailId: input.mailId ?? null,
      outcome: input.outcome,
      httpMethod: req.method,
      path: req.originalUrl,
      statusCode: input.statusCode,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      durationMs: Date.now() - startedAt,
      requestId: context?.requestId ?? null,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });
  };

  try {
    const id = idSchema.parse(rawId);
    const [existing] = await db.select().from(mails).where(eq(mails.id, id));

    if (!existing) throw new HttpError(404, 'Mail not found');
    if (existing.status === 'SENT') throw new HttpError(409, 'Mail has already been sent');

    const [mail] = await db
      .update(mails)
      .set({ status: 'SENT', sentAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(mails.id, id))
      .returning();

    await logUsage({ outcome: 'SUCCESS', statusCode: 200, mailId: mail.id });
    res.json(mail);
  } catch (error) {
    const status =
      error instanceof HttpError ? error.status : error instanceof ZodError ? 400 : 500;

    // A missing mail cannot be referenced by the usage FK, so the row stays
    // attributable to the key but not to a mail id that does not exist.
    const mailId =
      status === 404 || !z.uuid().safeParse(rawId).success ? null : rawId;

    await logUsage({
      outcome: 'FAILED',
      statusCode: status,
      mailId,
      errorCode: sendErrorCode(status),
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
});

/** PATCH /api/mails/:id — update status / error message. */
mailsRouter.patch('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const data = updateMailSchema.parse(req.body);

  const [existing] = await db.select().from(mails).where(eq(mails.id, id));
  if (!existing) throw new HttpError(404, 'Mail not found');

  const [mail] = await db
    .update(mails)
    .set({
      status: data.status,
      error: data.error ?? null,
      updatedAt: new Date(),
      ...(data.status === 'SENT' ? { sentAt: existing.sentAt ?? new Date() } : {}),
    })
    .where(eq(mails.id, id))
    .returning();

  res.json(mail);
});

/** DELETE /api/mails/:id */
mailsRouter.delete('/:id', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const deleted = await db.delete(mails).where(eq(mails.id, id)).returning({ id: mails.id });

  if (deleted.length === 0) throw new HttpError(404, 'Mail not found');
  res.status(204).end();
});
