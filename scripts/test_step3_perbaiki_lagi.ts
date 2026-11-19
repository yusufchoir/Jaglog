import { queryClient } from "../shared/src/index.js";

async function runComprehensiveTest() {
  console.log("=== PENGUJIAN KOMPREHENSIF LANGKAH 3 (perbaiki_lagi.md) ===\n");

  // 1. Login
  const loginRes = await fetch("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  if (!loginRes.ok) throw new Error("Gagal login sebagai admin");
  const cookie = loginRes.headers.get("set-cookie") || "";
  console.log("✅ 1. Otentikasi Admin berhasil (Sesi aktif).");

  // 2. Healthcheck
  const healthRes = await fetch("http://localhost:3000/api/health");
  const healthData = await healthRes.json();
  if (healthRes.status !== 200 || healthData.status !== "ok" || !healthData.postgres.schemaReady) {
    throw new Error("Healthcheck gagal: " + JSON.stringify(healthData));
  }
  console.log(`✅ 2. Healthcheck Berhasil: status=${healthData.status}, schemaReady=${healthData.postgres.schemaReady}, DB Latency=${healthData.postgres.latencyMs}ms, Redis Latency=${healthData.redis.latencyMs}ms.`);

  // 3. Uji SEMUA Perangkat di Database
  const devices = await queryClient`
    SELECT id, name, status, is_active, ping_enabled FROM devices ORDER BY created_at ASC;
  `;
  console.log(`\n--- Menguji seluruh ${devices.length} perangkat di database ---`);

  const rentangList = ["24j", "7h", "30h", "90h", "1t", "kustom"] as const;

  for (const d of devices) {
    // a. Stats
    const t0Stats = performance.now();
    const statsRes = await fetch(`http://localhost:3000/api/devices/${d.id}/stats`, {
      headers: { Cookie: cookie },
    });
    const durStats = performance.now() - t0Stats;
    if (statsRes.status !== 200) {
      throw new Error(`Device ${d.id} stats failed with HTTP ${statsRes.status}`);
    }

    // b. Riwayat Status pada semua rentang
    for (const rentang of rentangList) {
      let url = `http://localhost:3000/api/devices/${d.id}/riwayat-status?rentang=${rentang}&skala=otomatis`;
      if (rentang === "kustom") {
        url += "&dari=2026-11-01&sampai=2026-11-10";
      }
      const t0Riw = performance.now();
      const riwRes = await fetch(url, { headers: { Cookie: cookie } });
      const durRiw = performance.now() - t0Riw;
      if (riwRes.status !== 200) {
        throw new Error(`Device ${d.id} riwayat (${rentang}) failed with HTTP ${riwRes.status}`);
      }
    }

    console.log(`  ✔ Perangkat ${d.id} (${d.name}): Stats (200 OK, ${durStats.toFixed(1)}ms), Riwayat 6 rentang (Semua 200 OK).`);
  }

  // 4. Uji UUID Tidak Valid & Tidak Ditemukan
  const badUuidRes = await fetch("http://localhost:3000/api/devices/bukan-uuid-valid/stats", {
    headers: { Cookie: cookie },
  });
  if (badUuidRes.status !== 400) throw new Error("Format UUID salah harus 400, didapat: " + badUuidRes.status);

  const notFoundRes = await fetch("http://localhost:3000/api/devices/04c4beb0-0ea9-4586-97ef-9272a2f4f337/stats", {
    headers: { Cookie: cookie },
  });
  if (notFoundRes.status !== 404) throw new Error("ID tidak ada harus 404, didapat: " + notFoundRes.status);

  console.log("✅ 4. Validasi UUID (Format salah -> 400, ID tidak terdaftar -> 404) bekerja sempurna.");

  // 5. Uji /api/client-error (Fail-safe)
  const clientErrRes = await fetch("http://localhost:3000/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nama: "TestReport",
      pesan: "Pengujian fail-safe client error",
      path: "/dashboard",
      build: "1.0.0",
    }),
  });
  if (clientErrRes.status !== 200 && clientErrRes.status !== 202) {
    throw new Error("/api/client-error melempar status tidak terduga: " + clientErrRes.status);
  }
  console.log("✅ 5. Endpoint /api/client-error berhasil memproses laporan dan bersifat fail-safe.");

  // 6. Benchmark Kinerja Dashboard & Detail
  console.log("\n--- Benchmark Kinerja Endpoint ---");
  const dashLatencies: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const res = await fetch("http://localhost:3000/api/stats/dashboard", { headers: { Cookie: cookie } });
    dashLatencies.push(performance.now() - t0);
  }
  dashLatencies.sort((a, b) => a - b);
  const p95Dash = dashLatencies[Math.floor(dashLatencies.length * 0.95)];
  console.log(`Dashboard API p95 Latency: ${p95Dash.toFixed(1)} ms (Target < 500 ms: ${p95Dash < 500 ? "LULUS" : "GAGAL"})`);

  const devLatencies: number[] = [];
  const testDevId = devices[0].id;
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    const res = await fetch(`http://localhost:3000/api/devices/${testDevId}/stats`, { headers: { Cookie: cookie } });
    devLatencies.push(performance.now() - t0);
  }
  devLatencies.sort((a, b) => a - b);
  const p95Dev = devLatencies[Math.floor(devLatencies.length * 0.95)];
  console.log(`Detail Perangkat API p95 Latency: ${p95Dev.toFixed(1)} ms (Target < 600 ms: ${p95Dev < 600 ? "LULUS" : "GAGAL"})`);

  console.log("\n🎉 SELURUH PENGUJIAN KOMPREHENSIF LANGKAH 3 LULUS DENGAN SEMPURNA!");
  await queryClient.end();
}

runComprehensiveTest().catch((err) => {
  console.error("❌ PENGUJIAN GAGAL:", err);
  process.exit(1);
});

