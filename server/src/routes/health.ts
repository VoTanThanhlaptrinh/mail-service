import { Router } from 'express';
import { sqlite } from '../db.ts';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  let database: 'up' | 'down' = 'up';
  try {
    sqlite.prepare('SELECT 1').get();
  } catch {
    database = 'down';
  }

  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    database,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
