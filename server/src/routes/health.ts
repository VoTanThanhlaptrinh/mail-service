import { Router } from 'express';
import { client } from '../db.ts';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  let database: 'up' | 'down' = 'up';
  try {
    await client.execute('SELECT 1');
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
