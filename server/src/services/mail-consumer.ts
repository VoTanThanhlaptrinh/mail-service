import { setTimeout as delay } from 'node:timers/promises';
import type { Consumer, EachMessagePayload, IHeaders } from 'kafkajs';
import { z } from 'zod';
import { env } from '../env.ts';
import { closeConsumer, createConsumer, publish } from '../lib/kafka.ts';
import { deliverMail } from './mailer.ts';

const mailPayloadSchema = z.object({
  to: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  body: z.string().min(1),
});

type MailPayload = z.infer<typeof mailPayloadSchema>;

const DELIVERY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;
const RECONNECT_DELAY_MS = 10_000;

let consumer: Consumer | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let stopping = false;

/**
 * Connects the built-in mail consumer and subscribes to KAFKA_MAIL_TOPIC.
 * A broker outage does not stop the API: startup is retried in the background.
 */
export async function startMailConsumer(): Promise<void> {
  if (!env.KAFKA_CONSUMER_ENABLED) {
    console.log('Kafka mail consumer disabled (KAFKA_CONSUMER_ENABLED=false).');
    return;
  }

  if (consumer) {
    return;
  }

  try {
    await connectConsumer();
  } catch (error) {
    console.error(
      `Kafka mail consumer could not start: ${describeError(error)}. ` +
        `Retrying in ${RECONNECT_DELAY_MS / 1_000}s.`,
    );
    scheduleReconnect();
  }
}

/** Stops consuming and closes the consumer; safe to call when it never started. */
export async function stopMailConsumer(): Promise<void> {
  stopping = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!consumer) {
    return;
  }

  const instance = consumer;
  consumer = null;
  await closeConsumer(instance);
}

async function connectConsumer(): Promise<void> {
  if (stopping) {
    return;
  }

  const instance = await createConsumer(env.KAFKA_CONSUMER_GROUP);

  try {
    await instance.subscribe({ topic: env.KAFKA_MAIL_TOPIC, fromBeginning: false });
  } catch (error) {
    await discardConsumer(instance, 'subscribe failure');
    throw new Error(`Cannot subscribe to Kafka topic "${env.KAFKA_MAIL_TOPIC}".`, { cause: error });
  }

  consumer = instance;

  void instance.run({ eachMessage: handleMailMessage }).catch((error: unknown) => {
    handleConsumerCrash(instance, error);
  });

  console.log(
    `Kafka mail consumer listening on "${env.KAFKA_MAIL_TOPIC}" ` +
      `(group "${env.KAFKA_CONSUMER_GROUP}").`,
  );
}

function handleConsumerCrash(instance: Consumer, error: unknown): void {
  if (stopping) {
    return;
  }

  console.error(`Kafka mail consumer crashed: ${describeError(error)}`);

  if (consumer === instance) {
    consumer = null;
  }

  void discardConsumer(instance, 'consumer crash');
  scheduleReconnect();
}

function scheduleReconnect(): void {
  if (stopping || reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void startMailConsumer();
  }, RECONNECT_DELAY_MS);
  reconnectTimer.unref();
}

async function handleMailMessage(payload: EachMessagePayload): Promise<void> {
  const raw = payload.message.value?.toString('utf8') ?? '';

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    await moveToDeadLetter(payload, `Payload is not valid JSON: ${describeError(error)}`);
    return;
  }

  const parsed = mailPayloadSchema.safeParse(json);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    await moveToDeadLetter(payload, `Payload must be {"to","subject","body"}: ${issues}`);
    return;
  }

  await deliverWithRetry(parsed.data, payload);
}

async function deliverWithRetry(mail: MailPayload, payload: EachMessagePayload): Promise<void> {
  for (let attempt = 1; attempt <= DELIVERY_ATTEMPTS; attempt += 1) {
    try {
      await deliverMail(mail);
      console.log(`Kafka mail delivered to ${mail.to} (${payload.topic})`);
      return;
    } catch (error) {
      if (attempt === DELIVERY_ATTEMPTS) {
        await moveToDeadLetter(
          payload,
          `SMTP delivery failed after ${DELIVERY_ATTEMPTS} attempts: ${describeError(error)}`,
        );
        return;
      }

      await delay(RETRY_DELAY_MS * attempt);
    }
  }
}

async function moveToDeadLetter(payload: EachMessagePayload, reason: string): Promise<void> {
  const headers: IHeaders = {
    'x-original-topic': payload.topic,
    'x-original-partition': String(payload.partition),
    'x-original-offset': payload.message.offset,
    'x-error': reason,
  };

  await publish(env.KAFKA_DLQ_TOPIC, [
    {
      key: payload.message.key,
      value: payload.message.value,
      headers,
    },
  ]);

  console.error(
    `Kafka message ${payload.topic}/${payload.partition}@${payload.message.offset} ` +
      `moved to DLQ "${env.KAFKA_DLQ_TOPIC}": ${reason}`,
  );
}

async function discardConsumer(instance: Consumer, reason: string): Promise<void> {
  try {
    await instance.disconnect();
  } catch (error) {
    console.error(`Kafka consumer disconnect failed after ${reason}: ${describeError(error)}`);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
