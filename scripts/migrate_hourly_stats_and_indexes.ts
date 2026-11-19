import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("=== Memulai Migrasi Aditif Schema & Agregasi Hourly Log ===");

  try {
    // 1. Tambah kolom severity ke device_log_hourly jika belum ada
    console.log("1. Menambahkan kolom severity ke device_log_hourly...");
    await db.execute(sql`
      ALTER TABLE device_log_hourly
        ADD COLUMN IF NOT EXISTS severity_critical integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS severity_error integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS severity_warning integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS severity_notice integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS severity_info integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS severity_debug integer NOT NULL DEFAULT 0;
    `);

    // 2. Buat index hour_bucket pada device_log_hourly jika belum ada
    console.log("2. Menambahkan indeks hour_bucket pada device_log_hourly...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_dev_log_hourly_hour ON device_log_hourly (hour_bucket DESC);
    `);

    // 3. Buat indeks ekspresi untuk top IP dan aktor jika belum ada
    console.log("3. Menambahkan indeks ekspresi untuk top IP dan aktor...");
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_log_events_src_ip 
        ON log_events (device_id, ((parsed->>'src_ip'))) 
        WHERE (parsed->>'src_ip') IS NOT NULL;
      
      CREATE INDEX IF NOT EXISTS idx_log_events_actor 
        ON log_events (device_id, ((parsed->>'actor'))) 
        WHERE (parsed->>'actor') IS NOT NULL;
    `);

    // 4. Backfill data dari log_events ke device_log_hourly
    console.log("4. Melakukan backfill dari log_events ke device_log_hourly...");
    const backfillResult = await db.execute(sql`
      INSERT INTO device_log_hourly (
        device_id,
        hour_bucket,
        received_count,
        stored_count,
        dropped_count,
        max_gap_seconds,
        last_log_at,
        updated_at,
        severity_critical,
        severity_error,
        severity_warning,
        severity_notice,
        severity_info,
        severity_debug
      )
      SELECT
        device_id,
        date_trunc('hour', event_time AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta' as hour_bucket,
        SUM(COALESCE(repeat_count, 1))::int as received_count,
        COUNT(*)::int as stored_count,
        0 as dropped_count,
        0 as max_gap_seconds,
        MAX(event_time) as last_log_at,
        NOW() as updated_at,
        SUM(CASE WHEN severity <= 2 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_critical,
        SUM(CASE WHEN severity = 3 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_error,
        SUM(CASE WHEN severity = 4 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_warning,
        SUM(CASE WHEN severity = 5 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_notice,
        SUM(CASE WHEN severity = 6 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_info,
        SUM(CASE WHEN severity >= 7 THEN COALESCE(repeat_count, 1) ELSE 0 END)::int as severity_debug
      FROM log_events
      GROUP BY device_id, date_trunc('hour', event_time AT TIME ZONE 'Asia/Jakarta')
      ON CONFLICT (device_id, hour_bucket) DO UPDATE SET
        received_count = GREATEST(device_log_hourly.received_count, EXCLUDED.received_count),
        stored_count = GREATEST(device_log_hourly.stored_count, EXCLUDED.stored_count),
        severity_critical = GREATEST(device_log_hourly.severity_critical, EXCLUDED.severity_critical),
        severity_error = GREATEST(device_log_hourly.severity_error, EXCLUDED.severity_error),
        severity_warning = GREATEST(device_log_hourly.severity_warning, EXCLUDED.severity_warning),
        severity_notice = GREATEST(device_log_hourly.severity_notice, EXCLUDED.severity_notice),
        severity_info = GREATEST(device_log_hourly.severity_info, EXCLUDED.severity_info),
        severity_debug = GREATEST(device_log_hourly.severity_debug, EXCLUDED.severity_debug),
        last_log_at = GREATEST(device_log_hourly.last_log_at, EXCLUDED.last_log_at),
        updated_at = NOW();
    `);
    console.log("   Backfill selesai.");

    // 5. VACUUM ANALYZE
    console.log("5. Menjalankan VACUUM ANALYZE pada tabel terdampak...");
    await db.execute(sql`VACUUM ANALYZE device_log_hourly;`);
    await db.execute(sql`VACUUM ANALYZE log_events;`);

    console.log("=== Migrasi Berhasil Selesai 100% ===");
    process.exit(0);
  } catch (err) {
    console.error("Gagal melakukan migrasi:", err);
    process.exit(1);
  }
}

runMigration();

