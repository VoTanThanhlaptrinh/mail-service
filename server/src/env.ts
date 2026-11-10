import 'dotenv/config';
import { z } from 'zod';

/** Accepts the strings "true"/"false" (any case) and yields a boolean. */
const booleanFlag = (fallback: 'true' | 'false' = 'false') =>
  z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
      z.enum(['true', 'false']).default(fallback),
    )
    .transform((val) => val === 'true');

const schema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .default('./data/mail.db'),
  /**
   * Turso / libSQL connection. When TURSO_DATABASE_URL is set it takes priority over
   * DATABASE_URL (which stays available for a local SQLite file in dev / Docker).
   */
  TURSO_DATABASE_URL: z.string().trim().default(''),
  TURSO_AUTH_TOKEN: z.string().trim().default(''),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SMTP_HOST: z.string().trim().min(1).default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .preprocess(
      (val) => (typeof val === 'string' ? val.trim().toLowerCase() : val),
      z.enum(['true', 'false']).default('false'),
    )
    .transform((val) => val === 'true'),
  SMTP_USER: z.string().trim().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().trim().min(1).default('Mail Service <no-reply@example.com>'),
  /**
   * Kafka event bus. KAFKA_BROKERS is a comma separated `host:port` list; the
   * default targets a local broker in PLAINTEXT mode (no authentication).
   */
  KAFKA_BROKERS: z.string().trim().min(1).default('localhost:9092'),
  KAFKA_CLIENT_ID: z.string().trim().min(1).default('mail-service'),
  /** TLS for the broker connection. Cloud providers (Aiven, Confluent) require it. */
  KAFKA_SSL: booleanFlag(),
  /**
   * Optional path to a PEM CA certificate when the broker uses a private CA
   * (Aiven `ca.pem`). Required only if the broker certificate is not publicly trusted.
   */
  KAFKA_SSL_CA: z.string().trim().default(''),
  /** SASL mechanism; only used when KAFKA_SASL_USERNAME/PASSWORD are set. */
  KAFKA_SASL_MECHANISM: z
    .enum(['plain', 'scram-sha-256', 'scram-sha-512'])
    .default('scram-sha-512'),
  KAFKA_SASL_USERNAME: z.string().trim().default(''),
  KAFKA_SASL_PASSWORD: z.string().default(''),
  /**
   * Built-in mail consumer: reads `{ to, subject, body }` JSON from KAFKA_MAIL_TOPIC,
   * sends it through SMTP, and forwards failed messages to KAFKA_DLQ_TOPIC.
   */
  KAFKA_CONSUMER_ENABLED: booleanFlag('true'),
  KAFKA_CONSUMER_GROUP: z.string().trim().min(1).default('mail-service'),
  KAFKA_MAIL_TOPIC: z.string().trim().min(1).default('mail.send'),
  KAFKA_DLQ_TOPIC: z.string().trim().min(1).default('mail.send.dlq'),
})
  .superRefine((value, ctx) => {
    if (value.KAFKA_SSL_CA && !value.KAFKA_SSL) {
      ctx.addIssue({
        code: 'custom',
        path: ['KAFKA_SSL_CA'],
        message: 'KAFKA_SSL_CA requires KAFKA_SSL=true.',
      });
    }

    const hasUsername = value.KAFKA_SASL_USERNAME.length > 0;
    const hasPassword = value.KAFKA_SASL_PASSWORD.length > 0;

    if (hasUsername === hasPassword) {
      return;
    }

    ctx.addIssue({
      code: 'custom',
      path: ['KAFKA_SASL_USERNAME'],
      message:
        'Set both KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD, or leave both empty for a PLAINTEXT broker.',
    });
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.') || '(env)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = {
  ...parsed.data,
  /** True when running as a Vercel serverless function (no persistent local disk). */
  IS_SERVERLESS: Boolean(process.env.VERCEL),
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((value) => value.trim()),
  kafkaBrokers: parsed.data.KAFKA_BROKERS.split(',')
    .map((value) => value.trim())
    .filter(Boolean),
};
