-- Website checkout delivery option (Inside / Outside Dhaka); the applied charge is stored in "deliveryCharge".
CREATE TYPE "DeliveryOption" AS ENUM ('INSIDE_DHAKA', 'OUTSIDE_DHAKA');
ALTER TABLE "Order" ADD COLUMN "deliveryOption" "DeliveryOption";
