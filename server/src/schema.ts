import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const mailStatus = pgEnum('mail_status', ['QUEUED', 'SENT', 'FAILED']);

export const mails = pgTable(
  'mails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: mailStatus('status').notNull().default('QUEUED'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('mails_status_idx').on(table.status),
    index('mails_created_at_idx').on(table.createdAt),
  ],
);

export type Mail = typeof mails.$inferSelect;
export type NewMail = typeof mails.$inferInsert;
export type MailStatus = Mail['status'];
