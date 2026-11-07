import type { Request } from 'express';
import { Router } from 'express';
import { and, count, desc, eq, like, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db.ts';
import { mails, type Mail } from '../schema.ts';
import { optionalApiKey, requireApiKey } from '../middleware/api-key-auth.ts';
import { HttpError } from '../middleware/error-handler.ts';
import { recordUsage } from '../services/usage.ts';
import { deliverMail, MailDeliveryError } from '../services/mailer.ts';
import { renderRecipientMails, type RenderedMailItem } from '../services/template.ts';

export const mailsRouter = Router();

const statusSchema = z.enum(['QUEUED', 'SENT', 'FAILED']);

const createMailSchema = z.object({
  to: z.email('Must be a valid email address'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(20_000),
});

const bulkRecipientSchema = z.object({
  to: z.email('Must be a valid email address'),
  variables: z.record(z.string(), z.string()).optional(),
});

const bulkSendMailSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  body: z.string().trim().min(1, 'Body is required').max(20_000),
  recipients: z
    .array(bulkRecipientSchema)
    .min(1, 'At least one recipient is required')
    .max(100, 'Maximum 100 recipients per batch'),
});

const bulkCreateMailSchema = bulkSendMailSchema.extend({
  sendNow: z.boolean().optional().default(true),
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

function sendErrorCode(status: number): string {
  if (status === 404) return 'MAIL_NOT_FOUND';
  if (status === 409) return 'MAIL_ALREADY_SENT';
  if (status === 400) return 'INVALID_REQUEST';
  return 'MAIL_SEND_FAILED';
}

async function logMailUsage(
  req: Request,
  startedAt: number,
  input: {
    outcome: 'SUCCESS' | 'FAILED';
    statusCode: number;
    mailId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
): Promise<void> {
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
    requestId: req.auditContext?.requestId ?? null,
    ip: req.auditContext?.ip ?? null,
    userAgent: req.auditContext?.userAgent ?? null,
  });
}

/** GET /api/mails — paginated list with optional status filter and free-text search. */
mailsRouter.get('/', async (req, res) => {
  const { status, search, limit, offset } = listQuerySchema.parse(req.query);

  const conditions: SQL[] = [];
  if (status) conditions.push(eq(mails.status, status));
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(or(like(mails.to, pattern), like(mails.subject, pattern)) as SQL);
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

/**
 * POST /api/mails/send — 1-step direct mail delivery for external services.
 * Requires an API key with the 'mail:send' scope.
 */
mailsRouter.post('/send', requireApiKey('mail:send'), async (req, res) => {
  const startedAt = Date.now();

  const parsed = createMailSchema.safeParse(req.body);
  if (!parsed.success) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 400,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage: 'Validation failed',
    });
    throw parsed.error;
  }

  const [queued] = await db.insert(mails).values(parsed.data).returning();

  try {
    await deliverMail(parsed.data);

    const [sentMail] = await db
      .update(mails)
      .set({ status: 'SENT', sentAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(mails.id, queued.id))
      .returning();

    await logMailUsage(req, startedAt, {
      outcome: 'SUCCESS',
      statusCode: 201,
      mailId: sentMail.id,
    });

    res.status(201).json(sentMail);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SMTP error';
    await db
      .update(mails)
      .set({ status: 'FAILED', error: errorMessage, updatedAt: new Date() })
      .where(eq(mails.id, queued.id));

    const status = error instanceof HttpError ? error.status : 502;
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: status,
      mailId: queued.id,
      errorCode: sendErrorCode(status),
      errorMessage,
    });

    throw error;
  }
});

interface BulkMailExecutionResult {
  total: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  items: Mail[];
}

async function executeBulkSend(renderedItems: RenderedMailItem[]): Promise<BulkMailExecutionResult> {
  const inserted = await db
    .insert(mails)
    .values(
      renderedItems.map((item) => ({
        to: item.to,
        subject: item.subject,
        body: item.body,
        status: 'QUEUED' as const,
      })),
    )
    .returning();

  const items: Mail[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (const mail of inserted) {
    try {
      await deliverMail({ to: mail.to, subject: mail.subject, body: mail.body });

      const [sentMail] = await db
        .update(mails)
        .set({ status: 'SENT', sentAt: new Date(), error: null, updatedAt: new Date() })
        .where(eq(mails.id, mail.id))
        .returning();

      items.push(sentMail ?? { ...mail, status: 'SENT', sentAt: new Date(), error: null });
      sentCount++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown SMTP error';
      const [failedMail] = await db
        .update(mails)
        .set({ status: 'FAILED', error: errorMessage, updatedAt: new Date() })
        .where(eq(mails.id, mail.id))
        .returning();

      items.push(failedMail ?? { ...mail, status: 'FAILED', error: errorMessage });
      failedCount++;
    }
  }

  return {
    total: items.length,
    queuedCount: 0,
    sentCount,
    failedCount,
    items,
  };
}

async function logBulkSendResult(
  req: Request,
  startedAt: number,
  result: BulkMailExecutionResult,
): Promise<void> {
  if (result.failedCount === result.total) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 502,
      mailId: result.items[0]?.id ?? null,
      errorCode: 'MAIL_SEND_FAILED',
      errorMessage: 'All emails in batch failed to deliver',
    });
    return;
  }

  await logMailUsage(req, startedAt, {
    outcome: 'SUCCESS',
    statusCode: 201,
    mailId: result.items[0]?.id ?? null,
  });
}

