-- Short-lived, pseudonymous counters. Each identity/dimension owns one reusable row.
CREATE TABLE guest_exchange_buckets(
  dimension TEXT NOT NULL CHECK(dimension IN('network','invite_network','invite')),
  bucket_hash TEXT NOT NULL CHECK(length(bucket_hash)=64 AND bucket_hash NOT GLOB '*[^0-9a-f]*'),
  window_started_at_ms INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK(attempts>=1),
  attempt_limit INTEGER NOT NULL CHECK(attempt_limit>0),
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(dimension,bucket_hash)
);
CREATE INDEX guest_exchange_bucket_expiry ON guest_exchange_buckets(window_started_at_ms);
CREATE TABLE guest_exchange_bucket_capacity(
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  bucket_count INTEGER NOT NULL CHECK(bucket_count>=0)
);
INSERT INTO guest_exchange_bucket_capacity(singleton,bucket_count) VALUES(1,0);
CREATE TRIGGER guest_exchange_bucket_count_insert AFTER INSERT ON guest_exchange_buckets BEGIN
  UPDATE guest_exchange_bucket_capacity SET bucket_count=bucket_count+1 WHERE singleton=1;
END;
CREATE TRIGGER guest_exchange_bucket_count_delete AFTER DELETE ON guest_exchange_buckets BEGIN
  UPDATE guest_exchange_bucket_capacity SET bucket_count=bucket_count-1 WHERE singleton=1;
END;
