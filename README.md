# Bent & Bound – E-commerce Management System

Order management, CRM, catalog & inventory, courier integrations, returns, payments, finance, marketing analytics, content and a mobile-first storefront for **Bent & Bound**, a Bangladeshi brand of premium embroidered orna.

| | |
|---|---|
| `client/` | Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · TanStack Query · React Hook Form + Zod · Recharts — storefront at `/`, admin console at `/admin` (port 3000) |
| `server/` | Node.js · Express 5 · TypeScript · Prisma 7 · PostgreSQL 16 · Redis 7 · BullMQ — REST API `/api/v1` (port 8080) + background worker |
| `docs/` | architecture, setup, business rules, finance definitions, integrations, security, testing, deployment, API |

## Quick start

```bash
npm run install:all
npm run infra:up                                   # Postgres + Redis in Docker (localhost only)
cp server/.env.example server/.env                 # fill SESSION_SECRET, ENCRYPTION_KEY, SEED_ADMIN_PASSWORD
cp client/.env.example client/.env.local
npm run db:migrate && npm run db:seed
DEMO_MODE=true npm run db:seed:demo                # optional demo data
npm run dev                                        # http://localhost:3000 · admin: /admin · API docs: http://localhost:8080/api/v1/docs
```

Details: [docs/setup.md](docs/setup.md). Production: [docs/deployment.md](docs/deployment.md).

## Documentation

- [Architecture & data model](docs/architecture.md)
- [Business rules](docs/business-rules.md) – order workflow, inventory policy, risk indicators, delivery charges, returns, payments
- [Finance definitions](docs/finance.md) – revenue recognition, ledger, estimated vs reconciled profit
- [Integrations](docs/integrations.md) – couriers (capability matrix and verification status), payments, Meta, notifications
- [Meta Pixel + Conversions API](docs/meta-tracking.md) – events, Purchase deduplication, setup and verification
- [Security](docs/security.md) · [Testing](docs/testing.md) · [API](docs/api.md) · [Deployment & backups](docs/deployment.md)
