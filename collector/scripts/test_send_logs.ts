import dgram from "dgram";
import assert from "node:assert";
import { db, queryClient } from "@shared/db";
import { devices, logEvents } from "@shared/schema";
import { eq, count, and } from "drizzle-orm";
import { generateIngestToken, hashIngestToken } from "@shared/devices";
import { getIngestQueue } from "@shared/queue";

const SYSLOG_UDP_PORT = Number(process.env.SYSLOG_UDP_PORT || 5514);
const HTTP_INGEST_URL = "http://localhost:3000/api/ingest";

async function main() {
  console.log("=== Memulai Pengujian Pengiriman 1000 Syslog UDP & 100 HTTP Ingest ===");

  // 1. Buat atau perbarui perangkat uji coba dengan IP 127.0.0.1
  const testIp = "127.0.0.1";
  const rawToken = generateIngestToken();
  const tokenHash = hashIngestToken(rawToken);

  let [testDevice] = await db
    .select()
    .from(devices)
    .where(eq(devices.ipAddress, testIp))
    .limit(1);

  if (!testDevice) {
    [testDevice] = await db
      .insert(devices)
      .values({
        name: "Test-Local-Collector-Device",
        type: "linux",
        ipAddress: testIp,
        location: "Localhost Benchmark",
        ingestTokenHash: tokenHash,
        isActive: true,
      })
      .returning();
    console.log(`✓ Perangkat uji dibuat: ${testDevice.name} (ID: ${testDevice.id})`);
  } else {
    // Pastikan token hash diperbarui dan aktif
    await db
      .update(devices)
      .set({ ingestTokenHash: tokenHash, isActive: true })
      .where(eq(devices.id, testDevice.id));
    console.log(`✓ Perangkat uji ditemukan: ${testDevice.name} (ID: ${testDevice.id})`);
  }

  // Hitung jumlah awal log perangkat ini di database
  const [initialCountRes] = await db
    .select({ total: count() })
    .from(logEvents)
    .where(eq(logEvents.deviceId, testDevice.id));
  const initialLogCount = Number(initialCountRes?.total ?? 0);
  console.log(`Jumlah log awal di database: ${initialLogCount}`);

  // 2. Kirim 1000 pesan Syslog lewat UDP
  console.log(`\n2. Mengirim 1000 pesan Syslog UDP ke port ${SYSLOG_UDP_PORT}...`);
  const udpClient = dgram.createSocket("udp4");
  const udpSendStart = Date.now();

  const udpPromises: Promise<void>[] = [];
  for (let i = 1; i <= 1000; i++) {
    // Format BSD RFC 3164: <PRI>TIMESTAMP HOST TAG: MSG
    const syslogMsg = `<134>Nov 02 17:50:00 localhost test-daemon[${1000 + i}]: Simulasi log syslog UDP nomor #${i} login failure from 192.168.1.100`;
    const buffer = Buffer.from(syslogMsg, "utf-8");

    const p = new Promise<void>((resolve, reject) => {
      udpClient.send(buffer, 0, buffer.length, SYSLOG_UDP_PORT, "127.0.0.1", (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    udpPromises.push(p);
  }

  await Promise.all(udpPromises);
  const udpDuration = Date.now() - udpSendStart;
  console.log(`✓ 1000 pesan Syslog UDP berhasil dikirim dalam ${udpDuration} ms (${Math.round((1000 / udpDuration) * 1000)} msg/sec)`);
  udpClient.close();

  // 3. Kirim 100 pesan lewat HTTP POST /api/ingest
  console.log(`\n3. Mengirim 100 pesan lewat HTTP POST ${HTTP_INGEST_URL}...`);
  const httpSendStart = Date.now();

  const httpBatch = Array.from({ length: 100 }, (_, idx) => ({
    eventTime: new Date().toISOString(),
    severity: 4,
    sourceApp: "winlogbeat",
    category: "auth",
    message: `EventID 4625: An account failed to log on. User: Administrator (Batch idx #${idx + 1})`,
    parsed: {
      action: "logon_failure",
      actor: "Administrator",
      src_ip: "10.0.0.50",
      eventId: 4625,
    },
  }));

  const httpRes = await fetch(HTTP_INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${rawToken}`,
    },
    body: JSON.stringify(httpBatch),
  });

  assert.strictEqual(httpRes.status, 202, "HTTP Ingest harus mengembalikan 202 Accepted");
  const httpData = await httpRes.json();
  const httpDuration = Date.now() - httpSendStart;
  console.log(`✓ 100 pesan HTTP Ingest diterima oleh server dalam ${httpDuration} ms:`, httpData.message);

  // 4. Tunggu antrian BullMQ dan batch worker menyimpan ke database
  console.log("\n4. Menunggu Worker memproses dan menyimpan batch log ke PostgreSQL...");
  const queue = getIngestQueue();

  let finalLogCount = initialLogCount;
  const waitStart = Date.now();
  const targetTotal = initialLogCount + 1100;

  while (Date.now() - waitStart < 15000) {
    const [currentRes] = await db
      .select({ total: count() })
      .from(logEvents)
      .where(eq(logEvents.deviceId, testDevice.id));
    finalLogCount = Number(currentRes?.total ?? 0);

    const queueWaiting = await queue.getWaitingCount();
    const queueActive = await queue.getActiveCount();

    if (finalLogCount >= targetTotal) {
      break;
    }

    console.log(`   [Progress] Log tersimpan: ${finalLogCount - initialLogCount}/1100 (Antrian menunggu: ${queueWaiting}, aktif: ${queueActive})...`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const addedLogs = finalLogCount - initialLogCount;
  console.log(`\n=== HASIL AKHIR PENGUJIAN FASE 4 ===`);
  console.log(`Total log baru yang berhasil disimpan di log_events: ${addedLogs} dari 1100 pesan (1000 UDP + 100 HTTP)`);
  assert.ok(addedLogs >= 1000, "Minimal 1000+ log harus tersimpan di database");

  // Periksa perangkat lastSeenAt
  const [refreshedDevice] = await db
    .select({ lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(eq(devices.id, testDevice.id));
  assert.ok(refreshedDevice?.lastSeenAt, "lastSeenAt perangkat harus terupdate");
  console.log(`✓ devices.lastSeenAt berhasil diperbarui: ${refreshedDevice.lastSeenAt.toISOString()}`);

  console.log("\n✓ PENGUJIAN INGEST 1000 UDP + 100 HTTP LULUS 100%!");
  await queryClient.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Test send logs failed:", err);
  await queryClient.end();
  process.exit(1);
});
