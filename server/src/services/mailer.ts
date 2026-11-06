import nodemailer from 'nodemailer';
import { env } from '../env.ts';
import { HttpError } from '../middleware/error-handler.ts';

export class MailDeliveryError extends HttpError {
  constructor(message: string, cause?: unknown) {
    super(502, message);
    this.name = 'MailDeliveryError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export interface DeliverMailInput {
  to: string;
  subject: string;
  body: string;
}

export function createTransporter(): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER.length > 0
      ? {
          auth: {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS,
          },
        }
      : {}),
  });
}

export const transporter = createTransporter();

export async function deliverMail(
  input: DeliverMailInput,
  mailerTransporter: nodemailer.Transporter = transporter,
): Promise<{ messageId: string }> {
  if (!input.to || !input.to.trim()) {
    throw new HttpError(400, 'Recipient email (to) is required');
  }

  if (!input.subject || !input.subject.trim()) {
    throw new HttpError(400, 'Subject is required');
  }

  if (!input.body || !input.body.trim()) {
    throw new HttpError(400, 'Body is required');
  }

  try {
    const info = await mailerTransporter.sendMail({
      from: env.SMTP_FROM,
      to: input.to.trim(),
      subject: input.subject.trim(),
      text: input.body,
    });

    return { messageId: info.messageId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown SMTP error';
    throw new MailDeliveryError(`Failed to deliver email via SMTP: ${reason}`, error);
  }
}
