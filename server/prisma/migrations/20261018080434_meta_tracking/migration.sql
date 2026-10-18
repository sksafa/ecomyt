-- Meta Pixel + Conversions API tracking state
ALTER TABLE "Order" ADD COLUMN "metaPurchaseEventId" TEXT, ADD COLUMN "pixelPurchaseClaimedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Order_metaPurchaseEventId_key" ON "Order"("metaPurchaseEventId");

ALTER TABLE "MarketingAttribution" ADD COLUMN "eventSourceUrl" TEXT;

ALTER TABLE "MetaEventLog"
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "eventsReceived" INTEGER,
  ADD COLUMN "fbtraceId" TEXT,
  ADD COLUMN "testEventCode" TEXT,
  ADD COLUMN "sentAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "MetaEventLog_orderId_idx" ON "MetaEventLog"("orderId");
CREATE INDEX "MetaEventLog_status_createdAt_idx" ON "MetaEventLog"("status", "createdAt");

-- existing website orders get their (previously implicit) event id persisted
UPDATE "Order" SET "metaPurchaseEventId" = 'purchase:' || "id" WHERE "channel" = 'WEBSITE' AND "createdById" IS NULL;
