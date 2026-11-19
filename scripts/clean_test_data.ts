import { db } from "../shared/src/db.js";
import { sql } from "drizzle-orm";

interface CleanReport {
  aiAnalysesDeleted: number;
  incidentsDeleted: number;
  statusHistoryDeleted: number;
  hourlyLogDeleted: number;
  hourlyPingDeleted: number;
  logEventsDeleted: number;
  devicesDeleted: number;
  usersDeleted: number;
  durationMs: number;
}

export async function cleanTestData(dryRun = false): Promise<CleanReport> {
  const startTime = Date.now();
  console.log(`=== PEMBERSIHAN DATA UJI JAGALOG (${dryRun ? "DRY-RUN" : "APPLY"}) ===`);

  // 1. Identifikasi perangkat uji
  const testDeviceNames = [
    "Test-Local-Collector-Device",
    "Perangkat-Simulasi-Serangan",
    "E2E-MikroTik-Router-1793670295220",
    "E2E-MikroTik-Router-1793670312539",
    "Device-Verify-Test",
  ];

  const targetDevices = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM devices WHERE name IN (${sql.join(testDeviceNames.map(n => sql`${n}`), sql`, `)})
  `);

  const targetDeviceIds = targetDevices.map((d) => d.id);
  console.log(`Ditemukan ${targetDeviceIds.length} perangkat uji:`, targetDevices.map(d => d.name));

  if (targetDeviceIds.length === 0) {
    console.log("Tidak ada perangkat uji yang ditemukan.");
    return {
      aiAnalysesDeleted: 0,
      incidentsDeleted: 0,
      statusHistoryDeleted: 0,
      hourlyLogDeleted: 0,
      hourlyPingDeleted: 0,
      logEventsDeleted: 0,
      devicesDeleted: 0,
      usersDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const idsSql = sql.join(targetDeviceIds.map(id => sql`${id}::uuid`), sql`, `);

  // Hitung jumlah relasi yang akan dibersihkan
  const [aiCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM ai_analyses WHERE device_id IN (${idsSql})
  `);
  const [incCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM incidents WHERE device_id IN (${idsSql})
  `);
  const [histCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM device_status_history WHERE device_id IN (${idsSql})
  `);
  const [hourlyLogCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM device_log_hourly WHERE device_id IN (${idsSql})
  `);
  const [hourlyPingCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM device_ping_hourly WHERE device_id IN (${idsSql})
  `);
  const [logCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM log_events WHERE device_id IN (${idsSql})
  `);
  const [userCount] = await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) as cnt FROM users WHERE username = 'test_viewer_verify'
  `);

  console.log(`[Rencana Penghapusan]`);
  console.log(`- ai_analyses: ${aiCount.cnt} baris`);
  console.log(`- incidents: ${incCount.cnt} baris`);
  console.log(`- device_status_history: ${histCount.cnt} baris`);
  console.log(`- device_log_hourly: ${hourlyLogCount.cnt} baris`);
  console.log(`- device_ping_hourly: ${hourlyPingCount.cnt} baris`);
  console.log(`- log_events: ${logCount.cnt} baris`);
  console.log(`- devices: ${targetDeviceIds.length} baris`);
  console.log(`- users (test_viewer_verify): ${userCount.cnt} baris`);

  if (dryRun) {
    console.log("Mode DRY-RUN selesai. Tidak ada baris yang dihapus.");
    return {
      aiAnalysesDeleted: Number(aiCount.cnt),
      incidentsDeleted: Number(incCount.cnt),
      statusHistoryDeleted: Number(histCount.cnt),
      hourlyLogDeleted: Number(hourlyLogCount.cnt),
      hourlyPingDeleted: Number(hourlyPingCount.cnt),
      logEventsDeleted: Number(logCount.cnt),
      devicesDeleted: targetDeviceIds.length,
      usersDeleted: Number(userCount.cnt),
      durationMs: Date.now() - startTime,
    };
  }

  // EKSEKUSI DATA CLEANUP DENGAN BATCH & RELASI (Anak -> Induk)
  // 1. ai_analyses
  await db.execute(sql`
    DELETE FROM ai_analyses WHERE device_id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${aiCount.cnt} baris ai_analyses`);

  // 2. incidents
  await db.execute(sql`
    DELETE FROM incidents WHERE device_id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${incCount.cnt} baris incidents`);

  // 3. device_status_history
  await db.execute(sql`
    DELETE FROM device_status_history WHERE device_id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${histCount.cnt} baris device_status_history`);

  // 4. device_log_hourly & device_ping_hourly
  await db.execute(sql`
    DELETE FROM device_log_hourly WHERE device_id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${hourlyLogCount.cnt} baris device_log_hourly`);
  await db.execute(sql`
    DELETE FROM device_ping_hourly WHERE device_id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${hourlyPingCount.cnt} baris device_ping_hourly`);

  // 5. log_events bertahap (batch 5.000 baris)
  console.log(`Menghapus ${logCount.cnt} baris log_events secara bertahap (batch 5.000)...`);
  let totalDeletedLogs = 0;
  const batchSize = 5000;

  while (true) {
    const res = await db.execute<{ deleted_count: string }>(sql`
      WITH deleted AS (
        DELETE FROM log_events
        WHERE id IN (
          SELECT id FROM log_events
          WHERE device_id IN (${idsSql})
          LIMIT ${batchSize}
        )
        RETURNING id
      )
      SELECT COUNT(*) as deleted_count FROM deleted;
    `);

    const deletedInBatch = Number(res[0]?.deleted_count || 0);
    totalDeletedLogs += deletedInBatch;
    if (deletedInBatch > 0) {
      process.stdout.write(`\rProgres log_events: ${totalDeletedLogs} / ${logCount.cnt} baris terhapus...`);
    }
    if (deletedInBatch === 0) break;
  }
  console.log(`\n✔ Selesai menghapus ${totalDeletedLogs} baris log_events.`);

  // 6. devices
  await db.execute(sql`
    DELETE FROM devices WHERE id IN (${idsSql})
  `);
  console.log(`✔ Dihapus ${targetDeviceIds.length} perangkat uji.`);

  // 7. user test_viewer_verify
  await db.execute(sql`
    DELETE FROM users WHERE username = 'test_viewer_verify'
  `);
  console.log(`✔ Dihapus user test_viewer_verify.`);

  // 8. Reclaim storage dengan VACUUM (ANALYZE) dan VACUUM FULL
  console.log("Menjalankan VACUUM (ANALYZE)...");
  await db.execute(sql`VACUUM (ANALYZE) log_events;`);
  await db.execute(sql`VACUUM (ANALYZE) incidents;`);
  await db.execute(sql`VACUUM (ANALYZE) device_status_history;`);
  await db.execute(sql`VACUUM (ANALYZE) devices;`);

  console.log("Menjalankan VACUUM FULL log_events untuk mengembalikan ruang disk fisik...");
  await db.execute(sql`VACUUM FULL log_events;`);
  console.log("✔ VACUUM FULL log_events selesai.");

  const totalDuration = Date.now() - startTime;
  console.log(`Pembersihan database selesai dalam ${(totalDuration / 1000).toFixed(2)} detik.`);

  return {
    aiAnalysesDeleted: Number(aiCount.cnt),
    incidentsDeleted: Number(incCount.cnt),
    statusHistoryDeleted: Number(histCount.cnt),
    hourlyLogDeleted: Number(hourlyLogCount.cnt),
    hourlyPingDeleted: Number(hourlyPingCount.cnt),
    logEventsDeleted: totalDeletedLogs,
    devicesDeleted: targetDeviceIds.length,
    usersDeleted: Number(userCount.cnt),
    durationMs: totalDuration,
  };
}

// Menjalankan skrip jika dieksekusi langsung
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.endsWith("clean_test_data.ts")) {
  const isApply = process.argv.includes("--apply");
  cleanTestData(!isApply)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Gagal membersihkan data uji:", err);
      process.exit(1);
    });
}
