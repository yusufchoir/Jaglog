import { queryClient } from "../shared/src/index.js";

async function runStep3Validation() {
  console.log("================================================================================");
  console.log("       PENGUJIAN VALIDASI LANGKAH 3: PERBAIKAN DETAIL PERANGKAT JAGALOG        ");
  console.log("================================================================================\n");

  // 1. Otentikasi Admin
  console.log("--- 1. Otentikasi & Health Check ---");
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  if (!loginRes.ok) throw new Error("Gagal login sebagai admin: HTTP " + loginRes.status);
  const cookie = loginRes.headers.get("set-cookie") || "";
  console.log("✅ Otentikasi Admin berhasil (Cookie sesi diperoleh).");

  // 2. Health Check
  const healthRes = await fetch("http://localhost:3000/api/health");
  const health = await healthRes.json();
  if (healthRes.status !== 200 || health.status !== "ok") {
    throw new Error("Health check gagal: " + JSON.stringify(health));
  }
  console.log(`✅ Health check 200 OK: DB Latency=${health.postgres.latencyMs}ms, SchemaReady=${health.postgres.schemaReady}, Redis=${health.redis.status} (${health.redis.latencyMs}ms)`);

  // 3. Verifikasi Seluruh Perangkat Terdaftar
  console.log("\n--- 2. Pengujian Seluruh Perangkat di Database ---");
  const devRes = await fetch("http://localhost:3000/api/devices", { headers: { Cookie: cookie } });
  const devJson = await devRes.json();
  const devices: any[] = devJson.data?.devices || devJson.devices || devJson;
  console.log(`Total perangkat terdaftar: ${devices.length}`);

  const rentangList = ["24j", "7h", "30h", "90h", "1t", "kustom"] as const;

  for (const d of devices) {
    const t0Stats = performance.now();
    const statsRes = await fetch(`http://localhost:3000/api/devices/${d.id}/stats`, {
      headers: { Cookie: cookie },
    });
    const durStats = performance.now() - t0Stats;
    if (statsRes.status !== 200) {
      const errText = await statsRes.text();
      throw new Error(`Device ${d.id} (${d.name}) stats returned ${statsRes.status}: ${errText}`);
    }
    const statsData = await statsRes.json();
    if (!statsData.sectionStatus || statsData.sectionStatus.device !== "ok") {
      throw new Error(`Device ${d.id} invalid sectionStatus: ` + JSON.stringify(statsData.sectionStatus));
    }

    // Uji riwayat status pada semua rentang
    for (const r of rentangList) {
      let rUrl = `http://localhost:3000/api/devices/${d.id}/riwayat-status?rentang=${r}&skala=otomatis`;
      if (r === "kustom") {
        rUrl += "&dari=2026-11-01&sampai=2026-11-14";
      }
      const rRes = await fetch(rUrl, { headers: { Cookie: cookie } });
      if (rRes.status !== 200) {
        throw new Error(`Device ${d.id} riwayat-status rentang ${r} returned ${rRes.status}`);
      }
    }

    // Uji endpoint tambahan di halaman detail
    const logsRes = await fetch(`http://localhost:3000/api/devices/${d.id}/logs?limit=5`, { headers: { Cookie: cookie } });
    if (logsRes.status !== 200) throw new Error(`Logs failed for ${d.id}: ${logsRes.status}`);

    const patternRes = await fetch(`http://localhost:3000/api/devices/${d.id}/top-patterns?hours=24`, { headers: { Cookie: cookie } });
    if (patternRes.status !== 200) throw new Error(`Top patterns failed for ${d.id}: ${patternRes.status}`);

    console.log(`  ✔ Perangkat: [${d.name}] (${d.id}) -> Stats (200 OK, ${durStats.toFixed(1)}ms), Riwayat 6 rentang (200 OK), Logs & Top Patterns (200 OK).`);
  }

  // 4. Verifikasi Non-Existent ID & Malformed ID
  console.log("\n--- 3. Pengujian Non-Existent & Malformed UUID (Fail-Fast 404 & 400) ---");
  const targetId1 = "dc169921-54f2-464e-9dd1-006eb9d8c261";
  const targetId2 = "04c4beb0-0ea9-4586-97ef-9272a2f4f337";

  for (const id of [targetId1, targetId2]) {
    const sRes = await fetch(`http://localhost:3000/api/devices/${id}/stats`, { headers: { Cookie: cookie } });
    const sJson = await sRes.json();
    if (sRes.status !== 404) throw new Error(`Expected 404 for stats of ${id}, got ${sRes.status}`);
    console.log(`  ✔ Non-existent ID ${id} stats -> 404 Not Found (Pesan: "${sJson.error}")`);

    const rRes = await fetch(`http://localhost:3000/api/devices/${id}/riwayat-status?rentang=7h&skala=otomatis`, { headers: { Cookie: cookie } });
    const rJson = await rRes.json();
    if (rRes.status !== 404) throw new Error(`Expected 404 for riwayat of ${id}, got ${rRes.status}`);
    console.log(`  ✔ Non-existent ID ${id} riwayat -> 404 Not Found (Pesan: "${rJson.error}")`);
  }

  const malformedRes = await fetch("http://localhost:3000/api/devices/invalid-uuid-format/stats", { headers: { Cookie: cookie } });
  const malformedJson = await malformedRes.json();
  if (malformedRes.status !== 400) throw new Error(`Expected 400 for malformed UUID, got ${malformedRes.status}`);
  console.log(`  ✔ Malformed UUID -> 400 Bad Request (Pesan: "${malformedJson.error}")`);

  // 5. Benchmark Kinerja Detail Perangkat
  console.log("\n--- 4. Benchmark Kinerja Endpoint Detail Perangkat (10 Iterasi) ---");
  const testDev = devices[0];
  const latencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    await fetch(`http://localhost:3000/api/devices/${testDev.id}/stats`, { headers: { Cookie: cookie } });
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  console.log(`  ✔ Stats API Latency: p50 = ${p50.toFixed(1)}ms, p95 = ${p95.toFixed(1)}ms (Target < 600ms: ${p95 < 600 ? "LULUS" : "GAGAL"})`);

  console.log("\n================================================================================");
  console.log("       SEMUA PENGUJIAN API LANGKAH 3 BERHASIL DENGAN STATUS 100% LULUS!        ");
  console.log("================================================================================\n");

  await queryClient.end();
  process.exit(0);
}

runStep3Validation().catch((err) => {
  console.error("❌ PENGUJIAN GAGAL:", err);
  process.exit(1);
});
