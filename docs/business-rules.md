# Business rules

## Order statuses and transitions

| From | Allowed next statuses | Notes |
|---|---|---|
| PENDING | CONFIRMATION_REQUIRED, CONFIRMED, ON_HOLD, CANCELLED | New orders start here (or in CONFIRMATION_REQUIRED when risky) |
| CONFIRMATION_REQUIRED | CONFIRMED, ON_HOLD, CANCELLED | Risk score ≥ threshold (default 40) |
| ON_HOLD | PENDING, CONFIRMATION_REQUIRED, CONFIRMED, PROCESSING, CANCELLED | |
| CONFIRMED | PROCESSING, READY_TO_SHIP, ON_HOLD, CANCELLED | |
| PROCESSING | READY_TO_SHIP, ON_HOLD, CANCELLED | |
| READY_TO_SHIP | PROCESSING, COURIER_BOOKED*, SHIPPED, ON_HOLD, CANCELLED | SHIPPED = own delivery without a courier |
| COURIER_BOOKED | SHIPPED, DELIVERED, READY_TO_SHIP, RETURN_IN_TRANSIT, RETURNED, CANCELLED | READY_TO_SHIP / CANCELLED only after the shipment is cancelled |
| SHIPPED (in transit) | DELIVERED, RETURN_IN_TRANSIT, RETURNED | RETURNED here = RTO (never delivered) |
| DELIVERED | RETURN_REQUESTED*, EXCHANGE_REQUESTED* | |
| RETURN_REQUESTED | RETURN_IN_TRANSIT*, RETURNED*, DELIVERED* | |
| EXCHANGE_REQUESTED | EXCHANGED*, DELIVERED* | |
| RETURN_IN_TRANSIT | RETURNED | |
| RETURNED, EXCHANGED, CANCELLED | – | final |

\* only through the courier booking or returns workflow.

Permissions per target: CONFIRMED / CONFIRMATION_REQUIRED need `orders.confirm`, CANCELLED needs `orders.cancel` and a reason, everything else `orders.status`. Courier webhooks act as the system.

Status labels have English and Bengali text; display labels/colours can be overridden in Settings → Status labels (the workflow itself is fixed in code to protect stock and money).

## Inventory policy (Settings → Inventory)

- **Reserve on**: `ORDER_CREATED` (default) – stock is reserved the moment an order is saved, so it cannot be sold twice; or `CONFIRMED`.
- **Deduct on**: `SHIPPED` (default) or `COURIER_BOOKED` – reserved stock leaves the books when the parcel leaves.
- **Cancel before shipping** → reservation released. **Edit items** → old reservation released, new one made (fails if no stock).
- **RTO** (parcel returned undelivered) → units go to *returned (awaiting inspection)*; an RTO return record is created automatically.
- **Customer return** → after receiving, units go to *returned*; inspection decides **restock** (back to available), **damaged** or **dispose**. Nothing is restocked without an inspection decision.
- **Back-orders**: off by default. When enabled, orders that cannot be reserved are flagged as pre-orders.

## Risk indicators (not fraud verdicts)

Shown to staff in English and Bengali as a prompt to call the customer:

| Code | Points | Meaning |
|---|---|---|
| POSSIBLE_DUPLICATE | 40 | Another open order from the same phone within the duplicate window (24h) |
| PRIOR_RETURNS | 15 / 30 | Customer returned orders before (30 when ≥ 50 % of finished orders) |
| PRIOR_CANCELLATIONS | 15 | ≥ 2 cancelled orders |
| INCOMPLETE_ADDRESS | 20 | Address shorter than 12 characters |
| HIGH_VALUE_COD | 10 | COD order ≥ ৳10,000 |

Repeat buyers and shared addresses are never penalised by themselves; nobody is automatically labelled fraudulent.

## Delivery charge

**Website checkout** offers two flat options: *Inside Dhaka* and *Outside Dhaka* (pre-selected). The charges are set in **Settings → Delivery charges** (stored in the database, defaults ৳70 / ৳120). Checkout sends only the chosen option; the server looks up the charge, stores the option and charge on the order, and calculates **total = products + delivery charge**. Changing the charges affects new orders only.

**Staff-created orders** use the zone rates below:
Zone of the area (if set) else zone of the district else *Outside Dhaka*. Charge = base charge (covers the base weight, default 1 kg) + per-kg charge for each started extra kg; free above the zone's threshold or when all items are free-shipping. Rates are edited in Shipping → Delivery zones. Staff need `orders.override_delivery` to change the charge on an order.

## Returns, refunds, exchanges

Return request (delivered orders only) → approve / reject (reason) → pickup / in transit → receive (return shipping cost booked) → inspect each item → refund request → refund approval (`refunds.approve`) → refund paid from an account → complete.
Exchange: approve → create replacement order (returned items' value is credited as a discount; the difference is COD or a refund) → original order becomes EXCHANGED.
A refund is never paid automatically; cancelled prepaid orders get a *pending* refund request that still needs approval.

## Payments

- COD: the courier collects; on delivery a `COD_COLLECTION` payment is recorded (money held by the courier) and becomes cash with the courier settlement.
- Advance (bKash/Nagad/bank/cash): recorded with the transaction id (unique per method – duplicates are rejected), verified by someone with `payments.record`; only then does the due amount drop.
- Online (SSLCommerz): the server creates the transaction, the browser is redirected, and the payment is completed only after the gateway's validation API confirms amount and currency (IPN and redirect are both idempotent).

## Homepage

- `/` is a sales landing page for one product, using the brand's landing-page look (Anek Bangla text, Georgia / Noto Serif Bengali headings, maroon and gold). The previous catalogue homepage is at `/home2`. If no product can be sold (empty catalogue, API down) `/` shows the catalogue homepage instead.
- The product is chosen in **Content → Settings → Homepage product**. "Automatic" picks the most recently updated featured product that has stock. An unpublished or archived choice is never shown; the automatic pick is used until it is published again. Changes appear within about a minute because the storefront caches the home data for 60 seconds.
- Name, photos, price / compare-at price, colours, sizes, fabric, embroidery, design, description and care text come from the product. Brand copy (why buy, check before you pay, photo match, return policy) is fixed text in `client/src/components/store/home-landing/home-landing.tsx`. Reviews appear only when real testimonials exist (Content → Testimonials).
- Every "অর্ডার করুন" button scrolls to the order form on the same page. The form is the standard checkout (name, mobile, address, Inside / Outside Dhaka). Delivery charges and the total come from the server. Meta events are the same as on product pages: ViewContent on load, InitiateCheckout when the form is first used, Purchase after the order.

### Customer reviews

- Reviews come only from **Content → Testimonials**. A testimonial can be a written quote (customer name required), a **review screenshot** (e.g. the customer's Messenger / WhatsApp message), or both.
- The star rating is optional and empty by default. Set it only when the customer actually gave stars. The landing page shows an average only from real ratings.
- On the homepage the reviews sit just before the offer price, as a slider: one card per screen on phones, up to three on desktop. Tap a screenshot to see it full size. `/home2` and CMS pages show the same testimonials.
- Before uploading a screenshot, hide the customer's phone number, address and other personal details.
