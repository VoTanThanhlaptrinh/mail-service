import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_ACTOR_LENGTH = 120;
const MAX_USER_AGENT_LENGTH = 500;

function cleanHeader(value: string | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Normalises IPv4-mapped IPv6 addresses so they fit the inet column. */
export function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const ip = value.startsWith('::ffff:') ? value.slice(7) : value;
  return ip.length <= 64 ? ip : null;
}

/**
 * Assigns a request id and the audit identity for this request.
 *
 * Until real authentication exists, the caller may identify itself with the
 * X-Actor header; the value is recorded as-is in audit_logs and api_keys
 * created_by/updated_by. Every response echoes X-Request-Id so a call can be
 * correlated with its usage/audit rows.
 */
export const requestContext: RequestHandler = (req, res, next) => {
  const incomingId = req.header('x-request-id')?.trim();
  const requestId =
    incomingId && REQUEST_ID_PATTERN.test(incomingId) ? incomingId : randomUUID();

  req.auditContext = {
    actor: cleanHeader(req.header('x-actor'), MAX_ACTOR_LENGTH) ?? 'system',
    requestId,
    ip: normalizeIp(req.ip ?? req.socket.remoteAddress),
    userAgent: cleanHeader(req.header('user-agent'), MAX_USER_AGENT_LENGTH),
  };

  res.setHeader('X-Request-Id', requestId);
  next();
};
