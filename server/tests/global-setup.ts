import { execSync } from "node:child_process";

/** Migrate the test database, wipe every table, and load reference data once per run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL!;
  if (!/_test\b|test/i.test(url)) throw new Error(`Refusing to run tests against a non-test database: ${url}`);
  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: "test" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = "test";
  const { prisma } = await import("../src/lib/prisma.js");
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  const { seedBase } = await import("../src/seed/base.js");
  await seedBase(prisma, { isProduction: false });
  await prisma.$disconnect();
}
