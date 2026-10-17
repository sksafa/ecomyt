-- Gap-tolerant, concurrency-safe counters for human-facing document numbers.
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 100001;
CREATE SEQUENCE IF NOT EXISTS return_number_seq START 5001;
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS settlement_number_seq START 1001;
