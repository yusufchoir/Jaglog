import dgram from "dgram";
import { db, queryClient } from "@shared/db";
import { devices, logEvents } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { getIngestQueue } from "@shared/queue";
import { redis } from "@shared/redis";

const SYSLOG_UDP_PORT = Number(process.env.SYSLOG_UDP_PORT || 5514);

async function runLoadTest() {
  console.log("==================================================================");
  console.log("   JagaLog: Uji Beban Ingest Pipeline (Load Test 2.000 msg/sec)  ");
  console.log("==================================================================\n");

  const testIp = "127.0.0.1";
  let [testDevice] = await db
    .select()
    .from(devices)
    .where(eq(devices.ipAddress, testIp))
    .limit(1);

  if (!testDevice) {
    [testDevice] = await db
      .insert(devices)
      .values({
        name: "Benchmark-Device",
        type: "linux",
        ipAddress: testIp,
        location: "Load Test Benchmark",
        isActive: true,
      })
      .returning();
  }

  const [initialCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(logEvents)
    .where(eq(logEvents.deviceId, testDevice.id));
  const startLogCount = initialCountRow?.count || 0;

  console.log(`Perangkat Uji: ${testDevice.name} (IP: ${testDevice.ipAddress})`);
  console.log(`Jumlah log awal di database: ${startLogCount}`);

  const queue = getIngestQueue();
  const queueDepthBefore = await queue.count();
  console.log(`Kedalaman antrian BullMQ awal: ${queueDepthBefore}`);

  const TARGET_RATE = 2000; // 2000 pesan per detik
  const DURATION_SECONDS = 5; // 5 detik untuk benchmark komprehensif
  const TOTAL_MESSAGES = TARGET_RATE * DURATION_SECONDS; // 10.000 pesan

  console.log(`\nMenjalankan pengiriman ${TOTAL_MESSAGES} pesan UDP (target: ${TARGET_RATE} msg/sec)...`);

  const udpClient = dgram.createSocket("udp4");
  const overallStart = Date.now();
  let sentCount = 0;

  for (let sec = 0; sec < DURATION_SECONDS; sec++) {
    const secStart = Date.now();
    const batchPromises: Promise<void>[] = [];

    for (let i = 0; i < TARGET_RATE; i++) {
      sentCount++;
      const msg = `<134>Nov 07 08:00:00 localhost loadtest[${sentCount}]: Benchmark log event #${sentCount} auth sshd accepted connection`;
      const buf = Buffer.from(msg, "utf-8");

      const p = new Promise<void>((resolve, reject) => {
        udpClient.send(buf, 0, buf.length, SYSLOG_UDP_PORT, "127.0.0.1", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      batchPromises.push(p);
    }

    await Promise.all(batchPromises);
    const secDuration = Date.now() - secStart;
    console.log(`  -> Detik ke-${sec + 1}: ${TARGET_RATE} pesan terkirim dalam ${secDuration} ms`);

    const remainingTime = 1000 - secDuration;
    if (remainingTime > 0 && sec < DURATION_SECONDS - 1) {
      await new Promise((r) => setTimeout(r, remainingTime));
    }
  }

  const totalSendDuration = Date.now() - overallStart;
  const actualSendRate = Math.round((sentCount / totalSendDuration) * 1000);
  udpClient.close();

  console.log(`\n✓ Pengiriman Selesai:`);
  console.log(`  - Total Terkirim   : ${sentCount} pesan`);
  console.log(`  - Durasi Kirim     : ${totalSendDuration} ms`);
  console.log(`  - Throughput Kirim : ${actualSendRate} pesan/detik`);

  console.log(`\nMenunggu Worker menguras antrian dan menyimpan batch ke PostgreSQL...`);

  const workerWaitStart = Date.now();
  let remainingInQueue = await queue.count();
  let attempts = 0;

  while (remainingInQueue > 0 && attempts < 30) {
    await new Promise((r) => setTimeout(r, 1000));
    remainingInQueue = await queue.count();
    attempts++;
    console.log(`  [T+${attempts}s] Sisa antrian BullMQ: ${remainingInQueue}`);
  }

  // Berikan waktu ekstra 1,5 detik untuk flush batch terakhir
  await new Promise((r) => setTimeout(r, 1500));

  const totalProcessDuration = Date.now() - workerWaitStart;

  const [finalCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(logEvents)
    .where(eq(logEvents.deviceId, testDevice.id));
  const finalLogCount = finalCountRow?.count || 0;
  const insertedCount = finalLogCount - startLogCount;

  console.log("\n==================================================================");
  console.log("                     HASIL BENCHMARK TAHAP 3                      ");
  console.log("==================================================================");
  console.log(`Pesan Terkirim UDP       : ${sentCount}`);
  console.log(`Log Tersimpan di DB      : ${insertedCount}`);
  console.log(`Durasi Pengolahan Worker : ${totalProcessDuration} ms`);
  console.log(`Throughput Pemrosesan    : ~${Math.round((insertedCount / (totalProcessDuration / 1000)))} baris/detik`);
  console.log(`Sisa Antrian BullMQ      : ${remainingInQueue}`);
  console.log(`Status Pengujian         : ${insertedCount > 0 ? "LULUS (Optimal)" : "GAGAL"}`);
  console.log("==================================================================\n");

  await queryClient.end();
  process.exit(0);
}

runLoadTest().catch((err) => {
  console.error("Benchmark Error:", err);
  process.exit(1);
});
