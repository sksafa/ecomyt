# Security

| Area | Implementation |
|---|---|
| Passwords | Argon2id; policy ≥ 8 chars with letters and numbers; timing-safe handling of unknown emails |
| Brute force | Per-account lockout (5 failures → 15 min), Redis-backed rate limits on auth (20 / 15 min / IP), global API limit, storefront write limit |
| Sessions | 32-byte random tokens, stored as SHA-256; `httpOnly`, `SameSite=Lax`, `Secure` in production (`COOKIE_SECURE=true` is enforced at boot); TTL `SESSION_TTL_HOURS`; revocable; listed per user with IP/UA; disabled users and password resets revoke sessions |
| 2FA | Optional TOTP (otplib), secret encrypted at rest; login is two-step |
| Password reset | Single-use, 30-minute, hashed tokens; no account enumeration |
| CSRF | Double-submit cookie (`bb_csrf` + `x-csrf-token`) for cookie-authenticated writes; webhooks/payment callbacks are exempt and authenticated by signature/secret/validation API |
| Authorization | RBAC with granular permissions on every endpoint (`route({ access })`); least-privilege default roles; only a Super Admin can grant Super Admin; financial fields stripped for users without `finance.view`; exports need explicit `*.export` permissions and are audited |
| Validation | Zod schemas on every body/query/param; field-level 422 errors |
| Injection | Prisma parameterised queries; raw SQL only via tagged templates / fixed whitelists; CSV exports neutralise spreadsheet formula injection |
| XSS | React escaping; CMS rich text sanitised with `sanitize-html` (allow-list) on output; unsafe URL schemes rejected |
| Uploads | 5 MB limit, type detected from magic bytes (JPG/PNG/WebP/GIF/AVIF/PDF only), random file names, served with `nosniff` |
| Secrets | Courier credentials and 2FA secrets AES-256-GCM encrypted (`ENCRYPTION_KEY`); never returned by the API; redacted in logs and courier API logs (phone numbers masked) |
| Headers / CORS | Helmet; CORS restricted to `CLIENT_URL` origins with credentials |
| Audit | `AuditLog` for orders, money, stock, users/roles, settings, exports, credentials (who, when, before, after, reason, IP); login history |
| Transactions | Order, stock, payment, refund, return and settlement operations run in DB transactions with row locks; idempotency keys for create endpoints, payments and ledger entries |
| Infrastructure | Postgres/Redis bound to localhost in development and private networks in production; containers run as non-root |

Known follow-ups: add a WAF/CDN in front of the storefront; schedule dependency audits (`npm audit`); consider moving rate-limit and session revocation checks into Redis caches if traffic grows.
