import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceStatusHistory } from "@shared/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { pingDeviceWithDetails } from "@shared/monitoring/ping";
import { calculateDeviceStatus, DeviceMonitoringStatus } from "@shared/devices";
import { dispatchDeviceStatusNotification } from "@shared/notifications";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    // Ambil semua perangkat aktif yang memiliki alamat IP
    const targetDevices = await db
      .select()
      .from(devices)
      .where(and(eq(devices.isActive, true), isNotNull(devices.ipAddress)));

    if (targetDevices.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Tidak ada perangkat aktif dengan IP terdaftar untuk diping.",
        processed: 0,
        online: 0,
        offline: 0,
        results: [],
      });
    }

    const now = new Date();
    const results: Array<{
      id: string;
      name: string;
      ipAddress: string;
      isAlive: boolean;
      latencyMs: number | null;
      method: string | null;
      status: string;
    }> = [];
    let onlineCount = 0;
    let offlineCount = 0;

    // Batasi concurrency (maks 10 perangkat paralel)
    const concurrency = 10;
    const queue = [...targetDevices];

    const workers = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (queue.length > 0) {
          const dev = queue.shift();
          if (!dev || !dev.ipAddress) continue;

          try {
            const pingRes = await pingDeviceWithDetails(dev.ipAddress, 2000, 2);
            if (pingRes.isAlive) {
              onlineCount++;
            } else {
              offlineCount++;
            }

            const previousStatus = (dev.status || "unknown") as DeviceMonitoringStatus;
            const newStatus = calculateDeviceStatus({
              lastSeenAt: dev.lastSeenAt,
              pingEnabled: true,
              lastPingOk: pingRes.isAlive,
              offlineAfterMinutes: dev.offlineAfterMinutes,
            });

            const isStatusChanged = newStatus !== previousStatus;

            await db
              .update(devices)
              .set({
                lastPingAt: now,
                lastPingOk: pingRes.isAlive,
                status: newStatus,
                statusChangedAt: isStatusChanged ? now : dev.statusChangedAt,
              })
              .where(eq(devices.id, dev.id));

            if (isStatusChanged) {
              try {
                await db
                  .update(deviceStatusHistory)
                  .set({ endedAt: now })
                  .where(
                    and(
                      eq(deviceStatusHistory.deviceId, dev.id),
                      sql`${deviceStatusHistory.endedAt} IS NULL`
                    )
                  );

                await db.insert(deviceStatusHistory).values({
                  deviceId: dev.id,
                  status: newStatus,
                  startedAt: now,
                });

                if (newStatus === "offline" || (previousStatus === "offline" && newStatus === "online")) {
                  dispatchDeviceStatusNotification({
                    device: {
                      id: dev.id,
                      name: dev.name,
                      ipAddress: dev.ipAddress,
                    },
                    eventType: newStatus === "offline" ? "device_offline" : "device_recovered",
                  }).catch(() => {});
                }
              } catch {}
            }

            results.push({
              id: dev.id,
              name: dev.name,
              ipAddress: dev.ipAddress,
              isAlive: pingRes.isAlive,
              latencyMs: pingRes.latencyMs,
              method: pingRes.method,
              status: newStatus,
            });
          } catch (itemErr) {
            console.error(`Error pinging device ${dev.id}:`, itemErr);
          }
        }
      }
    );

    await Promise.all(workers);

    return NextResponse.json({
      success: true,
      message: `Selesai memeriksa ${targetDevices.length} perangkat: ${onlineCount} UP, ${offlineCount} DOWN.`,
      processed: targetDevices.length,
      online: onlineCount,
      offline: offlineCount,
      results,
    });
  } catch (error) {
    console.error("POST /api/devices/ping-all error:", error);
    return NextResponse.json(
      { error: "Gagal menjalankan ping semua perangkat." },
      { status: 500 }
    );
  }
}
