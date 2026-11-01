import { relations, sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const mailStatus = pgEnum('mail_status', ['QUEUED', 'SENT', 'FAILED']);
export const apiKeyStatus = pgEnum('api_key_status', ['ACTIVE', 'REVOKED']);
export const apiKeyUsageOutcome = pgEnum('api_key_usage_outcome', ['SUCCESS', 'FAILED', 'REJECTED']);

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

/**
 * Registered API keys.
 *
 * Only a SHA-256 hash of the secret is stored (`keyHash`); `keyPrefix` and
 * `keyLast4` exist so the key can be recognised in the UI. Rows are soft
 * deleted through `deletedAt` and every lifecycle change is captured in
 * `audit_logs` by a database trigger (see migration 0002).
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    keyPrefix: text('key_prefix').notNull(),
    keyLast4: text('key_last4').notNull(),
    keyHash: text('key_hash').notNull(),
    status: apiKeyStatus('status').notNull().default('ACTIVE'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`ARRAY['mail:send']::text[]`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by').notNull().default('system'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text('updated_by').notNull().default('system'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('api_keys_key_hash_key').on(table.keyHash),
    index('api_keys_status_created_idx').on(table.status, table.createdAt.desc()),
    index('api_keys_created_at_idx').on(table.createdAt.desc()),
    index('api_keys_expires_at_idx').on(table.expiresAt).where(sql`${table.expiresAt} IS NOT NULL`),
    index('api_keys_deleted_at_idx').on(table.deletedAt).where(sql`${table.deletedAt} IS NOT NULL`),
    check('api_keys_name_not_blank', sql`length(btrim(${table.name})) > 0`),
    check('api_keys_scopes_not_empty', sql`cardinality(${table.scopes}) > 0`),
    check(
      'api_keys_revoked_consistency',
      sql`(${table.status} = 'REVOKED') = (${table.revokedAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Append-only ledger of email calls made with an API key.
 *
 * One row per call: action (`mail.send`), outcome, HTTP result, duration and
 * request metadata. Rows can never be updated or deleted (enforced by trigger).
 */
export const apiKeyUsageLogs = pgTable(
  'api_key_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'restrict' }),
    mailId: uuid('mail_id').references(() => mails.id, { onDelete: 'set null' }),
    action: text('action').notNull().default('mail.send'),
    outcome: apiKeyUsageOutcome('outcome').notNull(),
    httpMethod: text('http_method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    requestId: text('request_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('api_key_usage_logs_key_created_idx').on(table.apiKeyId, table.createdAt.desc()),
    index('api_key_usage_logs_mail_idx').on(table.mailId).where(sql`${table.mailId} IS NOT NULL`),
    index('api_key_usage_logs_created_at_idx').on(table.createdAt.desc()),
    index('api_key_usage_logs_outcome_idx').on(table.outcome, table.createdAt.desc()),
    index('api_key_usage_logs_request_id_idx')
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    check(
      'api_key_usage_logs_status_code_range',
      sql`${table.statusCode} IS NULL OR ${table.statusCode} BETWEEN 100 AND 599`,
    ),
    check(
      'api_key_usage_logs_duration_non_negative',
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`,
    ),
  ],
);

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  key_rotated?: boolean;
}

/**
 * Append-only audit trail written by triggers (see migration 0002).
 * `entity` + `entityId` point at the audited row; `changes` holds the
 * before/after snapshots (secret hashes are stripped).
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull().default('system'),
    changes: jsonb('changes').$type<AuditChanges>().notNull().default(sql`'{}'::jsonb`),
    requestId: text('request_id'),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entity, table.entityId, table.occurredAt.desc()),
    index('audit_logs_occurred_at_idx').on(table.occurredAt.desc()),
    index('audit_logs_actor_idx').on(table.actor, table.occurredAt.desc()),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  usageLogs: many(apiKeyUsageLogs),
}));

export const apiKeyUsageLogsRelations = relations(apiKeyUsageLogs, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [apiKeyUsageLogs.apiKeyId], references: [apiKeys.id] }),
  mail: one(mails, { fields: [apiKeyUsageLogs.mailId], references: [mails.id] }),
}));

export type Mail = typeof mails.$inferSelect;
export type NewMail = typeof mails.$inferInsert;
export type MailStatus = Mail['status'];

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ApiKeyStatus = ApiKey['status'];

export type ApiKeyUsageLog = typeof apiKeyUsageLogs.$inferSelect;
export type NewApiKeyUsageLog = typeof apiKeyUsageLogs.$inferInsert;
export type ApiKeyUsageOutcome = ApiKeyUsageLog['outcome'];

export type AuditLog = typeof auditLogs.$inferSelect;
