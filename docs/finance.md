# Finance: definitions and accounting rules

Currency is BDT (৳). Money is stored as `Decimal(12,2)`; amounts are never calculated with floating point.

## Definitions

| Term | Meaning |
|---|---|
| **Placed orders / gross sales** | Orders created in the period (excluding cancelled for value). Not revenue. |
| **Confirmed orders** | Orders that reached CONFIRMED. |
| **Delivered orders** | Orders delivered in the period (by delivery date). |
| **Revenue** | Recognised **on delivery**: product sales (subtotal − discounts) + shipping revenue (customer-paid delivery charge) − refunds of returned goods. |
| **Shipping revenue vs courier expense** | The delivery charge a customer pays is revenue; what the courier charges us (delivery fee, COD charge, return/RTO fee) is a separate expense. Customer-paid delivery is never treated as profit by itself. |
| **Product cost (COGS)** | Cost snapshot taken when the order was placed (variant/product cost, optionally computed from materials, embroidery, lace, labour, packaging components). Booked on delivery. |
| **Gross profit** | Revenue − COGS + cost recovered by restocking returned goods. |
| **Operating expenses** | Expenses recorded in Finance → Expenses (rent, salaries, utilities, packaging purchases, software…). |
| **Advertising expense** | Expenses in an *advertising* category. Imported ad-platform spend (Marketing → Ad spend) is for ROAS/CPA analysis only and is **not** added to the ledger, so advertising is never counted twice. Marketing → Reconciliation compares the two. |
| **Courier expenses** | Delivery fees, COD charges and return/RTO fees reported by the courier (corrected by settlements). |
| **Return losses** | Refunds paid, return shipping, and the cost of returned items that could not be restocked. |
| **Net profit (estimate)** | Gross profit − courier − packaging − advertising − operating expenses ± adjustments. |
| **Cash received** | Money that actually reached a cash/bank/wallet account: verified advance payments and courier settlements. |
| **Receivables (COD outstanding)** | COD collected by couriers for delivered parcels that has not been settled to us yet. |

## Estimated vs. reconciled

An order's profit starts as an **estimate** (courier fee from the zone table, COD charge from the configured %) and becomes **reconciled** when the courier settlement for its shipment is recorded with the actual fees (Order `financeStatus = RECONCILED`). Order detail shows which lines are estimates.

## Ledger postings

| Event | Entries (signed; + increases profit/cash) | Cash? |
|---|---|---|
| Order delivered | SALES_REVENUE +, SHIPPING_REVENUE +, COGS −, PACKAGING_COST − | no |
| Shipment final with known fees | COURIER_FEE −, COD_FEE − (delivered), RETURN_FEE − (returned) | no |
| RTO received | PACKAGING_COST − (no revenue, no COGS: goods come back) | no |
| Advance payment verified | PAYMENT_RECEIVED + | yes (account) |
| Courier settlement recorded | SETTLEMENT_RECEIVED + ; fee differences as COURIER_FEE/COD_FEE/RETURN_FEE ± | settlement = yes |
| Return received | RETURN_FEE − (return shipping) | no |
| Inspection: restock | RESTOCK_RECOVERY + (unit cost × qty) | no |
| Refund paid | RETURN_REVERSAL − (P&L) and REFUND − (cash) | REFUND yes |
| Expense | EXPENSE − or AD_SPEND − (advertising categories) | yes if paid from an account |
| Expense edited / deleted | reversal of the previous posting, then the new posting | as original |
| Supplier payment | SUPPLIER_PAYMENT − | yes |
| Manual adjustment / transfer | ADJUSTMENT ± (audited, reason required) | optional |

Every entry has a unique idempotency key, so replays (webhooks, retries, double clicks) never create duplicate financial records. P&L sums only the profit types; cash reports sum only `isCash` entries.

## Advertising allocation

Advertising is not allocated per order in the ledger. Reports show **ad cost per delivered order** = advertising expense ÷ delivered orders, **CAC** = advertising ÷ new customers, and **delivered-order ROAS** = delivered revenue of attributed orders ÷ platform spend for the campaign. Platform-reported purchases/revenue are always labelled as platform-reported.
