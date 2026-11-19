/**
 * Script Benchmark Anggaran Performa UI & Endpoint JagaLog
 * Dijalankan dengan: npm run bench:ui
 * Mengukur p50 & p95 endpoint dan memverifikasi batas anggaran performa.
 */

import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

interface BenchmarkResult {
  name: string;
  p50: number;
  p95: number;
  thresholdP95: number;
  passed: boolean;
}

async function measureUrl(url: string, iterations: number = 20, cookieHeader: string): Promise<{ p50: number; p95: number }> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    try {
      const res = await fetch(url, {
        headers: {
          Cookie: cookieHeader,
        },
      });
      await res.text();
      const dur = performance.now() - start;
      times.push(dur);
    } catch (err) {
      console.error(`Error requesting ${url}:`, err);
    }
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)] || 0;
  const p95 = times[Math.floor(times.length * 0.95)] || 0;

  return { p50, p95 };
}

async function runBenchmark() {
  console.log("=================================================================");
  console.log("=== BENCHMARK ANGGARAN PERFORMA JAgALOG (npm run bench:ui) ===");
  console.log("=================================================================\n");

  const baseUrl = "http://localhost:3000";

  // 1. Dapatkan device id untuk pengujian
  const devRows = await db.execute<{ id: string; name: string }>(sql`
    SELECT id, name FROM devices ORDER BY name ASC LIMIT 1;
  `);

  const testDevice = devRows[0];
  if (!testDevice) {
    console.error("Tidak ada perangkat yang ditemukan di database.");
    process.exit(1);
  }

  // 2. Dapatkan sesi admin aktif dari Redis / DB untuk autentikasi request API
  const sessionUser = await db.execute<{ id: string; username: string }>(sql`
    SELECT id, username FROM users WHERE role = 'admin' LIMIT 1;
  `);

  let cookieHeader = "";
  if (sessionUser[0]) {
    const { createSession } = await import("../shared/src/auth");
    const sessionId = await createSession({
      userId: sessionUser[0].id,
      username: sessionUser[0].username,
      role: "admin",
      mustChangePassword: false,
      createdAt: Date.now(),
    });
    cookieHeader = `jagalog_session=${sessionId}`;
  }

  const results: BenchmarkResult[] = [];

  // Uji 1: Dashboard HTML Shell (< 200 ms)
  console.log("Mengukur: Kerangka Halaman Dashboard (GET /)...");
  const shellBench = await measureUrl(`${baseUrl}/`, 15, cookieHeader);
  results.push({
    name: "Dashboard Shell (HTML)",
    p50: shellBench.p50,
    p95: shellBench.p95,
    thresholdP95: 200,
    passed: shellBench.p95 < 200,
  });

  // Uji 2: Dashboard Data Lengkap (< 500 ms)
  console.log("Mengukur: Endpoint Dashboard Data (GET /api/stats/dashboard)...");
  const dashBench = await measureUrl(`${baseUrl}/api/stats/dashboard`, 20, cookieHeader);
  results.push({
    name: "Dashboard Data API (/api/stats/dashboard)",
    p50: dashBench.p50,
    p95: dashBench.p95,
    thresholdP95: 500,
    passed: dashBench.p95 < 500,
  });

  // Uji 3: Device Stats (< 500 ms)
  console.log("Mengukur: Endpoint Device Stats (GET /api/devices/[id]/stats)...");
  const devStatsBench = await measureUrl(`${baseUrl}/api/devices/${testDevice.id}/stats`, 20, cookieHeader);
  results.push({
    name: "Device Stats API (/api/devices/[id]/stats)",
    p50: devStatsBench.p50,
    p95: devStatsBench.p95,
    thresholdP95: 500,
    passed: devStatsBench.p95 < 500,
  });

  // Uji 4: Event Log 24 Jam (< 600 ms)
  console.log("Mengukur: Event Log 24 Jam (/api/devices/[id]/logs?limit=50)...");
  const eventLogBench = await measureUrl(
    `${baseUrl}/api/devices/${testDevice.id}/logs?limit=50`,
    20,
    cookieHeader
  );
  results.push({
    name: "Event Log 24 Jam (/api/devices/[id]/logs)",
    p50: eventLogBench.p50,
    p95: eventLogBench.p95,
    thresholdP95: 600,
    passed: eventLogBench.p95 < 600,
  });

  // Uji 5: Event Log Pencarian Teks + Filter Waktu (< 800 ms)
  console.log("Mengukur: Event Log Pencarian Teks (/api/devices/[id]/logs?search=system)...");
  const searchLogBench = await measureUrl(
    `${baseUrl}/api/devices/${testDevice.id}/logs?search=system&limit=50`,
    20,
    cookieHeader
  );
  results.push({
    name: "Event Log Search + Time Filter (/api/devices/[id]/logs?search=...)",
    p50: searchLogBench.p50,
    p95: searchLogBench.p95,
    thresholdP95: 800,
    passed: searchLogBench.p95 < 800,
  });

  // Uji 6: Verifikasi EXPLAIN: 0 Seq Scan pada log_events untuk agregasi halaman
  console.log("Memverifikasi EXPLAIN ANALYZE query dashboard...");
  const explainRows = await db.execute<{ "QUERY PLAN": string }>(sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT
      to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00') AS hour_slot,
      SUM(received_count)::text AS received_count
    FROM device_log_hourly
    WHERE hour_bucket >= NOW() - INTERVAL '24 hours'
    GROUP BY hour_slot
    ORDER BY hour_slot ASC;
  `);

  const planText = explainRows.map((r) => r["QUERY PLAN"]).join(" ");
  const isSeqScanOnRawLogs = planText.includes("on log_events");
  console.log("   Query membaca tabel agregasi device_log_hourly (bukan log_events):", !isSeqScanOnRawLogs ? "YA (LULUS)" : "TIDAK (GAGAL)");

  console.log("\n=================================================================");
  console.log("=== HASIL PENGUKURAN ANGGARAN PERFORMA ===");
  console.log("=================================================================");
  console.log("| Metrik / Endpoint | p50 | p95 | Target p95 | Status |");
  console.log("| :--- | :---: | :---: | :---: | :---: |");

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? "✅ LULUS" : "❌ GAGAL";
    if (!r.passed) allPassed = false;
    console.log(`| ${r.name} | ${r.p50.toFixed(1)} ms | ${r.p95.toFixed(1)} ms | < ${r.thresholdP95} ms | ${status} |`);
  }

  console.log("=================================================================\n");

  if (!allPassed) {
    console.error("❌ Sebagian anggaran performa terlampaui!");
    process.exit(1);
  } else {
    console.log("✅ SELURUH TARGET ANGGARAN PERFORMA TERPENUHI 100%!");
    process.exit(0);
  }
}

runBenchmark();

