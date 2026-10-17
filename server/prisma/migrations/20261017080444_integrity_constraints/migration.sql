-- Stock buckets can never go negative: overselling fails at the database level.
ALTER TABLE "InventoryLevel"
  ADD CONSTRAINT "InventoryLevel_available_nonneg" CHECK ("available" >= 0),
  ADD CONSTRAINT "InventoryLevel_reserved_nonneg" CHECK ("reserved" >= 0),
  ADD CONSTRAINT "InventoryLevel_damaged_nonneg" CHECK ("damaged" >= 0),
  ADD CONSTRAINT "InventoryLevel_returned_nonneg" CHECK ("returned" >= 0);

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_pos" CHECK ("quantity" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_nonneg"
  CHECK ("subtotal" >= 0 AND "total" >= 0 AND "paidAmount" >= 0 AND "deliveryCharge" >= 0 AND "discountTotal" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_pos" CHECK ("amount" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_pos" CHECK ("amount" > 0);

-- At most one live (non cancelled / failed) forward shipment per order.
-- Retries and double clicks therefore cannot book a second parcel.
CREATE UNIQUE INDEX "Shipment_one_active_forward_per_order"
  ON "Shipment" ("orderId")
  WHERE "isReturn" = false AND "status" NOT IN ('CANCELLED', 'FAILED');

-- Fast phone / name / tracking search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Customer_name_trgm" ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX "Order_shippingName_trgm" ON "Order" USING gin ("shippingName" gin_trgm_ops);
CREATE INDEX "Order_shippingAddress_trgm" ON "Order" USING gin ("shippingAddress" gin_trgm_ops);
CREATE INDEX "Product_name_trgm" ON "Product" USING gin ("name" gin_trgm_ops);
