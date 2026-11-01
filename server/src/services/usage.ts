import { eq } from 'drizzle-orm';
import { db } from '../db.ts';
import { apiKeyUsageLogs, apiKeys, type ApiKeyUsageOutcome } from '../schema.ts';

export interface UsageRecordInput {
  apiKeyId: string;
  mailId?: string | null;
  outcome: ApiKeyUsageOutcome;
  httpMethod: string;
  path: string;
  statusCode?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

function clampText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.slice(0, maxLength);
}

/**
 * Appends one row to the usage ledger and refreshes api_keys.last_used_at.
 *
 * Usage history must never break the email call itself, so failures are only
 * logged to stderr (the append-only trigger and NOT NULL constraints make a
 * silent failure visible in operations).
 */
export async function recordUsage(input: UsageRecordInput): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(apiKeyUsageLogs).values({
        apiKeyId: input.apiKeyId,
        mailId: input.mailId ?? null,
        action: 'mail.send',
        outcome: input.outcome,
        httpMethod: input.httpMethod,
        path: clampText(input.path, 2000) ?? '/',
        statusCode: input.statusCode ?? null,
        errorCode: clampText(input.errorCode, 120),
        errorMessage: clampText(input.errorMessage, 2000),
        durationMs: input.durationMs ?? null,
        requestId: clampText(input.requestId, 128),
        ipAddress: input.ip ?? null,
        userAgent: clampText(input.userAgent, 500),
        metadata: input.metadata ?? {},
      });

      await tx
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, input.apiKeyId));
    });
  } catch (error) {
    console.error('[usage] failed to record API key usage:', error);
  }
}
