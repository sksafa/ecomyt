// Background worker process (BullMQ): `npm run worker` / `npm run worker:dev`.
// Runs separately from the API. Job handlers are plain exported functions (see src/jobs/scheduled.ts,
// modules/*), so the same code runs here and in tests.
import { Worker, type Job } from "bullmq";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis, getRedis } from "./lib/redis.js";
import { closeQueues, QUEUES } from "./jobs/queues.js";
import { registerSchedules } from "./jobs/schedules.js";
import { codSettlementReminderJob, courierSyncJob, dailySummaryJob, lowStockScanJob, pruneMetaEventLogsJob } from "./jobs/scheduled.js";
import { retryBookingJob } from "./modules/couriers/shipments.service.js";
import { processMetaEventJob, type MetaSendJob } from "./modules/marketing/meta-capi.js";
import { deliverNotification, type DeliverJobData } from "./modules/notifications/outbound.service.js";

type Handler = (job: Job) => Promise<unknown>;

const handlers: Record<string, Record<string, Handler>> = {
  [QUEUES.courier]: {
    "retry-booking": (job) => retryBookingJob(job.data as { shipmentId: string; reference: string }),
    "sync-active": () => courierSyncJob(),
  },
  [QUEUES.marketing]: {
    "capi-event": (job) => processMetaEventJob(job.data as MetaSendJob),
  },
  [QUEUES.notifications]: {
    deliver: (job) => deliverNotification(job.data as DeliverJobData),
  },
  [QUEUES.scheduled]: {
    "daily-summary": (job) => dailySummaryJob(job.data as { date?: string }),
    "low-stock-scan": () => lowStockScanJob(),
    "meta-log-prune": () => pruneMetaEventLogsJob(),
    "cod-settlement-reminder": () => codSettlementReminderJob(),
  },
};

const CONCURRENCY: Record<string, number> = { [QUEUES.courier]: 2, [QUEUES.marketing]: 4, [QUEUES.notifications]: 4, [QUEUES.scheduled]: 1 };

export async function startWorker() {
  if (!env.QUEUES_ENABLED) {
    logger.warn("QUEUES_ENABLED=false – the worker has nothing to do; exiting");
    return null;
  }
  const connection = getRedis();
  const workers = Object.entries(handlers).map(([queue, byName]) => {
    const w = new Worker(
      queue,
      async (job) => {
        const fn = byName[job.name];
        if (!fn) throw new Error(`No handler for ${queue}/${job.name}`);
        const started = Date.now();
        const result = await fn(job);
        logger.info({ queue, job: job.name, id: job.id, ms: Date.now() - started }, "job done");
        return result ?? null;
      },
      { connection, concurrency: CONCURRENCY[queue] ?? 1 },
    );
    w.on("failed", (job, err) => logger.error({ queue, job: job?.name, id: job?.id, attempt: job?.attemptsMade, err: err.message }, "job failed"));
    w.on("error", (err) => logger.error({ queue, err: err.message }, "worker error"));
    return w;
  });

  try {
    const ids = await registerSchedules();
    logger.info({ schedules: ids }, "job schedulers registered");
  } catch (err) {
    logger.error({ err: (err as Error).message }, "failed to register job schedulers");
  }
  logger.info({ queues: Object.keys(handlers) }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "worker shutting down");
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect().catch(() => {});
    await closeRedis();
    logger.info("worker stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  return workers;
}

await startWorker();
