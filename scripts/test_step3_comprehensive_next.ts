import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:3000";

async function runStep3ComprehensiveTest() {
  console.log("=== MEMULAI PENGUJIAN LANGKAH 3 (KOMPREHENSIF) ===");

  // 1. Login Admin
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.equal(loginRes.status, 200, "Admin login harus berhasil");
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(cookie.includes("jagalog_session"), "Cookie sesi harus ada");
  console.log("✓ Login admin berhasil.");

  // 2. Ambil seluruh perangkat dari database
  const devices = (await db.execute(sql`SELECT id, name, status FROM devices ORDER BY name`)) as any[];
  console.log(`\n2. Menguji seluruh ${devices.length} perangkat armada...`);

  const rentangList = ["24j", "7h", "30h", "90h", "1t", "kustom"];
  const customDari = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().split("T")[0];
  const customSampai = new Date().toISOString().split("T")[0];

  const deviceLatencies: number[] = [];

  for (const dev of devices) {
    for (const rentang of rentangList) {
      const url = new URL(`${BASE_URL}/api/devices/${dev.id}/riwayat-status`);
      url.searchParams.set("rentang", rentang);
      url.searchParams.set("skala", "otomatis");
      if (rentang === "kustom") {
        url.searchParams.set("dari", customDari);
        url.searchParams.set("sampai", customSampai);
      }

      const t0 = performance.now();
      const res = await fetch(url.toString(), {
        headers: { Cookie: cookie },
      });
      const dur = performance.now() - t0;
      deviceLatencies.push(dur);

      assert.equal(res.status, 200, `Perangkat ${dev.name} (${dev.id}) rentang ${rentang} harus 200 OK, got ${res.status}`);
      const data = await res.json();
      assert.ok(Array.isArray(data.slots), `Slots harus array untuk perangkat ${dev.name} rentang ${rentang}`);
      assert.ok(data.slots.length >= 1 && data.slots.length <= 96, `Jumlah slot harus 1-96, got ${data.slots.length}`);
      assert.ok(data.ringkasan, "Ringkasan harus ada");
    }
    console.log(`✓ Perangkat "${dev.name}" lulus pengujian seluruh 6 rentang waktu (24j, 7h, 30h, 90h, 1t, kustom).`);
  }

  // 3. Uji ID perangkat yang tidak ada -> harus 404, BUKAN 500
  console.log("\n3. Menguji perangkat tidak terdaftar (04c4beb0-0ea9-4586-97ef-9272a2f4f337)...");
  const notFoundRes = await fetch(`${BASE_URL}/api/devices/04c4beb0-0ea9-4586-97ef-9272a2f4f337/riwayat-status?rentang=7h&skala=otomatis`, {
    headers: { Cookie: cookie },
  });
  assert.equal(notFoundRes.status, 404, "Perangkat tidak ada harus mengembalikan 404");
  const notFoundJson = await notFoundRes.json();
  assert.equal(notFoundJson.error, "Perangkat tidak ditemukan.");
  assert.ok(notFoundJson.ref_id, "Respons harus menyertakan ref_id");
  console.log(`✓ Endpoint mengembalikan HTTP 404 bersih: "${notFoundJson.error}" (Ref: ${notFoundJson.ref_id}).`);

  // 4. Uji Dashboard API & Invarian C
  console.log("\n4. Menguji Dashboard API dan Invarian Single Source of Truth...");
  const dashLatencies: number[] = [];

  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const dashRes = await fetch(`${BASE_URL}/api/stats/dashboard`, {
      headers: { Cookie: cookie },
    });
    const dur = performance.now() - t0;
    dashLatencies.push(dur);
    assert.equal(dashRes.status, 200, "Dashboard harus 200 OK");
  }

  const dashRes = await fetch(`${BASE_URL}/api/stats/dashboard`, {
    headers: { Cookie: cookie },
  });
  const dash = await dashRes.json();

  // Invarian C.1
  const sumNodeStatus = dash.ringkasanNoc.onlineCount + dash.ringkasanNoc.logStoppedCount + dash.ringkasanNoc.offlineCount + dash.ringkasanNoc.unknownCount;
  assert.equal(sumNodeStatus, dash.ringkasanNoc.totalNodes, "Invarian C.1: total status harus sama dengan totalNodes");
  assert.equal(dash.summary.totalDevicesCount, dash.ringkasanNoc.totalNodes, "Invarian C.1: summary.totalDevicesCount harus sama dengan ringkasanNoc.totalNodes");
  console.log(`✓ Invarian C.1 Lulus: Total Node (${dash.ringkasanNoc.totalNodes}) = Online (${dash.ringkasanNoc.onlineCount}) + Log Berhenti (${dash.ringkasanNoc.logStoppedCount}) + Offline (${dash.ringkasanNoc.offlineCount}) + Belum Ada Data (${dash.ringkasanNoc.unknownCount}).`);

  // Invarian C.2 & C.3
  const incDonutTotal = dash.ringkasanNoc.insiden.total;
  const incSeveritySum = dash.ringkasanNoc.insiden.critical + dash.ringkasanNoc.insiden.high + dash.ringkasanNoc.insiden.medium + dash.ringkasanNoc.insiden.low;
  assert.equal(incSeveritySum, incDonutTotal, "Invarian C.3: rincian severity harus sama dengan total alarm");
  assert.equal(dash.summary.incidentsBySeverity.total, incDonutTotal, "Invarian C.2: summary incidents harus sama dengan ringkasanNoc insiden");
  console.log(`✓ Invarian C.2 & C.3 Lulus: Total Alarm (${incDonutTotal}) = Kritis (${dash.ringkasanNoc.insiden.critical}) + Tinggi (${dash.ringkasanNoc.insiden.high}) + Sedang (${dash.ringkasanNoc.insiden.medium}) + Rendah (${dash.ringkasanNoc.insiden.low}).`);

  // Invarian C.4
  const sumCardLogs = dash.devices.reduce((acc: number, d: any) => acc + (d.logCount24h || 0), 0);
  assert.equal(sumCardLogs, dash.summary.totalLogs24h, "Invarian C.4: total log di kartu harus sama dengan summary.totalLogs24h");
  console.log(`✓ Invarian C.4 Lulus: Total Log 24 Jam di Kartu (${sumCardLogs}) = Total 24 Jam di Ringkasan (${dash.summary.totalLogs24h}).`);

  // Invarian C.5
  assert.equal(dash.ringkasanNoc.heatmap.length, dash.ringkasanNoc.totalNodes, "Invarian C.5: heatmap harus memuat seluruh perangkat");
  console.log(`✓ Invarian C.5 Lulus: Heatmap memuat tepat ${dash.ringkasanNoc.heatmap.length} perangkat (seluruh perangkat terdaftar).`);

  // Invarian C.6
  const areaOnlineSum = dash.areaSummary.reduce((acc: number, a: any) => acc + (a.onlineCount || 0), 0);
  const unassignedOnline = dash.devices.filter((d: any) => !d.groupId && d.status === "online").length;
  assert.equal(areaOnlineSum + unassignedOnline, dash.ringkasanNoc.onlineCount, "Invarian C.6: online per area + tanpa grup harus sama dengan ringkasanNoc.onlineCount");
  console.log(`✓ Invarian C.6 Lulus: Online per area (${areaOnlineSum}) + tanpa grup (${unassignedOnline}) = Donut Online (${dash.ringkasanNoc.onlineCount}).`);

  // 5. Performa p95
  deviceLatencies.sort((a, b) => a - b);
  dashLatencies.sort((a, b) => a - b);
  const p95Dev = deviceLatencies[Math.floor(deviceLatencies.length * 0.95)];
  const p95Dash = dashLatencies[Math.floor(dashLatencies.length * 0.95)];

  console.log("\n5. Pengukuran Latensi Kinerja:");
  console.log(`- Dashboard p95        : ${p95Dash.toFixed(1)} ms (Target < 500 ms) -> ${p95Dash < 500 ? "LULUS ✅" : "GAGAL ❌"}`);
  console.log(`- Detail Perangkat p95 : ${p95Dev.toFixed(1)} ms (Target < 600 ms) -> ${p95Dev < 600 ? "LULUS ✅" : "GAGAL ❌"}`);

  assert.ok(p95Dash < 500, "Dashboard p95 harus < 500 ms");
  assert.ok(p95Dev < 600, "Detail Perangkat p95 harus < 600 ms");

  console.log("\n🎉 SEMUA PENGUJIAN LANGKAH 3 LULUS DENGAN SEMPURNA (100%)!");
  process.exit(0);
}

runStep3ComprehensiveTest().catch((err) => {
  console.error("Test gagal:", err);
  process.exit(1);
});

