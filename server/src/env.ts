import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .default('./data/mail.db'),
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
  corsOrigins: parsed.data.CORS_ORIGIN.split(',').map((value) => value.trim()),
};
