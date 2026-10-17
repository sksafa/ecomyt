# Testing

```bash
cd server
npm test                                  # all suites
npx vitest run tests/orders.test.ts       # one file
```

Tests run against `TEST_DATABASE_URL` (a separate `bentbound_test` database created by `docker/postgres/init`). `tests/global-setup.ts` applies migrations, truncates every table and loads reference data before each run, and refuses to run against a database whose name does not contain "test". Queues are disabled in tests (`QUEUES_ENABLED=false`); job handlers are called directly. Courier and payment integrations use the sandbox courier, the sandbox gateway, or a stubbed `fetch` – no real shipment, payment or Meta event is ever created by the test suite.

| Suite | Covers |
|---|---|
| `auth.test.ts` | login/logout, enumeration-safe errors, lockout, CSRF, TOTP 2FA, password reset (single use, sessions revoked), session revocation, RBAC enforcement, custom roles, privilege escalation, validation errors, OpenAPI |
| `orders.test.ts` | order creation & totals, phone normalisation, cost snapshots, stock reservation, insufficient stock rollback, **concurrent orders never oversell**, Idempotency-Key, duplicate/risk flags, price & delivery override permissions, full lifecycle with revenue on delivery, ledger idempotency, cancellation releases stock, RTO, editing re-reserves stock, bulk results, search, finance-field hiding, export permission + CSV formula injection, customer anonymisation |
| `couriers.test.ts` | booking, double-click/concurrent booking → one shipment, retryable failures + retry, lost-response retry without duplicate parcel, permanent failure + notification + rebooking, webhook-driven status, duplicate & out-of-order webhooks, bad signatures, RTO with return fee, cancellation rules, COD settlement (once only, cash + fee adjustments, reconciliation) |
| `courier-adapters.test.ts` | Steadfast / Pathao / RedX / eCourier request contracts with stubbed HTTP, header auth, webhook verification, Pathao handshake, RedX area matching, eCourier lookup, **unsigned webhooks confirmed through the API**, PII masking in API logs |
| `money.test.ts` | advance payments (pending → verified), duplicate transaction ids, overpayment, online gateway validation (tampered amount rejected, IPN idempotent), sandbox completion, refund approval gate, customer return end-to-end (stock + exact P&L), exchange credit, return rejection, expenses with reversal and P&L reconciliation |
| `dashboard.test.ts` | KPI deltas, Dhaka bucketing, finance visibility, reports, exports |
| `marketing.test.ts`, `notifications.test.ts` | ad-spend import idempotency, attribution/ROAS/CPA maths, CAPI skip + dedupe, notifications, opt-outs, scheduled jobs |
| `purchasing.test.ts`, `cms.test.ts`, `storefront.test.ts`, `settings.test.ts` | receiving & supplier payments, CMS sanitisation, checkout idempotency/repricing/honeypot/attribution, order lookup, settings validation, permission-scoped search |
