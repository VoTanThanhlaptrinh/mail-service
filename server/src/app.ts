import { existsSync } from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { env } from './env.ts';
import { errorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { healthRouter } from './routes/health.ts';
import { mailsRouter } from './routes/mails.ts';

const CLIENT_DIST = path.resolve(import.meta.dirname, '..', '..', 'client', 'dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cors({ origin: env.corsOrigins }));

  app.use('/api/health', healthRouter);
  app.use('/api/mails', mailsRouter);

  // Serve the built React app (client/dist) when it exists, with SPA fallback.
  if (existsSync(CLIENT_INDEX)) {
    app.use(express.static(CLIENT_DIST));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(CLIENT_INDEX);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
