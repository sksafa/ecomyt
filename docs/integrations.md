# Integrations

All credentials are configured outside the code: courier credentials in Shipping → Couriers (stored AES-256-GCM encrypted with `ENCRYPTION_KEY`, never returned by the API), everything else in environment variables. No integration is shown as working unless it has been implemented; unsupported capabilities are displayed as unsupported.

## Couriers

Common adapter interface: `server/src/modules/couriers/types.ts`. Implementations: `server/src/modules/couriers/adapters/*`. The **sandbox courier (MOCK)** is enabled in development and used by automated tests – it never contacts a real courier (it cannot be enabled in production).

Research date: 2026-10-17. Sources are listed per provider; "unverified" capabilities come from community SDKs and are flagged in the UI until checked against the merchant portal documentation.

| Capability | Steadfast | Pathao | RedX | eCourier | Paperfly |
|---|---|---|---|---|---|
| Implemented | ✓ | ✓ | ✓ | ✓ | ✗ (no public official docs) |
| Create shipment | ✓ | ✓ | ✓ | ✓ | – |
| Track | ✓ `status_by_cid` | ✓ *(unverified path)* | ✓ `parcel/info` | ✓ `track` | – |
| Cancel via API | ✗ (portal) | ✗ (portal) | ✓ | ✓ (only while *Initiated*) | – |
| Webhooks | ✓ Bearer token | ✓ shared secret header + handshake | ✓ token in URL query | ✗ (polling) | – |
| Labels via API | ✗ | ✗ | ✗ | ✓ PDF URL | – |
| Sandbox | ✗ (real parcels!) | ✓ | ✓ | ✓ | – |
| Location ids needed | no | no (auto-detected) | yes (area id, matched by name; `config.areaMap` for exceptions) | names (city/thana/area) | – |
| Lookup by our reference (safe retries) | ✗ (unique invoice instead) | ✗ | ✗ | ✓ | – |

Sources: Steadfast – official Postman collection https://documenter.getpostman.com/view/26211192/2sAYJ1mhpk and the official WordPress plugin; Pathao – Pathao's official WooCommerce plugin https://github.com/pathao-eng/courier-woocommerce-plugin (developer portal requires login); RedX – https://redx.com.bd/developer-api/; eCourier – Merchant API v5.1 PDF; Paperfly – no public official documentation found.

**Webhook security.** None of these couriers signs payloads (only shared tokens). Therefore a webhook from a real courier is treated as a *hint*: the system re-reads the status (and fees) from the courier API before applying it, and money values in webhook bodies are ignored. Webhook URL: `https://<api>/api/v1/webhooks/couriers/<code>` (copy it from the courier settings screen; rotate the secret there and paste it into the courier portal).

**Status mapping.** Each adapter maps provider statuses to internal shipment statuses (shown in settings). Updates only move a shipment forward (stale or out-of-order events are recorded but not applied); a courier "cancel" after pickup is treated as returning to origin.

**Duplicate-shipment protection.** (1) partial unique index – an order can have only one live forward shipment; (2) the merchant reference is the order number (suffixed for re-bookings), which couriers enforce as unique; (3) before retrying a failed booking the adapter looks the parcel up by reference when supported; (4) temporary failures (timeouts, 5xx, 429) are retried with exponential backoff by the worker, permanent failures mark the shipment FAILED and notify staff.

**Before going live with a provider:** create sandbox credentials, set provider config (Pathao `storeId`; RedX optional `areaMap`, `pickupStoreId`; eCourier `packageCode`, `defaultZip`, optional `thanaMap`), book a test parcel, verify the webhook in the provider portal, and confirm the unverified Pathao order-info path.

**Settlements.** Courier payouts are recorded in Shipping → COD settlements (one settlement per payout reference; a shipment can be settled once). Steadfast exposes a payments API that could automate this – not integrated yet.

## Payments

| Gateway | Status |
|---|---|
| Cash on delivery | ✓ |
| Manual advance (bKash / Nagad / Rocket / bank / cash with transaction id) | ✓ record → verify, duplicate transaction ids rejected |
| SSLCommerz (cards, bKash, Nagad, Rocket through the aggregator) | ✓ implemented against the public v4 API (`gwprocess/v4/api.php`, validation API). Needs `SSLCOMMERZ_STORE_ID/PASSWORD`; test in sandbox before production |
| bKash / Nagad direct APIs | ✗ not implemented – require merchant onboarding docs; use SSLCommerz or manual recording |
| Sandbox gateway | development only, never in production |

Payments are completed only after server-side validation (amount + currency + transaction id); browser redirects alone never mark an order paid.

## Meta (Facebook)

Pixel + Conversions API with shared event IDs and backend-enforced one-time Purchase: see **[meta-tracking.md](meta-tracking.md)** for events, deduplication guarantees, data sent, setup and the verification checklist.

- **Attribution**: UTM parameters, landing page, referrer, fbclid/fbc/fbp – first and last touch – are stored per website order.
- **Ad spend**: CSV import (Ads Manager export columns accepted) or manual entry, upserted by platform/date/campaign/adset/ad so re-imports never duplicate.

## Notifications

In-app (always), email (`SMTP_URL`; otherwise logged), SMS (adapter interface with a logging provider; plug in a licensed Bangladeshi SMS gateway in `server/src/modules/notifications/channels.ts`), WhatsApp Business Cloud API (official; `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, approved templates). Customer messages are transactional only (order confirmed / shipped), off by default, respect opt-outs, and are de-duplicated. No unofficial APIs are used.

## Live admin updates

Admin screens update without a page refresh. After an order is created or changed (after the DB commit), the API pushes a small notice over Server-Sent Events (`GET /api/v1/orders/stream`, requires `orders.view`). The notice goes through Redis pub/sub, so changes made by any API instance or by the worker reach every connected browser. The browser only invalidates its cached queries (orders list and tab counts, open order detail, dashboard, notifications) and re-fetches from the API. It never inserts rows from the notice, so a repeated or missed notice cannot create duplicates. New website orders also show a toast. If the stream drops, the browser reconnects and re-fetches. The orders list also re-fetches every 60 s and when the window regains focus. Reverse proxies must not buffer `text/event-stream` (the API sends `X-Accel-Buffering: no` for nginx).
