import { Router } from "express";
import type { Module } from "../http/route.js";
import { authModule } from "./auth/auth.routes.js";
import { auditModule, rolesModule, usersModule } from "./users/users.routes.js";
import { categoriesModule, collectionsModule, productsModule } from "./products/products.routes.js";
import { inventoryModule } from "./inventory/inventory.routes.js";
import { customersModule } from "./customers/customers.routes.js";
import { ordersModule } from "./orders/orders.routes.js";
import { shippingModule } from "./shipping/shipping.routes.js";
import { uploadsModule } from "./uploads/uploads.routes.js";
import { couriersModule, webhooksModule } from "./couriers/couriers.routes.js";
import { paymentsModule, refundsModule } from "./payments/payments.routes.js";
import { returnsModule } from "./returns/returns.routes.js";
import { financeModule } from "./finance/finance.routes.js";
import { dashboardModule, reportsModule } from "./dashboard/dashboard.routes.js";
import { marketingModule } from "./marketing/marketing.routes.js";
import { notificationsModule } from "./notifications/notifications.routes.js";
import { materialsModule, purchaseOrdersModule, suppliersModule } from "./purchasing/purchasing.routes.js";
import { cmsModule } from "./cms/cms.routes.js";
import { storefrontModule } from "./storefront/storefront.routes.js";
import { savedFiltersModule, searchModule, settingsModule } from "./settings/settings.routes.js";

/** Every feature module, mounted at its own base path under /api/v1. */
const all: Module[] = [
  authModule, usersModule, rolesModule, auditModule,
  productsModule, categoriesModule, collectionsModule, inventoryModule,
  customersModule, ordersModule, shippingModule, uploadsModule,
  couriersModule, webhooksModule, paymentsModule, refundsModule, returnsModule, financeModule,
  dashboardModule, reportsModule, marketingModule, notificationsModule,
  suppliersModule, purchaseOrdersModule, materialsModule, cmsModule, storefrontModule,
  settingsModule, searchModule, savedFiltersModule,
];

export const modules = all.map((m) => {
  const router = Router();
  router.use(m.basePath, m.router);
  return { router };
});
