import http from "http";
import * as dotenv from "dotenv";
import { startUdpSyslogServer, startTcpSyslogServer, flushSyslogBatch } from "./syslog";
import { startIngestWorker } from "./worker";
import { startDetectionWorker } from "@shared/detection";
import { startDeviceStatusWorker } from "@shared/monitoring";
import { startNotifyWorker } from "@shared/notifications";

dotenv.config();

const HEALTH_PORT = Number(process.env.COLLECTOR_HEALTH_PORT || 8080);
const SYSLOG_UDP_PORT = Number(process.env.SYSLOG_UDP_PORT || 5514);
const SYSLOG_TCP_PORT = Number(process.env.SYSLOG_TCP_PORT || 5514);

console.log("=== Memulai JagaLog Collector Service ===");

// 1. Jalankan Syslog UDP Server
const udpServer = startUdpSyslogServer(SYSLOG_UDP_PORT);

// 2. Jalankan Syslog TCP Server
const tcpServer = startTcpSyslogServer(SYSLOG_TCP_PORT);

// 3. Jalankan BullMQ Ingest Worker & Notify Worker
const ingestWorker = startIngestWorker();
const notifyWorker = startNotifyWorker();
console.log("[Collector] Worker antrian BullMQ 'ingest' & 'notify' aktif.");

// 4. Jalankan Deteksi Serangan Terjadwal (setiap 30 detik)
startDetectionWorker(30);

// 5. Jalankan Monitoring Status Perangkat (setiap 30 detik)
startDeviceStatusWorker(30);

// 6. Jalankan Healthcheck HTTP Server (Port 8080)
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "jagalog-collector",
        timestamp: new Date().toISOString(),
        syslogPorts: {
          udp: SYSLOG_UDP_PORT,
          tcp: SYSLOG_TCP_PORT,
        },
        workerStatus: ingestWorker.isRunning() ? "running" : "stopped",
      })
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

healthServer.listen(HEALTH_PORT, () => {
  console.log(`[Collector] Healthcheck endpoint aktif di http://localhost:${HEALTH_PORT}/health`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Collector] Menerima sinyal SIGTERM. Menutup layanan...");
  udpServer.close();
  tcpServer.close();
  healthServer.close();
  await flushSyslogBatch();
  await ingestWorker.close();
  await notifyWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Collector] Menerima sinyal SIGINT. Menutup layanan...");
  udpServer.close();
  tcpServer.close();
  healthServer.close();
  await flushSyslogBatch();
  await ingestWorker.close();
  await notifyWorker.close();
  process.exit(0);
});
