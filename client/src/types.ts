export type MailStatus = 'QUEUED' | 'SENT' | 'FAILED';

export interface Mail {
  id: string;
  to: string;
  subject: string;
  body: string;
  status: MailStatus;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailListResponse {
  items: Mail[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateMailInput {
  to: string;
  subject: string;
  body: string;
}

export interface Health {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  uptime: number;
  timestamp: string;
}

/* ---------- API keys ---------- */

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';
export type ApiKeyScope = 'mail:send';

export interface ApiKey {
  id: string;
  name: string;
  description: string | null;
  /** Display-only form: msk_test_a1b2c3…9xYz */
  prefix: string;
  status: ApiKeyStatus;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  deletedAt: string | null;
}

export interface ApiKeyListResponse {
  items: ApiKey[];
  total: number;
  limit: number;
  offset: number;
}

/** Returned only by create/rotate — the plaintext secret is shown once. */
export interface CreatedApiKey extends ApiKey {
  key: string;
  keyNotice: string;
}

export interface ApiKeyFormValues {
  name: string;
  description: string | null;
  expiresAt: string | null;
}

/* ---------- Usage ledger ---------- */

export type UsageOutcome = 'SUCCESS' | 'FAILED' | 'REJECTED';

export interface UsageLog {
  id: string;
  apiKeyId: string;
  apiKeyName: string | null;
  apiKeyPrefix: string | null;
  mailId: string | null;
  action: string;
  outcome: UsageOutcome;
  httpMethod: string;
  path: string;
  statusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageLogListResponse {
  items: UsageLog[];
  total: number;
  limit: number;
  offset: number;
}

/* ---------- Audit trail ---------- */

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'REVOKE' | 'ROTATE';

export interface AuditLog {
  id: number;
  occurredAt: string;
  entity: string;
  entityId: string;
  action: AuditAction;
  actor: string;
  changes: Record<string, unknown>;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface AuditLogListResponse {
  items: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}
