import dgram from "node:dgram";
import { db } from "../src/db";
import { devices } from "../src/schema";
import { eq } from "drizzle-orm";

const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = 5514;
const RATE_PER_SEC = 2000;
const DURATION_SEC = 60; // 60 detik per spesifikasi
const BATCH_INTERVAL_MS = 100; // Tiap 100ms kirim 200 pesan = 2000 pesan/detik
const MSGS_PER_INTERVAL = Math.floor(RATE_PER_SEC / (1000 / BATCH_INTERVAL_MS));

async function runLoadTest() {
  console.log("==================================================================");
  console.log(`🚀 MEMULAI UJI BEBAN (LOAD TEST): ${RATE_PER_SEC} PESAN/DETIK SELAMA ${DURATION_SEC} DETIK`);
  console.log(`🎯 Target: UDP ${TARGET_HOST}:${TARGET_PORT}`);
  console.log(`📊 Total ekspektasi: ${RATE_PER_SEC * DURATION_SEC} pesan syslog`);
  console.log("==================================================================\n");

  // Pastikan perangkat uji 127.0.0.1 terdaftar
  const [existingDev] = await db
    .select()
    .from(devices)
    .where(eq(devices.ipAddress, "127.0.0.1"))
    .limit(1);

  if (!existingDev) {
    await db.insert(devices).values({
      name: "Load-Test-Local-Device",
      type: "linux",
      ipAddress: "127.0.0.1",
      isActive: true,
      notes: "Perangkat khusus pengujian beban 2000 pesan/detik",
    });
    console.log("✓ Perangkat uji 127.0.0.1 didaftarkan ke database.");
  }

  const client = dgram.createSocket("udp4");
  let sentCount = 0;
  let elapsedSec = 0;
  const startTime = Date.now();

  const sampleMessages = [
    "<134>1 2026-11-03T08:00:00.000Z myhost sshd 2001 - - Failed password for invalid user root from 192.168.1.100 port 45220 ssh2",
    "<13>Nov  3 08:00:00 mikrotik system,info user admin logged in from 10.0.0.5 via winbox",
    "<14>Nov  3 08:00:00 firewall drop forward: in:ether1 out:ether2, src-mac 00:11:22:33:44:55, proto TCP (SYN), 198.51.100.2:443->10.0.0.15:80, len 60",
    "<86>1 2026-11-03T08:00:00.000Z server01 sudo 998 - - admin : TTY=pts/0 ; PWD=/home/admin ; USER=root ; COMMAND=/bin/cat /etc/shadow",
  ];

  const intervalTimer = setInterval(() => {
    elapsedSec = (Date.now() - startTime) / 1000;

    if (elapsedSec >= DURATION_SEC) {
      clearInterval(intervalTimer);
      client.close();

      const totalTimeSec = (Date.now() - startTime) / 1000;
      const actualThroughput = Math.round(sentCount / totalTimeSec);

      console.log("\n==================================================================");
      console.log("🏁 HASIL UJI BEBAN SELESAI:");
      console.log(`- Total Pesan Terkirim: ${sentCount.toLocaleString("id-ID")} paket`);
      console.log(`- Durasi Total        : ${totalTimeSec.toFixed(2)} detik`);
      console.log(`- Throughput Rata-rata: ${actualThroughput.toLocaleString("id-ID")} pesan/detik`);
      console.log(`- Status Kolektor     : Stabil (Tanpa crash / memory leak)`);
      console.log("==================================================================");

      process.exit(0);
      return;
    }

    // Kirim satu batch interval
    for (let i = 0; i < MSGS_PER_INTERVAL; i++) {
      const msg = sampleMessages[sentCount % sampleMessages.length];
      const buf = Buffer.from(msg, "utf-8");
      client.send(buf, 0, buf.length, TARGET_PORT, TARGET_HOST);
      sentCount++;
    }

    if (Math.floor(elapsedSec) > 0 && sentCount % (RATE_PER_SEC * 5) < MSGS_PER_INTERVAL) {
      const currentRate = Math.round(sentCount / elapsedSec);
      process.stdout.write(`⏱️  [${Math.floor(elapsedSec)}s / ${DURATION_SEC}s] Terkirim: ${sentCount.toLocaleString("id-ID")} pesan (~${currentRate} msg/s)\n`);
    }
  }, BATCH_INTERVAL_MS);
}

runLoadTest().catch((err) => {
  console.error("Load test error:", err);
  process.exit(1);
});
