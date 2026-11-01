import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { db } from '../db.ts';
import { hashApiKey, isApiKeyFormat } from '../lib/api-keys.ts';
import { recordUsage } from '../services/usage.ts';
import { apiKeys, type ApiKey } from '../schema.ts';
import { HttpError } from './error-handler.ts';

const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

interface KeyRejection {
  code: string;
  message: string;
}

function rejectionReason(apiKey: ApiKey): KeyRejection | null {
  if (apiKey.status === 'REVOKED') {
    return { code: 'API_KEY_REVOKED', message: 'API key has been revoked' };
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
    return { code: 'API_KEY_EXPIRED', message: 'API key has expired' };
  }
  return null;
}

/**
 * Authenticates a Bearer API key when the Authorization header is present.
 *
 * The header is optional so the admin UI keeps working without keys; whenever
 * a key is presented the call is authenticated and recorded in
 * api_key_usage_logs (SUCCESS from the route, REJECTED here for revoked or
 * expired keys). Requests without the header continue as internal calls.
 */
export const optionalApiKey: RequestHandler = async (req, _res, next) => {
  const header = req.header('authorization');
  if (!header) {
    next();
    return;
  }

  try {
    const match = BEARER_PATTERN.exec(header.trim());
    if (!match) {
      throw new HttpError(401, 'Authorization header must be "Bearer <api-key>"');
    }

    const token = match[1];
    if (!isApiKeyFormat(token)) {
      throw new HttpError(401, 'Invalid API key');
    }

    const [apiKey] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hashApiKey(token)), isNull(apiKeys.deletedAt)));

    if (!apiKey) {
      throw new HttpError(401, 'Invalid API key');
    }

    const rejection = rejectionReason(apiKey);
    if (rejection) {
      await recordUsage({
        apiKeyId: apiKey.id,
        outcome: 'REJECTED',
        httpMethod: req.method,
        path: req.originalUrl,
        statusCode: 401,
        errorCode: rejection.code,
        errorMessage: rejection.message,
        requestId: req.auditContext?.requestId ?? null,
        ip: req.auditContext?.ip ?? null,
        userAgent: req.auditContext?.userAgent ?? null,
      });
      throw new HttpError(401, rejection.message);
    }

    req.apiKey = apiKey;
    next();
  } catch (error) {
    next(error);
  }
};
