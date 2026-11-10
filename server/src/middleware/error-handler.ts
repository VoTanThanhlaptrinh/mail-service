import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }

  const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null;
  const errCode = typeof errObj?.code === 'string' ? errObj.code : '';
  const errMsg = typeof errObj?.message === 'string' ? errObj.message : '';

  if (errCode === 'SQLITE_CONSTRAINT' || errMsg.includes('SQLITE_CONSTRAINT')) {
    res.status(409).json({ error: 'Database constraint violation' });
    return;
  }

  const errType = typeof errObj?.type === 'string' ? errObj.type : '';
  const statusCandidate = Number(errObj?.status ?? errObj?.statusCode);
  const is4xxStatus = Number.isInteger(statusCandidate) && statusCandidate >= 400 && statusCandidate <= 499;

  if (errType === 'entity.parse.failed' || errType === 'entity.too.large' || is4xxStatus) {
    const status = errType === 'entity.parse.failed' ? 400 : errType === 'entity.too.large' ? 413 : statusCandidate;
    const message = errMsg || (status === 413 ? 'Payload too large' : 'Invalid request payload');
    res.status(status).json({ error: message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
