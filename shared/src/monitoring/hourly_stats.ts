import { db } from "../db";
import { devicePingHourly, deviceLogHourly } from "../schema";
import { sql } from "drizzle-orm";

/**
 * Catat statistik batch log per jam ke tabel device_log_hourly.
 * Memperhitungkan SEMUA pesan diterima, termasuk yang digabung atau dibuang.
 */
export async function recordHourlyLogBatch(
  batches: Array<{
    deviceId: string;
    timestamp: Date;
    received: number;
    stored: number;
    dropped: number;
    severityCritical?: number;
    severityError?: number;
    severityWarning?: number;
    severityNotice?: number;
    severityInfo?: number;
    severityDebug?: number;
  }>
): Promise<void> {
  if (batches.length === 0) return;

  // Agregasi per (deviceId, hourBucket) di memori terlebih dahulu
  const aggregated = new Map<
    string,
    {
      deviceId: string;
      hourBucketStr: string;
      received: number;
      stored: number;
      dropped: number;
      severityCritical: number;
      severityError: number;
      severityWarning: number;
      severityNotice: number;
      severityInfo: number;
      severityDebug: number;
      lastLogAt: Date;
    }
  >();

  for (const b of batches) {
    // Truncate ke jam dalam zona waktu WIB (Asia/Jakarta)
    const d = new Date(b.timestamp);
    d.setMinutes(0, 0, 0);
    const hourBucketStr = d.toISOString();
    const key = `${b.deviceId}:${hourBucketStr}`;

    const existing = aggregated.get(key);
    if (existing) {
      existing.received += b.received;
      existing.stored += b.stored;
      existing.dropped += b.dropped;
      existing.severityCritical += b.severityCritical || 0;
      existing.severityError += b.severityError || 0;
      existing.severityWarning += b.severityWarning || 0;
      existing.severityNotice += b.severityNotice || 0;
      existing.severityInfo += b.severityInfo || 0;
      existing.severityDebug += b.severityDebug || 0;
      if (b.timestamp > existing.lastLogAt) {
        existing.lastLogAt = b.timestamp;
      }
    } else {
      aggregated.set(key, {
        deviceId: b.deviceId,
        hourBucketStr,
        received: b.received,
        stored: b.stored,
        dropped: b.dropped,
        severityCritical: b.severityCritical || 0,
        severityError: b.severityError || 0,
        severityWarning: b.severityWarning || 0,
        severityNotice: b.severityNotice || 0,
        severityInfo: b.severityInfo || 0,
        severityDebug: b.severityDebug || 0,
        lastLogAt: b.timestamp,
      });
    }
  }

  for (const item of Array.from(aggregated.values())) {
    try {
      await db.execute(sql`
        INSERT INTO device_log_hourly (
          device_id,
          hour_bucket,
          received_count,
          stored_count,
          dropped_count,
          severity_critical,
          severity_error,
          severity_warning,
          severity_notice,
          severity_info,
          severity_debug,
          max_gap_seconds,
          last_log_at,
          updated_at
        ) VALUES (
          ${item.deviceId}::uuid,
          ${item.hourBucketStr}::timestamptz,
          ${item.received},
          ${item.stored},
          ${item.dropped},
          ${item.severityCritical},
          ${item.severityError},
          ${item.severityWarning},
          ${item.severityNotice},
          ${item.severityInfo},
          ${item.severityDebug},
          0,
          ${item.lastLogAt.toISOString()}::timestamptz,
          now()
        )
        ON CONFLICT (device_id, hour_bucket) DO UPDATE SET
          received_count = device_log_hourly.received_count + EXCLUDED.received_count,
          stored_count = device_log_hourly.stored_count + EXCLUDED.stored_count,
          dropped_count = device_log_hourly.dropped_count + EXCLUDED.dropped_count,
          severity_critical = device_log_hourly.severity_critical + EXCLUDED.severity_critical,
          severity_error = device_log_hourly.severity_error + EXCLUDED.severity_error,
          severity_warning = device_log_hourly.severity_warning + EXCLUDED.severity_warning,
          severity_notice = device_log_hourly.severity_notice + EXCLUDED.severity_notice,
          severity_info = device_log_hourly.severity_info + EXCLUDED.severity_info,
          severity_debug = device_log_hourly.severity_debug + EXCLUDED.severity_debug,
          last_log_at = GREATEST(device_log_hourly.last_log_at, EXCLUDED.last_log_at),
          updated_at = now();
      `);
    } catch (err: any) {
      if (err?.code === "23503") {
        // Perangkat tidak ditemukan atau telah dihapus, abaikan secara aman
        continue;
      }
      console.error("[HourlyLogStats Error]", err);
    }
  }
}

/**
 * Catat hasil cek ping per jam ke tabel device_ping_hourly.
 */
export async function recordHourlyPingResults(
  results: Array<{
    deviceId: string;
    timestamp: Date;
    isAlive: boolean;
    latencyMs: number | null;
    isRto: boolean;
    rtoSeconds?: number;
  }>
): Promise<void> {
  if (results.length === 0) return;

  for (const r of results) {
    const d = new Date(r.timestamp);
    d.setMinutes(0, 0, 0);
    const hourBucketStr = d.toISOString();

    const successAdd = r.isAlive ? 1 : 0;
    const failAdd = r.isAlive ? 0 : 1;
    const rtoSec = r.rtoSeconds || (r.isRto ? 30 : 0);

    try {
      await db.execute(sql`
        INSERT INTO device_ping_hourly (
          device_id,
          hour_bucket,
          check_count,
          success_count,
          fail_count,
          max_consecutive_rto_seconds,
          avg_latency_ms,
          updated_at
        ) VALUES (
          ${r.deviceId}::uuid,
          ${hourBucketStr}::timestamptz,
          1,
          ${successAdd},
          ${failAdd},
          ${rtoSec},
          ${r.latencyMs},
          now()
        )
        ON CONFLICT (device_id, hour_bucket) DO UPDATE SET
          check_count = device_ping_hourly.check_count + 1,
          success_count = device_ping_hourly.success_count + ${successAdd},
          fail_count = device_ping_hourly.fail_count + ${failAdd},
          max_consecutive_rto_seconds = GREATEST(device_ping_hourly.max_consecutive_rto_seconds, ${rtoSec}),
          avg_latency_ms = CASE
            WHEN ${r.latencyMs}::int IS NOT NULL THEN
              COALESCE(
                (COALESCE(device_ping_hourly.avg_latency_ms, 0) * device_ping_hourly.success_count + ${r.latencyMs}::int)
                / NULLIF(device_ping_hourly.success_count + ${successAdd}, 0),
                ${r.latencyMs}::int
              )
            ELSE device_ping_hourly.avg_latency_ms
          END,
          updated_at = now();
      `);
    } catch (err) {
      console.error("[HourlyPingStats Error]", err);
    }
  }
}
