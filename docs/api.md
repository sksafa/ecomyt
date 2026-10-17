# API

Base path `/api/v1`. The complete, always-current reference is generated from the route definitions: **`/api/v1/docs`** (Swagger UI) and **`/api/v1/openapi.json`**. Every operation lists the permission it requires.

## Conventions

- **Envelope**: `{ "success": true, "data": …, "meta": { page, pageSize, total, totalPages, … } }` or `{ "success": false, "error": { "code", "message", "details" } }`.
- **Status codes**: 200/201 success · 400 bad request · 401 not signed in · 403 missing permission / CSRF · 404 not found · 409 conflict (duplicates, stock, state) · 422 validation or business rule (`details` lists `{ path, message }`) · 423 account locked · 429 rate limited · 503 integration unavailable.
- **Money**: decimal strings in BDT (`"2270.00"`). **Dates**: ISO-8601 UTC; `from`/`to` filters are Asia/Dhaka dates (`YYYY-MM-DD`).
- **Pagination**: `page`, `pageSize` (≤ 200).
- **Authentication**: browser – `bb_session` httpOnly cookie from `POST /auth/login`, plus `x-csrf-token` (value of the `bb_csrf` cookie, or from `GET /auth/csrf`) on non-GET requests. Scripts – `Authorization: Bearer <token>` (token returned by login).
- **Idempotency**: create endpoints marked "Supports the Idempotency-Key header" replay the first response for a repeated key (per user) and reject the same key with a different body.

## Modules

| Path | Purpose |
|---|---|
| `/auth` | login (+2FA), logout, me, password reset/change, 2FA setup, sessions, login history |
| `/users`, `/roles`, `/audit-logs` | staff, custom roles & permission matrix, audit trail |
| `/orders` | list/search/filter (status counts), create, edit, status transitions, bulk status/assign, notes, communications, duplicate, risk, export, print data |
| `/customers` | CRM: search, segments, duplicates & merge, profile, communications, export, anonymise |
| `/products`, `/categories`, `/collections` | catalog with variants, images, cost components, related products |
| `/inventory` | stock levels, valuation, adjustments, movement history |
| `/suppliers`, `/purchase-orders`, `/materials` | purchasing, receiving, supplier payments, cost calculator |
| `/shipping` | locations, delivery quote, zones, areas, pickup addresses |
| `/couriers` | providers & credentials, shipments (book, bulk, retry, sync, cancel, label), performance, COD summary, settlements, sandbox simulation |
| `/webhooks/couriers/:code` | courier status webhooks |
| `/payments`, `/refunds` | payments (record/verify/reject), online gateways & callbacks, refunds (approve/pay) |
| `/returns` | returns & exchanges workflow, inspection, attachments |
| `/finance` | expenses, accounts & statements, adjustments, transfers, ledger, profit & loss |
| `/dashboard`, `/reports` | KPIs, charts, 13 report types with CSV/XLSX export |
| `/marketing` | attribution, campaigns, reconciliation, ad spend import, Meta status/test |
| `/notifications` | in-app inbox, templates, outbound log, opt-outs |
| `/cms` | banners, pages/landing pages, testimonials, FAQs, content settings |
| `/storefront` | public catalog, pages, checkout, order lookup |
| `/settings`, `/search`, `/saved-filters`, `/uploads` | configuration, global search, saved filters, file uploads |
