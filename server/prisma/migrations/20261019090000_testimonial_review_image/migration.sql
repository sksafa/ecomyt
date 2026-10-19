-- Testimonials can be a screenshot of the customer's message, and the rating is optional
-- (a screenshot has no star rating; it must not default to 5).
ALTER TABLE "Testimonial" ADD COLUMN "reviewImageUrl" TEXT;
ALTER TABLE "Testimonial" ALTER COLUMN "rating" DROP NOT NULL;
ALTER TABLE "Testimonial" ALTER COLUMN "rating" DROP DEFAULT;
