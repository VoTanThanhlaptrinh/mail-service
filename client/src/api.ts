import type {
  ApiKey,
  ApiKeyListResponse,
  ApiKeyStatus,
  AuditAction,
  AuditLogListResponse,
  BulkCreateMailInput,
  BulkMailResponse,
  CreateMailInput,
  CreatedApiKey,
  Health,
  Mail,
  MailListResponse,
  MailStatus,
  UsageLogListResponse,
  UsageOutcome,
} from './types';

const BASE = '/api';

interface ApiErrorBody {
  error?: string;
  issues?: { path: string; message: string }[];
}

type QueryValue = string | number | boolean | null | undefined;

function withQuery(path: string, params: Record<string, QueryValue> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  return query.size > 0 ? `${path}?${query.toString()}` : path;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const details = payload?.issues?.map((issue) => `${issue.path}: ${issue.message}`).join(' · ');
    throw new Error(details || payload?.error || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function jsonBody(value: unknown): RequestInit {
  return { method: 'POST', body: JSON.stringify(value) };
}

export const api = {
  health: () => request<Health>('/health'),

  listMails(params: { status?: MailStatus; search?: string } = {}) {
    return request<MailListResponse>(withQuery('/mails', params));
  },

  createMail(input: CreateMailInput) {
    return request<Mail>('/mails', { method: 'POST', body: JSON.stringify(input) });
  },

  createBulkMail(input: BulkCreateMailInput) {
    return request<BulkMailResponse>('/mails/bulk', { method: 'POST', body: JSON.stringify(input) });
  },

  sendMail(id: string) {
    return request<Mail>(`/mails/${id}/send`, { method: 'POST' });
  },

  deleteMail(id: string) {
    return request<void>(`/mails/${id}`, { method: 'DELETE' });
  },

  /* ---------- API keys ---------- */

  listApiKeys(
    params: { status?: ApiKeyStatus; search?: string; limit?: number; offset?: number } = {},
  ) {
    return request<ApiKeyListResponse>(withQuery('/api-keys', params));
  },

  createApiKey(input: { name: string; description?: string | null; expiresAt?: string | null }) {
    return request<CreatedApiKey>('/api-keys', jsonBody({ ...input, scopes: ['mail:send'] }));
  },

  updateApiKey(
    id: string,
    input: {
      name?: string;
      description?: string | null;
      expiresAt?: string | null;
      scopes?: string[];
    },
  ) {
    return request<ApiKey>(`/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  rotateApiKey(id: string) {
    return request<CreatedApiKey>(`/api-keys/${id}/rotate`, { method: 'POST' });
  },

  revokeApiKey(id: string, reason?: string) {
    return request<ApiKey>(`/api-keys/${id}/revoke`, jsonBody({ reason: reason || undefined }));
  },

  deleteApiKey(id: string) {
    return request<void>(`/api-keys/${id}`, { method: 'DELETE' });
  },

  listApiKeyUsage(
    id: string,
    params: { outcome?: UsageOutcome; limit?: number; offset?: number } = {},
  ) {
    return request<UsageLogListResponse>(withQuery(`/api-keys/${id}/usage`, params));
  },

  listAuditLogs(
    params: {
      entity?: string;
      entityId?: string;
      action?: AuditAction;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    return request<AuditLogListResponse>(withQuery('/audit-logs', params));
  },
};
