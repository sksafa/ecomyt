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

Zone of the area (if set) else zone of the district else *Outside Dhaka*. Charge = base charge (covers the base weight, default 1 kg) + per-kg charge for each started extra kg; free above the zone's threshold or when all items are free-shipping. Rates are edited in Shipping → Delivery zones. Staff need `orders.override_delivery` to change the charge on an order.

## Returns, refunds, exchanges

Return request (delivered orders only) → approve / reject (reason) → pickup / in transit → receive (return shipping cost booked) → inspect each item → refund request → refund approval (`refunds.approve`) → refund paid from an account → complete.
Exchange: approve → create replacement order (returned items' value is credited as a discount; the difference is COD or a refund) → original order becomes EXCHANGED.
A refund is never paid automatically; cancelled prepaid orders get a *pending* refund request that still needs approval.

## Payments

- COD: the courier collects; on delivery a `COD_COLLECTION` payment is recorded (money held by the courier) and becomes cash with the courier settlement.
- Advance (bKash/Nagad/bank/cash): recorded with the transaction id (unique per method – duplicates are rejected), verified by someone with `payments.record`; only then does the due amount drop.
- Online (SSLCommerz): the server creates the transaction, the browser is redirected, and the payment is completed only after the gateway's validation API confirms amount and currency (IPN and redirect are both idempotent).
