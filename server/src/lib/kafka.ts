import fs from 'node:fs';
import path from 'node:path';
import {
  Kafka,
  logLevel,
  type Admin,
  type Consumer,
  type KafkaConfig,
  type Message,
  type Producer,
} from 'kafkajs';
import { env } from '../env.ts';

export type KafkaHealth = 'up' | 'down';

const brokers = env.kafkaBrokers;

if (brokers.length === 0) {
  throw new Error('KAFKA_BROKERS must contain at least one "host:port" entry.');
}

/** SASL is active only when credentials are configured (env.ts validates the pair). */
function buildSasl(): KafkaConfig['sasl'] {
  if (!env.KAFKA_SASL_USERNAME) {
    return undefined;
  }

  const credentials = {
    username: env.KAFKA_SASL_USERNAME,
    password: env.KAFKA_SASL_PASSWORD,
  };

  switch (env.KAFKA_SASL_MECHANISM) {
    case 'plain':
      return { mechanism: 'plain', ...credentials };
    case 'scram-sha-256':
      return { mechanism: 'scram-sha-256', ...credentials };
    case 'scram-sha-512':
      return { mechanism: 'scram-sha-512', ...credentials };
  }
}

const sasl = buildSasl();

/** TLS settings: platform CAs by default, or a custom PEM bundle (Aiven `ca.pem`). */
function buildSsl(): KafkaConfig['ssl'] {
  if (!env.KAFKA_SSL) {
    return false;
  }

  if (!env.KAFKA_SSL_CA) {
    return true;
  }

  const caPath = path.resolve(process.cwd(), env.KAFKA_SSL_CA);

  try {
    return { ca: [fs.readFileSync(caPath, 'utf8')], rejectUnauthorized: true };
  } catch (error) {
    throw new Error(`Cannot read the KAFKA_SSL_CA certificate at "${caPath}".`, { cause: error });
  }
}

const ssl = buildSsl();
const connection = { brokers, ssl, sasl };

/** Connection profile included in error messages to make cloud misconfiguration obvious. */
const connectionProfile = `ssl=${env.KAFKA_SSL}, sasl=${sasl?.mechanism ?? 'none'}`;

/** Shared client: every producer/consumer created here talks to the same cluster. */
export const kafka = new Kafka({
  clientId: env.KAFKA_CLIENT_ID,
  ...connection,
  logLevel: env.NODE_ENV === 'production' ? logLevel.WARN : logLevel.INFO,
  connectionTimeout: 3_000,
  requestTimeout: 30_000,
  retry: { retries: 3, initialRetryTime: 300 },
});

/** Dedicated client for the health probe: fails fast, no retries, no logging. */
const probeClient = new Kafka({
  clientId: `${env.KAFKA_CLIENT_ID}-healthcheck`,
  ...connection,
  logLevel: logLevel.NOTHING,
  connectionTimeout: 2_000,
  retry: { retries: 0 },
});

/** Producer is connected lazily and reused by every publisher. */
let producer: Producer | null = null;
let producerConnection: Promise<Producer> | null = null;

/** Consumers opened through this module; closed together during shutdown. */
const consumers = new Set<Consumer>();

export function getProducer(): Promise<Producer> {
  if (producer) {
    return Promise.resolve(producer);
  }

  producerConnection ??= connectProducer();
  return producerConnection;
}

async function connectProducer(): Promise<Producer> {
  const instance = kafka.producer();

  try {
    await instance.connect();
  } catch (error) {
    producerConnection = null;
    throw new Error(
      `Cannot connect to Kafka brokers [${brokers.join(', ')}] as client "${env.KAFKA_CLIENT_ID}" (${connectionProfile}).`,
      { cause: error },
    );
  }

  producer = instance;
  producerConnection = null;
  return instance;
}

/** Publishes messages to a topic, connecting the shared producer on first use. */
export async function publish(topic: string, messages: Message[]): Promise<void> {
  if (!topic.trim()) {
    throw new Error('Kafka topic must not be empty.');
  }

  if (messages.length === 0) {
    throw new Error(`Refusing to publish an empty batch to Kafka topic "${topic}".`);
  }

  const instance = await getProducer();

  try {
    await instance.send({ topic, messages });
  } catch (error) {
    throw new Error(`Failed to publish ${messages.length} message(s) to Kafka topic "${topic}".`, {
      cause: error,
    });
  }
}

/** Creates and connects a consumer; remember to close it when the work is done. */
export async function createConsumer(groupId: string): Promise<Consumer> {
  if (!groupId.trim()) {
    throw new Error('Kafka consumer groupId must not be empty.');
  }

  const consumer = kafka.consumer({ groupId });

  try {
    await consumer.connect();
  } catch (error) {
    throw new Error(
      `Cannot connect Kafka consumer group "${groupId}" to [${brokers.join(', ')}] (${connectionProfile}).`,
      { cause: error },
    );
  }

  consumers.add(consumer);
  return consumer;
}

/** Disconnects one consumer and stops tracking it. */
export async function closeConsumer(consumer: Consumer): Promise<void> {
  consumers.delete(consumer);
  await consumer.disconnect();
}

/**
 * Closes every Kafka connection opened by this process. Safe to call when nothing
 * was ever connected. Throws an AggregateError when at least one close failed.
 */
export async function disconnectKafka(): Promise<void> {
  const failures: unknown[] = [];
  const pending: Promise<void>[] = [];

  for (const consumer of consumers) {
    consumers.delete(consumer);
    pending.push(collectDisconnectError(consumer, failures));
  }

  if (producer) {
    const instance = producer;
    producer = null;
    producerConnection = null;
    pending.push(collectDisconnectError(instance, failures));
  }

  await Promise.all(pending);

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Failed to disconnect from Kafka cleanly.');
  }
}

async function collectDisconnectError(
  connection: Producer | Consumer,
  failures: unknown[],
): Promise<void> {
  try {
    await connection.disconnect();
  } catch (error) {
    failures.push(error);
  }
}

/** Fast broker probe used by the health endpoint; never throws. */
export async function checkKafka(): Promise<KafkaHealth> {
  const admin: Admin = probeClient.admin();
  let connected = false;
  let status: KafkaHealth = 'down';

  try {
    await admin.connect();
    connected = true;
    await admin.describeCluster();
    status = 'up';
  } catch {
    status = 'down';
  }

  if (connected) {
    try {
      await admin.disconnect();
    } catch {
      // The broker may already be gone: the probe result is what matters here.
    }
  }

  return status;
}
