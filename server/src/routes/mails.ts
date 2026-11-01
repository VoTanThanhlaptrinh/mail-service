import { Router } from 'express';
import { and, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db.ts';
import { mails } from '../schema.ts';
import { HttpError } from '../middleware/error-handler.ts';

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

/** POST /api/mails/:id/send — placeholder transport: marks the mail as sent. */
mailsRouter.post('/:id/send', async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const [existing] = await db.select().from(mails).where(eq(mails.id, id));

  if (!existing) throw new HttpError(404, 'Mail not found');
  if (existing.status === 'SENT') throw new HttpError(409, 'Mail has already been sent');

  const [mail] = await db
    .update(mails)
    .set({ status: 'SENT', sentAt: new Date(), error: null, updatedAt: new Date() })
    .where(eq(mails.id, id))
    .returning();

  res.json(mail);
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
