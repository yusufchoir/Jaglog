import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups, logEvents, incidents } from "@shared/schema";
import { updateDeviceSchema, isDeviceOnline } from "@shared/devices";
import { eq, and, not, gte, count } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";
import { removeUnknownSourceIp } from "@shared/ingest-diagnostics";

export const dynamic = "force-dynamic";

// 1. GET /api/devices/[id]: Detail satu perangkat
export async function GET(
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
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        groupId: devices.groupId,
        groupName: deviceGroups.nama,
        groupWarnaGaris: deviceGroups.warnaGaris,
        notes: devices.notes,
        isActive: devices.isActive,
        offlineAfterMinutes: devices.offlineAfterMinutes,
        pingEnabled: devices.pingEnabled,
        timezone: devices.timezone,
        status: devices.status,
        statusChangedAt: devices.statusChangedAt,
        lastPingAt: devices.lastPingAt,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
        pingFailureThreshold: devices.pingFailureThreshold,
        notifyOnRto: devices.notifyOnRto,
        lastSeenAt: devices.lastSeenAt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .leftJoin(deviceGroups, eq(devices.groupId, deviceGroups.id))
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!device) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [logCountRes] = await db
      .select({ total: count() })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, device.id),
          gte(logEvents.eventTime, twentyFourHoursAgo)
        )
      );

    const [incidentCountRes] = await db
      .select({ total: count() })
      .from(incidents)
      .where(
        and(
          eq(incidents.deviceId, device.id),
          eq(incidents.status, "open")
        )
      );

    return NextResponse.json({
      device: {
        ...device,
        status: device.isActive ? (device.status || "unknown") : "unknown",
        lastPingOk: device.isActive ? device.lastPingOk : null,
        lastPingRtt: device.isActive ? device.lastPingRtt : null,
        isOnline: device.isActive ? isDeviceOnline(device.lastSeenAt, device.offlineAfterMinutes) : false,
        logCount24h: Number(logCountRes?.total ?? 0),
        openIncidentCount: Number(incidentCountRes?.total ?? 0),
      },
      serverConfig: {
        syslogUdpPort: process.env.SYSLOG_UDP_PORT || 5514,
        syslogTcpPort: process.env.SYSLOG_TCP_PORT || 5514,
      },
    });
  } catch (error) {
    console.error("GET /api/devices/[id] error:", error);
    return NextResponse.json(
      { error: "Gagal mengambil data perangkat." },
      { status: 500 }
    );
  }
}

// 2. PATCH /api/devices/[id]: Update perangkat (Admin only)
export async function PATCH(
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

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat mengubah perangkat." },
        { status: 403 }
      );
    }

    const { id: deviceId } = await params;
    const body = await request.json();

    const parseResult = updateDeviceSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Data perubahan tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const updateFields = parseResult.data;

    // Cek keberadaan perangkat
    const [existingDevice] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!existingDevice) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    // Jika ada perubahan IP Address, cek duplikasi pada perangkat lain
    if (updateFields.ipAddress && updateFields.ipAddress !== existingDevice.ipAddress) {
      const [duplicateIp] = await db
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.ipAddress, updateFields.ipAddress),
            not(eq(devices.id, deviceId))
          )
        )
        .limit(1);

      if (duplicateIp) {
        return NextResponse.json(
          { error: `Gagal menyimpan: Alamat IP '${updateFields.ipAddress}' sudah digunakan oleh perangkat '${duplicateIp.name}'.` },
          { status: 409 }
        );
      }
    }

    const finalUpdateFields: Record<string, any> = { ...updateFields };
    if (updateFields.isActive === false) {
      finalUpdateFields.status = "unknown";
      finalUpdateFields.lastPingOk = null;
      finalUpdateFields.lastPingRtt = null;
    }

    const [updatedDevice] = await db
      .update(devices)
      .set(finalUpdateFields)
      .where(eq(devices.id, deviceId))
      .returning({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        groupId: devices.groupId,
        notes: devices.notes,
        isActive: devices.isActive,
        offlineAfterMinutes: devices.offlineAfterMinutes,
        pingEnabled: devices.pingEnabled,
        timezone: devices.timezone,
        status: devices.status,
        statusChangedAt: devices.statusChangedAt,
        lastPingAt: devices.lastPingAt,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
        pingFailureThreshold: devices.pingFailureThreshold,
        notifyOnRto: devices.notifyOnRto,
        lastSeenAt: devices.lastSeenAt,
      });

    // Invalidate relevant Redis caches immediately
    try {
      await redis.del(`cache:device:stats:${deviceId}`);
      await redis.del("cache:devices:catalog");
      await redis.del("jagalog:groups_summary");
      await redis.del("jagalog:fleet_summary");
      if (updateFields.isActive === false) {
        await redis.del(`dev_ping_state:${deviceId}`);
      }
      if (existingDevice.ipAddress) {
        await redis.del(`device:ip:${existingDevice.ipAddress}`);
      }
      if (updateFields.ipAddress && updateFields.ipAddress !== existingDevice.ipAddress) {
        await redis.del(`device:ip:${updateFields.ipAddress}`);
      }
      if (updatedDevice.ipAddress) {
        await removeUnknownSourceIp(updatedDevice.ipAddress);
      }
      if (existingDevice.ingestTokenHash) {
        await redis.del(`device:token:${existingDevice.ingestTokenHash}`);
      }
    } catch (cacheErr) {
      console.warn("Failed to invalidate device cache in Redis:", cacheErr);
    }

    if (updateFields.groupId !== undefined && updateFields.groupId !== existingDevice.groupId) {
      publishChange({
        tipe: "grup.berubah",
        perangkat_id: deviceId,
        data_ringkas: {
          jenis: "keanggotaan",
          device_ids: [deviceId],
          group_id: updateFields.groupId,
        },
      }).catch(() => {});
    }

    publishChange({
      tipe: "perangkat.diubah",
      perangkat_id: deviceId,
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Perangkat '${updatedDevice.name}' berhasil diperbarui.`,
      device: updatedDevice,
    });
  } catch (error) {
    console.error("PATCH /api/devices/[id] error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memperbarui perangkat." },
      { status: 500 }
    );
  }
}

// 3. DELETE /api/devices/[id]: Hapus perangkat (Admin only)
export async function DELETE(
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

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghapus perangkat." },
        { status: 403 }
      );
    }

    const { id: deviceId } = await params;

    const [deleted] = await db
      .delete(devices)
      .where(eq(devices.id, deviceId))
      .returning({ id: devices.id, name: devices.name });

    if (!deleted) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    try {
      await redis.del(`cache:device:stats:${deviceId}`);
      await redis.del("jagalog:groups_summary");
    } catch {
      // ignore
    }

    publishChange({
      tipe: "perangkat.diubah",
      perangkat_id: deviceId,
      data_ringkas: { deleted: true },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Perangkat '${deleted.name}' berhasil dihapus.`,
    });
  } catch (error) {
    console.error("DELETE /api/devices/[id] error:", error);
    return NextResponse.json(
      { error: "Gagal menghapus perangkat." },
      { status: 500 }
    );
  }
}
