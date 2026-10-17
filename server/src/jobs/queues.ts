import { Queue, type JobsOptions } from "bullmq";
import { env, isTest } from "../config/env.js";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

/** Queue names. Workers live in src/worker.ts (separate process). */
export const QUEUES = {
  courier: "courier", // shipment booking retries, status polling
  webhooks: "webhooks", // courier webhook processing
  notifications: "notifications", // email / sms / whatsapp delivery
  marketing: "marketing", // Meta Conversions API events
  scheduled: "scheduled", // daily summaries, low-stock scans, COD reminders
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const queues = new Map<QueueName, Queue>();

export const queuesEnabled = () => env.QUEUES_ENABLED && !isTest;

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 3600, count: 5000 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a job. jobId makes enqueueing idempotent (same id = same job).
 * When queues are disabled (tests) the job is skipped and the caller's synchronous path is used.
 */
export async function enqueue(name: QueueName, jobName: string, data: unknown, opts: JobsOptions = {}) {
  if (!queuesEnabled()) return null;
  try {
    return await getQueue(name).add(jobName, data, opts);
  } catch (err) {
    logger.error({ err, name, jobName }, "failed to enqueue job");
    return null;
  }
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => {})));
  queues.clear();
}
