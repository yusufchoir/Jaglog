-- Migration 0004: log_filters, log_top_patterns, repeat_count on log_events
-- Kolom repeat_count dan first_event_time di log_events (deduplikasi)
ALTER TABLE log_events
  ADD COLUMN IF NOT EXISTS repeat_count integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS first_event_time timestamptz;

-- Tabel log_filters
CREATE TABLE IF NOT EXISTS log_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
  name varchar(150) NOT NULL,
  match_type varchar(20) NOT NULL DEFAULT 'contains',
  pattern text NOT NULL,
  action varchar(20) NOT NULL DEFAULT 'discard',
  is_active boolean NOT NULL DEFAULT true,
  match_count bigint NOT NULL DEFAULT 0,
  last_matched_at timestamptz,
  created_by varchar(50) NOT NULL DEFAULT 'system',
  is_system_suggested boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_filters_device_active ON log_filters (device_id, is_active);
CREATE INDEX IF NOT EXISTS idx_log_filters_active ON log_filters (is_active);

-- Tabel log_top_patterns
CREATE TABLE IF NOT EXISTS log_top_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hour_bucket timestamptz NOT NULL,
  normalized_message text NOT NULL,
  example_message text,
  count integer NOT NULL DEFAULT 0,
  min_severity smallint,
  max_severity smallint,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_log_top_patterns_device_hour ON log_top_patterns (device_id, hour_bucket DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_log_top_patterns_device_hour_msg ON log_top_patterns (device_id, hour_bucket, normalized_message);

-- Seed filter sistem yang disarankan (nonaktif secara default)
-- Filter untuk pola MikroTik fetch loop
INSERT INTO log_filters (name, device_id, match_type, pattern, action, is_active, is_system_suggested, created_by, description)
VALUES
  ('Loop Fetch MikroTik — Download FINISHED', NULL, 'contains', 'Download from', 'merge', false, true, 'system',
   'Pola umum: MikroTik mengirim log "Download from <domain> FINISHED" berulang karena script /tool fetch berjalan terus-menerus. Aktifkan filter ini untuk menggabungkan pesan berulang.'),
  ('Loop Fetch MikroTik — Upload FINISHED', NULL, 'contains', 'Upload to', 'merge', false, true, 'system',
   'Pola umum: Loop fetch upload dari MikroTik. Gabungkan pesan berulang.')
ON CONFLICT DO NOTHING;
