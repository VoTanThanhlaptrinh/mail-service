import { createHash, randomBytes } from 'node:crypto';
import { env } from '../env.ts';

const PREFIX = 'msk';
const SECRET_BYTES = 32;
const KEY_PATTERN = /^msk_(live|test)_[A-Za-z0-9_-]{43}$/;

export interface GeneratedApiKey {
  /** Plaintext key — returned to the caller once and never stored. */
  key: string;
  /** SHA-256 hex digest stored in api_keys.key_hash. */
  keyHash: string;
  /** Recognisable prefix, e.g. msk_test_a1b2c3 (safe to display). */
  keyPrefix: string;
  keyLast4: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Creates a new high-entropy key: msk_<live|test>_<43 url-safe chars>. */
export function generateApiKey(): GeneratedApiKey {
  const scope = env.NODE_ENV === 'production' ? 'live' : 'test';
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const key = PREFIX + '_' + scope + '_' + secret;

  return {
    key,
    keyHash: hashApiKey(key),
    keyPrefix: PREFIX + '_' + scope + '_' + secret.slice(0, 6),
    keyLast4: secret.slice(-4),
  };
}

/** Cheap shape check before touching the database. */
export function isApiKeyFormat(value: string): boolean {
  return KEY_PATTERN.test(value);
}

/** Display form used by the API: msk_test_a1b2c3…9xYz. */
export function formatApiKeyPrefix(keyPrefix: string, keyLast4: string): string {
  return keyPrefix + '\u2026' + keyLast4;
}
