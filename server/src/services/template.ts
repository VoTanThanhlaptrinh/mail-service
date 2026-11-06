import { HttpError } from '../middleware/error-handler.ts';

export interface BulkRecipientInput {
  to: string;
  variables?: Record<string, string>;
}

export interface BulkRenderInput {
  subject: string;
  body: string;
  recipients: BulkRecipientInput[];
}

export interface RenderedMailItem {
  to: string;
  subject: string;
  body: string;
}

/**
 * Extracts unique variable names from a template string in order of appearance.
 */
export function extractTemplateVariables(template: string): string[] {
  if (!template) return [];

  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  const matches = template.matchAll(regex);
  const vars: string[] = [];

  for (const match of matches) {
    const key = match[1];
    if (key && !vars.includes(key)) {
      vars.push(key);
    }
  }

  return vars;
}

/**
 * Renders a template string by replacing {{key}} with variables[key].trim().
 */
export function renderTemplate(template: string, variables: Record<string, string> = {}): string {
  if (!template) return '';

  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  return template.replace(regex, (_, key: string) => {
    const val = variables[key];
    if (val === undefined || val === null) return '';
    return val.trim();
  });
}

/**
 * Validates and renders template for each recipient in a bulk mail request.
 * Throws HttpError(400) if any recipient is missing required variables.
 */
export function renderRecipientMails(input: BulkRenderInput): RenderedMailItem[] {
  const subjectVars = extractTemplateVariables(input.subject);
  const bodyVars = extractTemplateVariables(input.body);
  const requiredVars = Array.from(new Set([...subjectVars, ...bodyVars]));

  for (let index = 0; index < input.recipients.length; index++) {
    const recipient = input.recipients[index];
    const vars = recipient.variables ?? {};
    const missing: string[] = [];

    for (const key of requiredVars) {
      const val = vars[key];
      if (val === undefined || val === null || typeof val !== 'string' || val.trim() === '') {
        missing.push(key);
      }
    }

    if (missing.length > 0) {
      throw new HttpError(
        400,
        `Recipient ${recipient.to} (index ${index}) is missing template variables: ${missing.join(', ')}`,
        { index, to: recipient.to, missingVariables: missing },
      );
    }
  }

  return input.recipients.map((recipient) => ({
    to: recipient.to,
    subject: renderTemplate(input.subject, recipient.variables),
    body: renderTemplate(input.body, recipient.variables),
  }));
}
