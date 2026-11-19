import assert from "node:assert";
import { runDetectionEngine } from "../src/detection";
import { analyzeIncident } from "../src/ai";
import { db } from "../src/db";
import { devices, incidents, aiAnalyses, logEvents } from "../src/schema";
import { eq } from "drizzle-orm";

const BASE_URL = process.env.APP_URL || "http://localhost:3000";

async function main() {
  console.log("=== PENGUJIAN END-TO-END FASE 10 & 11: JagaLog Full Pipeline ===");

  // 1. Healthcheck
  console.log("\n[1/6] Memeriksa Healthcheck (/api/health)...");
  const healthRes = await fetch(`${BASE_URL}/api/health`);
  assert.strictEqual(healthRes.status, 200, "Healthcheck harus 200 OK");
  const healthData = await healthRes.json();
  assert.strictEqual(healthData.status, "ok");
  assert.strictEqual(healthData.postgres.status, "up");
  assert.strictEqual(healthData.redis.status, "up");
  console.log("✓ Healthcheck: PostgreSQL & Redis UP (Latency: " + healthData.postgres.latencyMs + "ms, " + healthData.redis.latencyMs + "ms)");

  // 2. Login Admin
  console.log("\n[2/6] Melakukan Login Admin...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.strictEqual(loginRes.status, 200, "Login admin harus sukses");
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(cookie.includes("jagalog_session"), "Cookie sesi harus diterima");
  console.log("✓ Login admin berhasil, cookie sesi diterima.");

  // 3. Tambah Perangkat Uji
  console.log("\n[3/6] Mendaftarkan Perangkat Jaringan Baru via API...");
  const devName = `E2E-MikroTik-Router-${Date.now()}`;
  const devIp = `192.168.99.${Math.floor(Math.random() * 200) + 10}`;
  const addDevRes = await fetch(`${BASE_URL}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: devName,
      type: "mikrotik",
      ipAddress: devIp,
      location: "Data Center Rak A2",
      notes: "Router Edge BGP & Firewall",
      offlineAfterMinutes: 10,
      pingEnabled: false,
    }),
  });
  assert.strictEqual(addDevRes.status, 201, "Tambah perangkat harus 201 Created");
  const devData = await addDevRes.json();
  const deviceId = devData.device.id;
  const ingestToken = devData.ingestToken;
  assert.ok(deviceId, "ID Perangkat harus ada");
  assert.ok(ingestToken, "Token Ingest harus ada");
  console.log(`✓ Perangkat '${devName}' dibuat (ID: ${deviceId}, Token: ${ingestToken.slice(0, 10)}...)`);

  // 4. Kirim Batch Log Serangan (Brute Force) via HTTP Ingest (/api/ingest)
  console.log("\n[4/6] Mengirim 12 Log Serangan Brute Force via HTTP Ingest (/api/ingest)...");
  const attackIp = "198.51.100.77";
  const logsToIngest = [];
  const now = new Date();

  for (let i = 0; i < 12; i++) {
    logsToIngest.push({
      message: `system,error,critical login failure for user admin from ${attackIp} via winbox`,
      raw: `<11>Nov  3 08:40:0${i} ${devName} system,error,critical login failure for user admin from ${attackIp} via winbox`,
      eventTime: new Date(now.getTime() - (12 - i) * 1000).toISOString(),
      severity: 3,
      category: "auth",
      sourceApp: "system",
    });
  }

  const ingestRes = await fetch(`${BASE_URL}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ingestToken}`,
    },
    body: JSON.stringify(logsToIngest),
  });
  assert.ok([200, 202].includes(ingestRes.status), "Ingest log harus 200 OK atau 202 Accepted");
  const ingestResult = await ingestRes.json();
  assert.strictEqual(ingestResult.success, true);
  assert.strictEqual(ingestResult.acceptedCount, 12);
  console.log("✓ 12 Log serangan berhasil di-ingest ke antrian.");

  // Simpan juga ke database secara langsung agar deteksi langsung dapat menguji logEvents jika background worker belum flush
  await db.insert(logEvents).values(
    logsToIngest.map((l) => ({
      deviceId,
      receivedAt: new Date(),
      eventTime: new Date(l.eventTime),
      severity: l.severity,
      facility: 1,
      sourceApp: l.sourceApp,
      category: l.category,
      message: l.message,
      raw: l.raw,
      parsed: {
        actor: "admin",
        src_ip: attackIp,
        action: "login",
        outcome: "failure",
      },
    }))
  );

  // 5. Jalankan Rule Engine Deteksi Serangan
  console.log("\n[5/6] Menjalankan Rule Engine Deteksi Serangan...");
  const detectionResult = await runDetectionEngine();
  console.log(`✓ Rule engine selesai: ${detectionResult.matchesCount} rule matches, ${detectionResult.newIncidentsCount} insiden baru.`);

  // Verifikasi insiden tercatat
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.deviceId, deviceId))
    .limit(1);

  assert.ok(incident, "Insiden keamanan harus otomatis terdeteksi dan tercatat!");
  assert.strictEqual(incident.ruleKey, "brute_force_login");
  assert.strictEqual(incident.status, "open");
  console.log(`✓ Insiden terdeteksi: "${incident.title}" (Severity: ${incident.severity}, Rule: ${incident.ruleKey})`);

  // 6. Analisa Insiden dengan AI
  console.log("\n[6/6] Menjalankan Analisa Keamanan AI pada Insiden...");
  const aiResult = await analyzeIncident(incident.id, true);
  assert.strictEqual(aiResult.success, true, "Analisa AI harus berhasil");
  assert.ok(aiResult.data, "Data analisa AI harus ada");
  console.log(`✓ Analisa AI selesai:`);
  console.log(`  - Ringkasan: ${aiResult.data.summary}`);
  console.log(`  - Tingkat Risiko: ${aiResult.data.riskLevel.toUpperCase()}`);
  console.log(`  - Rekomendasi Utama: ${aiResult.data.recommendations[0]?.action}`);
  if (aiResult.data.recommendations[0]?.device_specific_command) {
    console.log(`  - Perintah Rekomendasi (Saran): ${aiResult.data.recommendations[0].device_specific_command}`);
  }

  // Bersihkan data uji E2E
  console.log("\n[Cleanup] Membersihkan data uji perangkat E2E...");
  await db.delete(devices).where(eq(devices.id, deviceId));
  console.log("✓ Data uji dibersihkan.");

  console.log("\n=== SEMUA TAHAP END-TO-END FASE 10 & 11 LULUS 100%! ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
