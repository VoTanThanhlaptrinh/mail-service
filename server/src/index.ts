import { createApp } from './app.ts';
import { closeDb } from './db.ts';
import { env } from './env.ts';
import { disconnectKafka } from './lib/kafka.ts';
import { startMailConsumer, stopMailConsumer } from './services/mail-consumer.ts';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  void startMailConsumer();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received — shutting down`);
  server.close(async () => {
    try {
      await stopMailConsumer();
    } catch (error) {
      console.error('Kafka mail consumer did not stop cleanly:', error);
    }
    try {
      await disconnectKafka();
    } catch (error) {
      console.error('Kafka connections did not close cleanly:', error);
    }
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
