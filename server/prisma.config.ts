import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically
try {
  process.loadEnvFile();
} catch {
  // rely on the real environment (CI / production)
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
