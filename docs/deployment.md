# Deployment & operations

## Production with Docker Compose

1. Provision a Linux host with Docker, point DNS at it, and put a TLS reverse proxy (Caddy or Nginx) in front. Cookies are `Secure`, so **HTTPS is required**.
2. `cp .env.production.example .env.production` and fill every value (`openssl rand -hex 32` for secrets). Back up `ENCRYPTION_KEY` safely – it decrypts stored courier credentials and 2FA secrets.
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`
   - `migrate` runs `prisma migrate deploy` once, then `api`, `worker` and `web` start.
   - Postgres and Redis are on the internal network only; `web` (3000) and `api` (8080) are bound to 127.0.0.1 for the proxy.
4. Create the first admin (one time):
   `docker compose -f docker-compose.prod.yml --env-file .env.production run --rm -e SEED_ADMIN_EMAIL=you@bentandbound.com -e SEED_ADMIN_PASSWORD='<strong password>' api node dist/seed/cli.js`
   (or run `npm run db:seed` from a machine with access to the database). Sign in and change the password; enable 2FA.
5. In the admin: Settings (store info, inventory policy), Shipping → Delivery zones, Couriers (credentials, webhook), Finance accounts, Meta pixel.

Example Caddyfile (single domain; Next.js proxies `/api` to the API):
```
bentandbound.com {
  reverse_proxy 127.0.0.1:3000
}
```
Courier webhooks and payment callbacks use `PUBLIC_API_URL`; with the single-domain setup above set it to the same origin (requests to `/api/*` are forwarded by the web container).

**Never run `npm run db:seed:demo` against production** – it refuses unless `DEMO_MODE=true` and `NODE_ENV` is not production.

## Processes

| Process | Command | Notes |
|---|---|---|
| API | `node dist/index.js` | stateless, scale horizontally; graceful shutdown on SIGTERM (drains requests, closes DB/Redis) |
| Worker | `node dist/worker.js` | courier retries & polling, Meta CAPI, notifications, scheduled jobs (daily summary 21:00, low stock 09:00, COD reminder 10:00 Dhaka; courier sync every 30 min); safe to run more than one (BullMQ) |
| Web | `node server.js` (Next standalone) | proxies `/api` and `/uploads` to `API_URL` |

## Health & monitoring

- `GET /api/v1/health` – DB connectivity (used by the container healthcheck).
- Logs: structured JSON (pino) on stdout with secrets redacted; ship them to your log platform (Loki, CloudWatch, Datadog…). Alert on `level >= 50` (error).
- Error monitoring: add Sentry (or similar) by wrapping `errorHandler` in `server/src/middleware/error.ts` and the Next.js `instrumentation.ts`.
- Queue health: failed jobs stay in Redis for 30 days; inspect with any BullMQ dashboard pointed at the private Redis.

## Backups

```bash
# nightly logical backup (keep 14+ days, copy off-site)
docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > backup-$(date +%F).dump
# uploaded files
docker run --rm -v bentbound-prod_uploads:/data -v "$PWD":/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```
Restore:
```bash
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < backup-YYYY-MM-DD.dump
```
Test a restore regularly on a staging host. Redis holds queues and rate-limit counters only; it does not need backups (AOF is enabled to survive restarts).

## Migrations

Schema changes: edit `server/prisma/schema.prisma`, run `npx prisma migrate dev --create-only --name <change>` locally, **review the SQL** (some indexes/constraints live only in SQL migrations – partial unique index on shipments, trigram indexes, check constraints, sequences – make sure a generated migration does not drop them), apply, commit. Production applies migrations with `prisma migrate deploy` (the `migrate` service).
