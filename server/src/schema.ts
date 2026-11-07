import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const mails = sqliteTable(
  'mails',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status', { enum: ['QUEUED', 'SENT', 'FAILED'] }).notNull().default('QUEUED'),
    error: text('error'),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
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
 * `audit_logs`.
 */
export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    description: text('description'),
    keyPrefix: text('key_prefix').notNull(),
    keyLast4: text('key_last4').notNull(),
    keyHash: text('key_hash').notNull(),
    status: text('status', { enum: ['ACTIVE', 'REVOKED'] }).notNull().default('ACTIVE'),
    scopes: text('scopes', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => ['mail:send']),
    expiresAt: integer('expires_at', { mode: 'timestamp' }),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    revokedReason: text('revoked_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    createdBy: text('created_by').notNull().default('system'),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedBy: text('updated_by').notNull().default('system'),
    deletedAt: integer('deleted_at', { mode: 'timestamp' }),
  },
  (table) => [
    uniqueIndex('api_keys_key_hash_key').on(table.keyHash),
    index('api_keys_status_created_idx').on(table.status, table.createdAt),
    index('api_keys_created_at_idx').on(table.createdAt),
  ],
);

/**
 * Append-only ledger of email calls made with an API key.
 *
 * One row per call: action (`mail.send`), outcome, HTTP result, duration and
 * request metadata.
 */
export const apiKeyUsageLogs = sqliteTable(
  'api_key_usage_logs',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    apiKeyId: text('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'restrict' }),
    mailId: text('mail_id').references(() => mails.id, { onDelete: 'set null' }),
    action: text('action').notNull().default('mail.send'),
    outcome: text('outcome', { enum: ['SUCCESS', 'FAILED', 'REJECTED'] }).notNull(),
    httpMethod: text('http_method').notNull(),
    path: text('path').notNull(),
    statusCode: integer('status_code'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadata: text('metadata', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('api_key_usage_logs_key_created_idx').on(table.apiKeyId, table.createdAt),
    index('api_key_usage_logs_mail_idx').on(table.mailId),
    index('api_key_usage_logs_created_at_idx').on(table.createdAt),
    index('api_key_usage_logs_outcome_idx').on(table.outcome, table.createdAt),
  ],
);

export interface AuditChanges {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  key_rotated?: boolean;
}

/**
 * Append-only audit trail.
 * `entity` + `entityId` point at the audited row; `changes` holds the
 * before/after snapshots (secret hashes are stripped).
 */
export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    occurredAt: integer('occurred_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull().default('system'),
    changes: text('changes', { mode: 'json' })
      .$type<AuditChanges>()
      .notNull()
      .$defaultFn(() => ({})),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.entity, table.entityId, table.occurredAt),
    index('audit_logs_occurred_at_idx').on(table.occurredAt),
    index('audit_logs_actor_idx').on(table.actor, table.occurredAt),
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
