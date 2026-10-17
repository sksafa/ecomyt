// Compiled entry point for the reference-data + bootstrap-admin seed (usable inside the production image):
//   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… node dist/seed/cli.js
import { prisma } from "../lib/prisma.js";
import { seedAdmin, seedBase } from "./base.js";

await seedBase(prisma, { isProduction: process.env.NODE_ENV === "production" });
const admin = await seedAdmin(prisma, {
  email: process.env.SEED_ADMIN_EMAIL,
  password: process.env.SEED_ADMIN_PASSWORD,
  name: process.env.SEED_ADMIN_NAME,
});
console.log("Reference data ready.", admin.reason);
await prisma.$disconnect();
