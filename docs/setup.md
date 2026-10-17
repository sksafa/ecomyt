# Local development setup

Requirements: Node.js 20+ (tested on 24), Docker with Compose v2.

```bash
npm run install:all                      # root + server + client dependencies
npm run infra:up                         # Postgres 16 (127.0.0.1:5442) + Redis 7 (127.0.0.1:6390) via docker compose

cp server/.env.example server/.env       # then fill SESSION_SECRET, ENCRYPTION_KEY, SEED_ADMIN_PASSWORD (see below)
cp client/.env.example client/.env.local

npm run db:migrate                       # prisma migrate deploy
npm run db:seed                          # permissions, roles, BD geography, zones, accounts, couriers + first Super Admin
DEMO_MODE=true npm run db:seed:demo      # optional demo shop (products, ~60 orders, shipments, returns, expenses)

npm run dev                              # api :8080, worker, web :3000
```

Generate secrets: `openssl rand -hex 32` (use separate values for `SESSION_SECRET` and `ENCRYPTION_KEY`).

| URL | What |
|---|---|
| http://localhost:3000 | Storefront |
| http://localhost:3000/admin | Admin console (sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`) |
| http://localhost:8080/api/v1/docs | Interactive API documentation (OpenAPI 3.1) |
| http://localhost:8080/api/v1/health | Health check |

Demo staff accounts (demo seed only): `order_manager@demo.bentbound`, `confirmation_agent@demo.bentbound`, `warehouse@demo.bentbound`, `accountant@demo.bentbound` – password = `SEED_ADMIN_PASSWORD`.

Ports and database names are configurable in `docker-compose.yml` (`POSTGRES_PORT`, `REDIS_PORT`) and `server/.env`.

## Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev:api` / `dev:worker` / `dev:web` | run one process |
| `npm test` | server test suite (uses `TEST_DATABASE_URL`, wiped before each run) |
| `npm run typecheck` | TypeScript for server and client |
| `npm run lint` | ESLint (client) |
| `npm run build` | production builds |
| `cd server && npx prisma studio` | browse the database |

The sandbox courier ("MOCK") is enabled in development. Use **Shipping → Shipments → simulate** (or `POST /api/v1/couriers/mock/simulate`) to move a parcel through pickup, delivery or return, exercising the same signed-webhook pipeline real couriers use.
