import { getQueue, QUEUES, type QueueName } from "./queues.js";
import { BUSINESS_TZ } from "../lib/time.js";

/** Repeatable jobs (BullMQ job schedulers – upserted on every worker start, so never duplicated). */
export const SCHEDULES: { id: string; queue: QueueName; name: string; repeat: { pattern?: string; every?: number; tz?: string } }[] = [
  { id: "daily-summary", queue: QUEUES.scheduled, name: "daily-summary", repeat: { pattern: "0 21 * * *", tz: BUSINESS_TZ } },
  { id: "low-stock-scan", queue: QUEUES.scheduled, name: "low-stock-scan", repeat: { pattern: "0 9 * * *", tz: BUSINESS_TZ } },
  { id: "cod-settlement-reminder", queue: QUEUES.scheduled, name: "cod-settlement-reminder", repeat: { pattern: "0 10 * * *", tz: BUSINESS_TZ } },
  { id: "courier-sync", queue: QUEUES.courier, name: "sync-active", repeat: { every: 30 * 60 * 1000 } },
];

export async function registerSchedules() {
  for (const s of SCHEDULES) {
    await getQueue(s.queue).upsertJobScheduler(s.id, s.repeat, { name: s.name, data: {}, opts: { attempts: 2, backoff: { type: "exponential", delay: 60_000 } } });
  }
  return SCHEDULES.map((s) => s.id);
}
