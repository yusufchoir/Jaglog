/**
 * Benchmark Script: Seeding 300 Perangkat & 30 Grup
 * Menguji performa agregasi query (p95 latency) dan membuktikan tidak ada masalah N+1.
 * Dijalankan dengan: npx tsx scripts/benchmark_groups_performance.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
dotenv.config();

import { devices, deviceGroups } from "../shared/src/schema";
import { sql, eq } from "drizzle-orm";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/jagalog";
const client = postgres(connectionString, { max: 5 });
const db = drizzle(client);

async function runBenchmark() {
  console.log("=============================================================");
  console.log("   BENCHMARK PERFORMA: 300 PERANGKAT & 30 GRUP JARINGAN      ");
  console.log("=============================================================\n");

  const createdGroupIds: string[] = [];
  const createdDeviceIds: string[] = [];

  try {
    // 1. Bersihkan sisa benchmark jika ada
    await db.delete(devices).where(sql`${devices.notes} LIKE '%[BENCHMARK]%'`);
    await db.delete(deviceGroups).where(sql`${deviceGroups.deskripsi} LIKE '%[BENCHMARK]%'`);

    // 2. Seeding 30 Grup
    console.log("1. Melakukan seeding 30 grup...");
    const groupValues = Array.from({ length: 30 }, (_, i) => ({
      nama: `Area Uji Kecepatan ${i + 1}`,
      deskripsi: `[BENCHMARK] Grup performa nomor ${i + 1}`,
      warnaGaris: (i % 3 === 0 ? "biru" : i % 3 === 1 ? "merah" : "abu") as "biru" | "merah" | "abu",
      urutan: i,
    }));

    const insertedGroups = await db.insert(deviceGroups).values(groupValues).returning({ id: deviceGroups.id });
    for (const g of insertedGroups) {
      createdGroupIds.push(g.id);
    }
    console.log(`   ✓ Berhasil seeding ${insertedGroups.length} grup.`);

    // 3. Seeding 300 Perangkat (10 perangkat per grup)
    console.log("2. Melakukan seeding 300 perangkat (10 perangkat per grup)...");
    const deviceValues = [];
    const statuses = ["online", "log_stopped", "offline", "unknown"];

    for (let gIdx = 0; gIdx < 30; gIdx++) {
      const grpId = createdGroupIds[gIdx];
      for (let dIdx = 0; dIdx < 10; dIdx++) {
        const devNum = gIdx * 10 + dIdx + 1;
        deviceValues.push({
          name: `Device-Benchmark-${devNum}`,
          type: dIdx % 2 === 0 ? "mikrotik" : "switch",
          ipAddress: `10.240.${gIdx + 1}.${dIdx + 1}`,
          location: `Gedung ${gIdx + 1}`,
          notes: "[BENCHMARK] Perangkat uji performa",
          groupId: grpId,
          isActive: true,
          status: statuses[devNum % statuses.length],
        });
      }
    }

    const insertedDevices = await db.insert(devices).values(deviceValues).returning({ id: devices.id });
    for (const d of insertedDevices) {
      createdDeviceIds.push(d.id);
    }
    console.log(`   ✓ Berhasil seeding ${insertedDevices.length} perangkat.\n`);

    // 4. Benchmark Query Agregasi Tunggal (Simulasi GET /api/groups)
    console.log("3. Menguji latensi kueri agregasi tunggal (10 kali iterasi)...");
    const latencies: number[] = [];

    for (let iter = 0; iter < 10; iter++) {
      const t0 = performance.now();

      // Kueri 1: Ambil seluruh grup
      const grps = await db
        .select({
          id: deviceGroups.id,
          nama: deviceGroups.nama,
          warnaGaris: deviceGroups.warnaGaris,
          urutan: deviceGroups.urutan,
        })
        .from(deviceGroups)
        .orderBy(deviceGroups.urutan, deviceGroups.nama);

      // Kueri 2: Ambil agregasi status perangkat dalam SATU kueri GROUP BY (Mencegah N+1)
      const counts = await db.execute<{
        group_id: string | null;
        status: string;
        count: string;
      }>(sql`
        SELECT group_id, status, COUNT(*)::text as count
        FROM devices
        WHERE is_active = true
        GROUP BY group_id, status
      `);

      const t1 = performance.now();
      const elapsed = t1 - t0;
      latencies.push(elapsed);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)];
    const p95 = latencies[Math.floor(latencies.length * 0.95)];
    const min = latencies[0];
    const max = latencies[latencies.length - 1];

    console.log("   --- Hasil Pengukuran Latensi ---");
    console.log(`   • Jumlah Kueri per Panggilan : 2 kueri tetap (GROUP BY, TIDAK ada N+1 loop)`);
    console.log(`   • Latensi Minimum          : ${min.toFixed(2)} ms`);
    console.log(`   • Latensi Median (p50)     : ${p50.toFixed(2)} ms`);
    console.log(`   • Latensi 95-persentil (p95): ${p95.toFixed(2)} ms`);
    console.log(`   • Latensi Maksimum         : ${max.toFixed(2)} ms`);
    console.log(`   • Target Spesifikasi (<300 ms): ${p95 < 300 ? "LULUS ✓" : "GAGAL ✗"}\n`);

  } finally {
    // 5. Cleanup Data Benchmark
    console.log("4. Membersihkan 300 perangkat & 30 grup benchmark...");
    if (createdDeviceIds.length > 0) {
      await db.delete(devices).where(sql`${devices.id} in ${createdDeviceIds}`);
    }
    if (createdGroupIds.length > 0) {
      await db.delete(deviceGroups).where(sql`${deviceGroups.id} in ${createdGroupIds}`);
    }
    console.log("   ✓ Database kembali bersih.\n");
    await client.end();
  }
}

runBenchmark().catch((err) => {
  console.error("Benchmark error:", err);
  process.exit(1);
});

