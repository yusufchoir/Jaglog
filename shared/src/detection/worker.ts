import { runDetectionEngine } from "./engine";

let detectionTimer: NodeJS.Timeout | null = null;
let isRunning = false;

/**
 * Memulai worker periodik deteksi serangan (setiap 30 detik)
 */
export function startDetectionWorker(intervalSeconds = 30): void {
  if (detectionTimer) return;

  const intervalMs = intervalSeconds * 1000;

  const tick = async () => {
    if (isRunning) return;
    isRunning = true;

    try {
      const result = await runDetectionEngine();
      if (result.matchesCount > 0) {
        console.log(
          `[Detection Worker] Siklus selesai dalam ${result.durationMs}ms: ${result.matchesCount} match (${result.newIncidentsCount} baru, ${result.updatedIncidentsCount} diperbarui)`
        );
      }
    } catch (err) {
      console.error("[Detection Worker Error]", err);
    } finally {
      isRunning = false;
    }
  };

  // Jalankan segera sekali di awal, lalu jadwalkan interval
  setTimeout(tick, 2000);
  detectionTimer = setInterval(tick, intervalMs);

  console.log(`[Detection Worker] Aktif, berjalan setiap ${intervalSeconds} detik.`);
}

export function stopDetectionWorker(): void {
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
    console.log("[Detection Worker] Dihentikan.");
  }
}
