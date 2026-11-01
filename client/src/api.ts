import type { CreateMailInput, Health, Mail, MailListResponse, MailStatus } from './types';

const BASE = '/api';

interface ApiErrorBody {
  error?: string;
  issues?: { path: string; message: string }[];
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

export const api = {
  health: () => request<Health>('/health'),

  listMails(params: { status?: MailStatus; search?: string } = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.search) query.set('search', params.search);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request<MailListResponse>(`/mails${suffix}`);
  },

  createMail(input: CreateMailInput) {
    return request<Mail>('/mails', { method: 'POST', body: JSON.stringify(input) });
  },

  sendMail(id: string) {
    return request<Mail>(`/mails/${id}/send`, { method: 'POST' });
  },

  deleteMail(id: string) {
    return request<void>(`/mails/${id}`, { method: 'DELETE' });
  },
};
