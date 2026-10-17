# Architecture

```
                ┌──────────────────────── browser ────────────────────────┐
                │  /            public storefront (Next.js, mobile-first) │
                │  /admin/*     management console (Next.js)              │
                └───────────────┬─────────────────────────────────────────┘
                                │ same origin: /api/* and /uploads/* are proxied by Next.js
                ┌───────────────▼───────────────┐        ┌──────────────────────────┐
                │ server (Express 5, TypeScript)│◀──────▶│ PostgreSQL 16 (Prisma 7)  │
                │  REST /api/v1, OpenAPI docs   │        └──────────────────────────┘
                │  sessions, RBAC, validation   │        ┌──────────────────────────┐
                │  domain services              │◀──────▶│ Redis 7                   │
                └───────────────┬───────────────┘        │ rate limits + BullMQ      │
                                │ enqueue                └────────────┬─────────────┘
                ┌───────────────▼───────────────┐                     │
                │ worker (same codebase)        │◀────────────────────┘
                │  courier retries & polling,   │──▶ couriers (Steadfast, Pathao, RedX, eCourier)
                │  Meta CAPI, notifications,    │──▶ Meta Conversions API, SMTP, WhatsApp Cloud API
                │  scheduled summaries/alerts   │
                └───────────────────────────────┘
```

| Folder | Contents |
|---|---|
| `client/` | Next.js 16 App Router, React 19, TypeScript, Tailwind 4, shadcn/ui, TanStack Query, React Hook Form + Zod, Recharts |
| `client/src/app/admin/(panel)` | Admin console pages (orders, customers, catalog, inventory, purchasing, shipping, returns, finance, marketing, reports, content, staff, audit, settings) |
| `client/src/app/(store)` | Public storefront (home, shop, product, cart, checkout, order status, CMS pages) |
| `server/` | Express 5 + TypeScript API, Prisma 7, BullMQ worker |
| `server/src/modules/<module>` | One folder per business module: `*.routes.ts` (HTTP + validation + permissions), `*.service.ts` (business rules) |
| `server/src/http/route.ts` | `createModule().route({...})`: every endpoint declares access (permission), Zod schemas and idempotency in one place; the same definition drives validation, permission enforcement and the OpenAPI document |
| `server/prisma` | Schema, migrations (incl. hand-written SQL for check constraints, partial unique index, trigram indexes, sequences), seed scripts |
| `docs/` | This documentation |

## Key design decisions

**Single source of truth for business rules on the server.** The client only renders; prices, delivery charges, stock, risk, status transitions and money are computed and enforced in services. Permissions are checked on every request (`route({ access })`), never only in the UI.

**Order state machine** (`server/src/modules/orders/order-status.ts`). Allowed transitions are explicit; transitions that belong to a workflow (courier booking, returns/exchanges) can only be made by that workflow. Every change writes `OrderStatusHistory` and an `AuditLog` row. Order rows are locked (`SELECT … FOR UPDATE`) so a staff click and a courier webhook cannot race.

**Inventory** (`inventory.service.ts`). Stock buckets: `available`, `reserved`, `damaged`, `returned` (awaiting inspection). Every change is one conditional SQL `UPDATE … WHERE bucket + delta >= 0` plus an append-only `InventoryMovement`; database `CHECK` constraints are a second line of defence. Concurrent orders cannot oversell (tested with 12 simultaneous orders against 5 units).

**Money.** `Decimal(12,2)` columns, `Prisma.Decimal` arithmetic, strings in JSON. Order lines snapshot price and cost, so later catalog edits never rewrite historical profit.

**Ledger** (`FinancialEntry`). Typed, append-only, and idempotent: every posting has a deterministic `idempotencyKey` (e.g. `order:<id>:sales`, `shipment:<id>:delivery_fee`, `settlement:<id>:cash`), so retries and duplicate webhooks can never double-count. See [finance.md](finance.md).

**Couriers** (`server/src/modules/couriers`). Provider adapters implement a common interface with explicit capability flags; anything unsupported is shown as unsupported. Bookings are duplicate-safe (partial unique index: one live forward shipment per order; lookup-before-retry when a provider supports it; unique merchant references). See [integrations.md](integrations.md).

**After-commit side effects.** Domain events (`order-events.ts`) fire after the transaction commits; listeners (notifications, Meta CAPI) are idempotent and enqueue BullMQ jobs, so a failing integration never rolls back an order.

**Sessions.** Opaque random session tokens, stored as SHA-256 hashes, sent as `httpOnly; SameSite=Lax; Secure` (prod) cookies; double-submit CSRF token for state-changing requests; optional TOTP 2FA; per-account lockout and Redis-backed rate limits. See [security.md](security.md).

**Time.** Timestamps are stored in UTC. Business dates, filters and report buckets use Asia/Dhaka (UTC+6).

## Data model (main entities)

Identity: `User`, `Role`, `Permission`, `RolePermission`, `UserRole`, `Session`, `LoginHistory`, `PasswordResetToken`, `AuditLog`, `IdempotencyRecord`, `SavedFilter`, `Setting`, `Upload`.
Geography & shipping: `Division`, `District`, `Area`, `DeliveryZone`, `PickupAddress`.
Customers: `Customer`, `CustomerAddress`, `CommunicationLog`.
Catalog & stock: `Category`, `Collection`, `Product`, `ProductImage`, `ProductVariant`, `RelatedProduct`, `Material`, `ProductCostComponent`, `InventoryLevel`, `InventoryMovement`.
Purchasing: `Supplier`, `PurchaseOrder`, `PurchaseItem`, `SupplierPayment`.
Orders: `Order`, `OrderItem`, `OrderStatusHistory`, `OrderNote`.
Money: `Payment`, `Refund`, `Account`, `ExpenseCategory`, `Expense`, `FinancialEntry`.
Couriers: `CourierProvider`, `Shipment`, `CourierEvent`, `CourierApiLog`, `CourierSettlement`, `CourierSettlementItem`.
Returns: `ReturnRequest`, `ReturnItem`, `ReturnAttachment`, `ReturnStatusHistory`.
Marketing: `MarketingAttribution`, `AdSpendRecord`, `MetaEventLog`.
Notifications: `NotificationTemplate`, `Notification`, `NotificationOptOut`.
Content: `Banner`, `Page` (typed section blocks), `Testimonial`, `Faq`.

Deleted/archived records: products are archived (never deleted – orders reference them), variants are deactivated, expenses are soft-deleted with ledger reversals, customers with orders are anonymised rather than deleted.
