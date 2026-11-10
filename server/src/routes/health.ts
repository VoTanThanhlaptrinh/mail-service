import { Router } from 'express';
import { client } from '../db.ts';
import { checkKafka, type KafkaHealth } from '../lib/kafka.ts';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  let database: 'up' | 'down' = 'up';
  try {
    await client.execute('SELECT 1');
  } catch {
    database = 'down';
  }

  let kafka: KafkaHealth = 'down';
  try {
    kafka = await checkKafka();
  } catch {
    kafka = 'down';
  }

  // The database is what this API cannot serve without, so it alone decides the HTTP
  // status. Kafka is a downstream event bus: report its state without failing the probe.
  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' && kafka === 'up' ? 'ok' : 'degraded',
    database,
    kafka,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
