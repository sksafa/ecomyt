import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { closeRedis } from "./lib/redis.js";
import { closeQueues } from "./jobs/queues.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`Bent & Bound API listening on :${env.PORT} (${env.NODE_ENV})`);
  logger.info(`API docs: ${env.API_PUBLIC_URL}/api/v1/docs`);
});

// Graceful shutdown: stop accepting connections, let in-flight requests finish, then close pools.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => process.exit(1), 15_000).unref();
  server.close(async () => {
    await closeQueues();
    await prisma.$disconnect();
    await closeRedis();
    clearTimeout(force);
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
