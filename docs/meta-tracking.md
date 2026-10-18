# Meta Pixel + Conversions API

Browser events (Meta Pixel) and server events (Conversions API, "CAPI") are sent for the same actions with the **same `event_id`**, so Meta keeps one of each pair. One purchase produces exactly one Purchase conversion.

## Events

| Event | Browser (Pixel) | Server (CAPI) | When |
|---|---|---|---|
| PageView | ✓ | – | each full page load (from the Pixel snippet) and each client-side route change; never twice for one navigation |
| ViewContent | ✓ | ✓ mirrored | once per product page view |
| AddToCart | ✓ | ✓ mirrored | each "Add to bag" |
| InitiateCheckout | ✓ | ✓ mirrored | once per cart on the checkout page (reloading checkout does not repeat it) |
| Purchase | ✓ | ✓ | **cash on delivery:** when the backend has created the order · **online payment:** when the gateway payment is verified on the server · **unpaid online order later confirmed by staff:** server only |

Mirrored events: the browser sends the Pixel event with a random `eventID` and posts the same id to `POST /api/v1/storefront/events`; the server re-reads SKUs and prices from the catalogue (client values are ignored), adds IP / user agent / `_fbp` / `_fbc`, and sends the CAPI copy. No personal data is sent from the browser.

Staff-created orders (phone, Facebook inbox, manual) are never sent – they are not website conversions.

## Purchase deduplication – how it is guaranteed

1. **One id per order.** Website orders get `Order.metaPurchaseEventId = purchase:<orderId>` when they are created. The browser Pixel `eventID` and the server `event_id` are both this value. Nothing else ever generates a Purchase id.
2. **The browser never builds a Purchase.** It fires Purchase only from a payload issued by the backend, and the backend issues it **once per order** (atomic `Order.pixelPurchaseClaimedAt` update):
   - COD: in the checkout response that created the order. Replayed/duplicate responses (double submit, retry after a lost response, reload with the same Idempotency-Key) contain `metaPurchase: null`.
   - Online payment: `POST /storefront/orders/:orderNumber/purchase-event` after the verified payment; any later call – thank-you page refresh, revisit, another device – returns `purchase: null`.
   - A per-browser `localStorage` guard additionally prevents re-firing a payload that was already used.
3. **The server sends once.** `MetaEventLog (eventName, eventId)` is unique. A row is `SENT` only when Meta answers 2xx with `events_received ≥ 1`. Retries (worker backoff, admin "Send again") reuse the same row and the same `event_id`, and a `SENT` event is never sent again.
4. **Identical data.** `value`, `contents`, `content_ids`, `num_items` and `order_id` for both sides come from one server function (`purchaseCustomData`).

## Purchase data

`currency: BDT`, `value`, `content_type: product`, `content_ids` (SKUs), `contents` (`id`, `quantity`, `item_price`), `num_items`, `order_id` (order number), plus explicit `product_value`, `delivery_charge` and `order_total`.

**Value rule** (Admin → Settings → Meta pixel → "purchaseValue", applied to browser and server alike):
- `ORDER_TOTAL` (default) – products − discount + delivery charge = what the customer pays.
- `PRODUCT_VALUE` – products − discount, delivery excluded.

`event_time` = order creation (COD) or payment verification (online). `event_source_url` = the checkout page URL (only this store's own origin is accepted). Events older than 7 days are not sent (Meta rejects them).

## Customer matching (server only)

Normalised per Meta's specification, then SHA-256 hashed: `ph` (8801XXXXXXXXX), `em` (trimmed, lower-case), `fn` / `ln` (lower-case, punctuation removed, Bengali kept in UTF-8), `ct` (district), `country` (`bd`), `external_id` (customer id). Sent unhashed as Meta requires: `fbc`, `fbp`, `client_ip_address`, `client_user_agent`. The Pixel receives no personal data. The access token exists only in server environment variables and is sent in the request body, never in a URL or in client code. Logs keep the parameters and *which* match keys were present – never hashes or raw values.

## Setup

1. **Events Manager → Data sources → your Pixel**: copy the Pixel (dataset) ID. **Settings → Conversions API → Generate access token**.
2. Server environment (`server/.env` or `.env.production`):
   ```
   META_PIXEL_ID=<pixel id>
   META_CAPI_ACCESS_TOKEN=<access token>   # server only
   META_TEST_EVENT_CODE=                   # set only while testing (see below)
   ```
3. Client environment: `NEXT_PUBLIC_META_PIXEL_ID=<pixel id>` (or leave empty and set the Pixel ID in Admin → Settings → Meta pixel). Rebuild/restart the web app.
4. **Admin → Settings → Meta pixel**: enter the Pixel ID, enable **Conversions API**, choose the purchase value rule. **Admin → Marketing → Meta** shows the configuration status (the token is never displayed).
5. In Events Manager → Settings, keep **automatic advanced matching** as you prefer; no change is required for deduplication.

## Verification checklist (do this before relying on the numbers)

The automated test suite (`server/tests/meta-tracking.test.ts`) and an end-to-end browser run against the real API/worker with a recording Graph API stub confirm the logic. Verifying against **your** Pixel must be done with your credentials:

1. **Test events.** Events Manager → your Pixel → **Test events** → copy the test code into `META_TEST_EVENT_CODE`, restart the API and worker. Server events now appear in the Test events tab (they do not count as real conversions).
2. **Pixel Helper.** Install the *Meta Pixel Helper* Chrome extension, open the shop from a link with `?fbclid=test123`, then: product page → ViewContent; Add to bag → AddToCart; checkout → InitiateCheckout; place a COD order → **one** Purchase. Note its `eventID` (`purchase:…`). Refresh the confirmation page: no new Purchase.
3. **Deduplication.** In Test events, the Purchase should show **Browser** and **Server** with the same event ID and be marked *Deduplicated*. Admin → Orders → (the order) → *Meta tracking* shows the same event ID with status **sent**.
4. **Online payment** (when SSLCommerz is configured): pay with a sandbox card → one Purchase after the payment, none before.
5. **Diagnostics.** Events Manager → Diagnostics should show no "missing event_id" / "server events not deduplicated" warnings after a day of traffic; check *Event match quality* for Purchase.
6. Remove `META_TEST_EVENT_CODE` and restart.

## Operations

- **Failures:** network errors, timeouts, 5xx and 429 are retried by the worker with exponential backoff (5 attempts). 4xx answers (e.g. invalid token, code 190) are permanent – fix the cause, then use **Send again** on the order (same event ID, so Meta still deduplicates). A rejected or failed event is never shown as sent.
- **Not configured:** events are recorded as `skipped` with the reason. Older skipped Purchases are not sent automatically when you enable CAPI later; use **Send again** if you want them (only events < 7 days old are accepted by Meta).
- Mirrored browsing events are kept in the log for 30 days; Purchase records are kept permanently.
- Meta reporting is platform data. Verified results (delivered orders, returns) are in **Marketing → Reconciliation** and **Reports → Marketing**.
