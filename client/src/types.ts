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
