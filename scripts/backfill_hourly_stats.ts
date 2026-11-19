import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function runBackfill() {
  console.log("=== MEMULAI BACKFILL AGREGASI HOURLY (AMAN & IDEMPOTEN) ===");
  const startTime = Date.now();

  // 1. Ambil seluruh data log mentah yang ada di log_events per jam per perangkat
  console.log("1. Menganalisis log_events per (device_id, jam)...");
  const hourlyAggs = (await db.execute<{
    device_id: string;
    hour_bucket: string;
    cnt: string;
    crit: string;
    err: string;
    warn: string;
    notice: string;
    info: string;
    debug: string;
    last_log: string;
  }>(sql`
    SELECT
      device_id,
      date_trunc('hour', event_time) AS hour_bucket,
      COUNT(*)::text AS cnt,
      COUNT(*) FILTER (WHERE severity IN (0, 1, 2))::text AS crit,
      COUNT(*) FILTER (WHERE severity = 3)::text AS err,
      COUNT(*) FILTER (WHERE severity = 4)::text AS warn,
      COUNT(*) FILTER (WHERE severity = 5)::text AS notice,
      COUNT(*) FILTER (WHERE severity = 6)::text AS info,
      COUNT(*) FILTER (WHERE severity = 7)::text AS debug,
      MAX(event_time)::text AS last_log
    FROM log_events
    GROUP BY device_id, date_trunc('hour', event_time)
    ORDER BY hour_bucket ASC
  `)) as any[];

  console.log(`Ditemukan ${hourlyAggs.length} slot jam dari data mentah log_events.`);

  let insertedCount = 0;
  for (const row of hourlyAggs) {
    const received = parseInt(row.cnt, 10) || 0;
    const crit = parseInt(row.crit, 10) || 0;
    const err = parseInt(row.err, 10) || 0;
    const warn = parseInt(row.warn, 10) || 0;
    const notc = parseInt(row.notice, 10) || 0;
    const inf = parseInt(row.info, 10) || 0;
    const dbg = parseInt(row.debug, 10) || 0;

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
        ${row.device_id}::uuid,
        ${row.hour_bucket}::timestamptz,
        ${received},
        ${received},
        0,
        ${crit},
        ${err},
        ${warn},
        ${notc},
        ${inf},
        ${dbg},
        0,
        ${row.last_log}::timestamptz,
        now()
      )
      ON CONFLICT (device_id, hour_bucket) DO UPDATE SET
        received_count = GREATEST(device_log_hourly.received_count, EXCLUDED.received_count),
        stored_count = GREATEST(device_log_hourly.stored_count, EXCLUDED.stored_count),
        severity_critical = EXCLUDED.severity_critical,
        severity_error = EXCLUDED.severity_error,
        severity_warning = EXCLUDED.severity_warning,
        severity_notice = EXCLUDED.severity_notice,
        severity_info = EXCLUDED.severity_info,
        severity_debug = EXCLUDED.severity_debug,
        last_log_at = GREATEST(device_log_hourly.last_log_at, EXCLUDED.last_log_at),
        updated_at = now();
    `);
    insertedCount++;
  }

  console.log(`✓ Berhasil mem-backfill / menyinkronkan ${insertedCount} entri ke device_log_hourly.`);

  // 2. Verifikasi kesesuaian angka (Uji Pencocokan)
  console.log("\n2. Menjalankan Uji Pencocokan (log mentah vs agregasi hourly)...");
  const mismatchRows = (await db.execute(sql`
    WITH raw_counts AS (
      SELECT
        device_id,
        date_trunc('hour', event_time) AS hour_bucket,
        COUNT(*) as total_raw
      FROM log_events
      GROUP BY device_id, date_trunc('hour', event_time)
    )
    SELECT
      r.device_id,
      r.hour_bucket,
      r.total_raw,
      COALESCE(h.received_count, 0) as agg_count
    FROM raw_counts r
    LEFT JOIN device_log_hourly h ON r.device_id = h.device_id AND r.hour_bucket = h.hour_bucket
    WHERE r.total_raw != COALESCE(h.received_count, 0);
  `)) as any[];

  if (mismatchRows.length > 0) {
    console.error("❌ Ditemukan ketidakcocokan data:", mismatchRows);
    process.exit(1);
  } else {
    console.log("✓ Uji Pencocokan 100% Cocok! Angka agregasi SAMA PERSIS dengan log mentah.");
  }

  const duration = Date.now() - startTime;
  console.log(`=== BACKFILL SELESAI DALAM ${duration} ms ===`);
  process.exit(0);
}

runBackfill().catch((err) => {
  console.error("Backfill gagal:", err);
  process.exit(1);
});

