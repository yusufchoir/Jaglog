-- Migration 0005: device_ping_hourly & device_log_hourly

CREATE TABLE IF NOT EXISTS device_ping_hourly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_bucket timestamptz NOT NULL,
  check_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  max_consecutive_rto_seconds integer NOT NULL DEFAULT 0,
  avg_latency_ms integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_ping_hourly_dev_hour ON device_ping_hourly (device_id, hour_bucket DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_ping_hourly_dev_hour ON device_ping_hourly (device_id, hour_bucket);

CREATE TABLE IF NOT EXISTS device_log_hourly (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_bucket timestamptz NOT NULL,
  received_count integer NOT NULL DEFAULT 0,
  stored_count integer NOT NULL DEFAULT 0,
  dropped_count integer NOT NULL DEFAULT 0,
  max_gap_seconds integer NOT NULL DEFAULT 0,
  last_log_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dev_log_hourly_dev_hour ON device_log_hourly (device_id, hour_bucket DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dev_log_hourly_dev_hour ON device_log_hourly (device_id, hour_bucket);

-- Backfill data awal device_log_hourly dari log_events yang sudah ada dalam 30 hari
INSERT INTO device_log_hourly (device_id, hour_bucket, received_count, stored_count, dropped_count, max_gap_seconds, last_log_at, updated_at)
SELECT
  device_id,
  date_trunc('hour', event_time AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta' as hour_bucket,
  COALESCE(SUM(repeat_count), COUNT(*))::int as received_count,
  COALESCE(SUM(repeat_count), COUNT(*))::int as stored_count,
  0 as dropped_count,
  0 as max_gap_seconds,
  MAX(event_time) as last_log_at,
  now() as updated_at
FROM log_events
WHERE event_time >= NOW() - INTERVAL '30 days'
GROUP BY device_id, date_trunc('hour', event_time AT TIME ZONE 'Asia/Jakarta')
ON CONFLICT (device_id, hour_bucket) DO NOTHING;
