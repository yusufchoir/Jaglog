import { db } from "../db";
import { devices, logEvents } from "../schema";
import { eq, sql, and } from "drizzle-orm";
import { analyzeDeviceDaily } from "./service";

/**
 * Menjalankan pembuatan ringkasan AI harian untuk seluruh perangkat aktif yang memiliki log 24 jam terakhir
 */
export async function runDailySummariesForAllDevices(): Promise<{
  processedDevices: number;
  successfulSummaries: number;
}> {
  console.log("[AI Daily Summary] Memulai pemeriksaan ringkasan harian perangkat...");

  const activeDevices = await db
    .select({ id: devices.id, name: devices.name })
    .from(devices)
    .where(eq(devices.isActive, true));

  let successful = 0;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (const dev of activeDevices) {
    // Cek apakah ada log dalam 24 jam terakhir
    const [hasLogs] = await db
      .select({ id: logEvents.id })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, dev.id),
          sql`${logEvents.eventTime} >= ${dayAgo}`
        )
      )
      .limit(1);

    if (hasLogs) {
      const res = await analyzeDeviceDaily(dev.id);
      if (res.success) {
        successful++;
        console.log(`[AI Daily Summary] Berhasil membuat ringkasan untuk "${dev.name}"`);
      }
    }
  }

  return {
    processedDevices: activeDevices.length,
    successfulSummaries: successful,
  };
}
