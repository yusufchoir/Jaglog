import * as dotenv from "dotenv";
import { startIngestWorker } from "./worker";
import { startDetectionWorker } from "@shared/detection";
import { startDeviceStatusWorker } from "@shared/monitoring";
import { scheduleRetentionJob, startRetentionWorker } from "@shared/cleaner";

dotenv.config();

console.log("=== Memulai JagaLog Dedicated Worker Service ===");

// 1. Ingest worker (BullMQ consumer for batch inserting log_events)
const ingestWorker = startIngestWorker();
console.log("[Worker Service] BullMQ Ingest Worker aktif.");

// 2. Attack detection worker (evaluates attack detection rules every 30s)
startDetectionWorker(30);
console.log("[Worker Service] Scheduled Detection Worker aktif (interval 30s).");

// 3. Device status & ping worker (evaluates device online/log_stopped/offline every 30s)
startDeviceStatusWorker(30);
console.log("[Worker Service] Device Status & Ping Worker aktif (interval 30s).");

// 4. Log retention worker (daily cleanup of logs older than LOG_RETENTION_DAYS)
scheduleRetentionJob()
  .then(() => {
    startRetentionWorker();
    console.log("[Worker Service] BullMQ Retention Cleanup Worker & Schedule aktif.");
  })
  .catch((err) => {
    console.error("[Worker Service] Gagal mendaftarkan retention schedule:", err);
  });

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Worker Service] Menerima sinyal SIGTERM. Menutup worker...");
  await ingestWorker.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[Worker Service] Menerima sinyal SIGINT. Menutup worker...");
  await ingestWorker.close();
  process.exit(0);
});