/**
 * POST /api/mails/send-bulk — bulk direct mail delivery for external services.
 * Requires an API key with the 'mail:send' scope.
 */
mailsRouter.post('/send-bulk', requireApiKey('mail:send'), async (req, res) => {
  const startedAt = Date.now();

  const parsed = bulkSendMailSchema.safeParse(req.body);
  if (!parsed.success) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 400,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage: 'Validation failed',
    });
    throw parsed.error;
  }

  let renderedItems: RenderedMailItem[];
  try {
    renderedItems = renderRecipientMails(parsed.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Template validation failed';
    const status = error instanceof HttpError ? error.status : 400;
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: status,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage,
    });
    throw error;
  }

  const result = await executeBulkSend(renderedItems);
  await logBulkSendResult(req, startedAt, result);

  res.status(201).json(result);
});

/**
 * POST /api/mails/bulk — bulk mail creation for Admin UI (optional API key, supports sendNow).
 */
mailsRouter.post('/bulk', optionalApiKey, async (req, res) => {
  const startedAt = Date.now();

  const parsed = bulkCreateMailSchema.safeParse(req.body);
  if (!parsed.success) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 400,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage: 'Validation failed',
    });
    throw parsed.error;
  }

  let renderedItems: RenderedMailItem[];
  try {
    renderedItems = renderRecipientMails(parsed.data);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Template validation failed';
    const status = error instanceof HttpError ? error.status : 400;
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: status,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage,
    });
    throw error;
  }

  if (!parsed.data.sendNow) {
    const inserted = await db
      .insert(mails)
      .values(
        renderedItems.map((item) => ({
          to: item.to,
          subject: item.subject,
          body: item.body,
          status: 'QUEUED' as const,
        })),
      )
      .returning();

    await logMailUsage(req, startedAt, {
      outcome: 'SUCCESS',
      statusCode: 201,
      mailId: inserted[0]?.id ?? null,
    });

    res.status(201).json({
      total: inserted.length,
      queuedCount: inserted.length,
      sentCount: 0,
      failedCount: 0,
      items: inserted,
    });
    return;
  }

  const result = await executeBulkSend(renderedItems);
  await logBulkSendResult(req, startedAt, result);

  res.status(201).json(result);
});

/**
 * POST /api/mails/:id/send — delivers a queued or failed mail via SMTP.
 *
 * An API key is optional; when one is used the call is written to
 * api_key_usage_logs (SUCCESS here, FAILED in the catch) without ever changing
 * the response the admin UI already relies on.
 */
mailsRouter.post('/:id/send', optionalApiKey, async (req, res) => {
  const startedAt = Date.now();
  const rawId = typeof req.params.id === 'string' ? req.params.id : '';

  const parsedId = idSchema.safeParse(rawId);
  if (!parsedId.success) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 400,
      mailId: null,
      errorCode: 'INVALID_REQUEST',
      errorMessage: 'Invalid mail id',
    });
    throw parsedId.error;
  }
  const id = parsedId.data;

  const [existing] = await db.select().from(mails).where(eq(mails.id, id));
  if (!existing) {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 404,
      mailId: null,
      errorCode: 'MAIL_NOT_FOUND',
      errorMessage: 'Mail not found',
    });
    throw new HttpError(404, 'Mail not found');
  }

  if (existing.status === 'SENT') {
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: 409,
      mailId: existing.id,
      errorCode: 'MAIL_ALREADY_SENT',
      errorMessage: 'Mail has already been sent',
    });
    throw new HttpError(409, 'Mail has already been sent');
  }

  try {
    await deliverMail({ to: existing.to, subject: existing.subject, body: existing.body });

    const [mail] = await db
      .update(mails)
      .set({ status: 'SENT', sentAt: new Date(), error: null, updatedAt: new Date() })
      .where(eq(mails.id, id))
      .returning();

    await logMailUsage(req, startedAt, { outcome: 'SUCCESS', statusCode: 200, mailId: mail.id });
    res.json(mail);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await db
      .update(mails)
      .set({ status: 'FAILED', error: errorMessage, updatedAt: new Date() })
      .where(eq(mails.id, id));

    const status = error instanceof HttpError ? error.status : 502;
    await logMailUsage(req, startedAt, {
      outcome: 'FAILED',
      statusCode: status,
      mailId: existing.id,
      errorCode: sendErrorCode(status),
      errorMessage,
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
