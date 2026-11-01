import type { AuditContext } from '../lib/audit.ts';
import type { ApiKey } from '../schema.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the requestContext middleware. */
      auditContext: AuditContext;
      /** Set by optionalApiKey when a valid Bearer key is presented. */
      apiKey?: ApiKey;
    }
  }
}

export {};
