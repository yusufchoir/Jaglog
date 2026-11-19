import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceStatusHistory } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { pingDeviceWithDetails } from "@shared/monitoring/ping";
import { calculateDeviceStatus, DeviceMonitoringStatus } from "@shared/devices";
import { dispatchDeviceStatusNotification } from "@shared/notifications";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const { id: deviceId } = await params;

    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!device) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    if (!device.isActive) {
      return NextResponse.json(
        {
          error:
            "Perangkat ini berstatus Nonaktif. Aktifkan perangkat terlebih dahulu untuk melakukan tes ping.",
        },
        { status: 400 }
      );
    }

    if (!device.ipAddress || device.ipAddress.trim() === "") {
      return NextResponse.json(
        {
          error:
            "Perangkat ini tidak memiliki Alamat IP terdaftar. Harap masukkan IP pada konfigurasi perangkat untuk melakukan tes ping.",
        },
        { status: 400 }
      );
    }

    // Eksekusi ping dengan detail (ICMP + fallback TCP)
    const pingResult = await pingDeviceWithDetails(device.ipAddress, 2500, 2);
    const now = new Date();

    const previousStatus = (device.status || "unknown") as DeviceMonitoringStatus;
    const newStatus = calculateDeviceStatus({
      lastSeenAt: device.lastSeenAt,
      pingEnabled: true,
      lastPingOk: pingResult.isAlive,
      offlineAfterMinutes: device.offlineAfterMinutes,
    });

    const isStatusChanged = newStatus !== previousStatus;

    // Update data perangkat di DB
    await db
      .update(devices)
      .set({
        pingEnabled: true, // Otomatis aktifkan pingEnabled jika admin melakukan tes ping
        lastPingAt: now,
        lastPingOk: pingResult.isAlive,
        status: newStatus,
        statusChangedAt: isStatusChanged ? now : device.statusChangedAt,
      })
      .where(eq(devices.id, deviceId));

    publishChange({
      tipe: "perangkat.ping",
      perangkat_id: deviceId,
      data_ringkas: {
        ping_ok: pingResult.isAlive,
        ping_rtt: pingResult.latencyMs,
      },
    }).catch(() => {});

    if (isStatusChanged) {
      publishChange({
        tipe: "perangkat.status",
        perangkat_id: deviceId,
        data_ringkas: {
          status_perangkat: newStatus,
          ping_ok: pingResult.isAlive,
          ping_rtt: pingResult.latencyMs,
        },
      }).catch(() => {});
    }

    // Catat histori & kirim notifikasi jika status berubah
    if (isStatusChanged) {
      try {
        await db
          .update(deviceStatusHistory)
          .set({ endedAt: now })
          .where(
            and(
              eq(deviceStatusHistory.deviceId, device.id),
              sql`${deviceStatusHistory.endedAt} IS NULL`
            )
          );

        await db.insert(deviceStatusHistory).values({
          deviceId: device.id,
          status: newStatus,
          startedAt: now,
        });

        // Dispatch notifikasi secara asinkron jika status berubah menjadi offline atau recovered (online)
        if (newStatus === "offline" || (previousStatus === "offline" && newStatus === "online")) {
          dispatchDeviceStatusNotification({
            device: {
              id: device.id,
              name: device.name,
              ipAddress: device.ipAddress,
            },
            eventType: newStatus === "offline" ? "device_offline" : "device_recovered",
          }).catch((err) =>
            console.error("Gagal dispatch notifikasi status:", err)
          );
        }
      } catch (historyErr) {
        console.error("Gagal menyimpan histori status perangkat:", historyErr);
      }
    }

    const latencyLabel =
      pingResult.latencyMs !== null ? `${pingResult.latencyMs} ms` : "RTO";
    const methodLabel = pingResult.method
      ? `(${pingResult.method.toUpperCase()})`
      : "";

    return NextResponse.json({
      success: true,
      isAlive: pingResult.isAlive,
      latencyMs: pingResult.latencyMs,
      method: pingResult.method,
      status: newStatus,
      lastPingAt: now.toISOString(),
      lastPingOk: pingResult.isAlive,
      message: pingResult.isAlive
        ? `Perangkat UP: Terhubung via Ping ${methodLabel} [${latencyLabel}]`
        : "Perangkat DOWN: Tidak ada respon dari IP (RTO / Port Tertutup)",
    });
  } catch (error) {
    console.error("POST /api/devices/[id]/ping error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server saat mengeksekusi ping." },
      { status: 500 }
    );
  }
}
