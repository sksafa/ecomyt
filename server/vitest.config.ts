import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile();
} catch {
  // CI provides env directly
}

const testDb = process.env.TEST_DATABASE_URL;
if (!testDb) throw new Error("TEST_DATABASE_URL must be set to run tests (never point it at a real database)");

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // one shared database → run files sequentially
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDb,
      QUEUES_ENABLED: "false",
      LOG_LEVEL: "silent",
    },
  },
});
