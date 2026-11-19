import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { deviceGroups, devices, incidents, logEvents } from "@shared/schema";
import { updateDeviceGroupSchema, deleteDeviceGroupSchema } from "@shared/groups";
import { isDeviceOnline } from "@shared/devices";
import { publishChangeImmediately } from "@shared/events/publisher";
import { redis } from "@shared/redis";
import { eq, desc, asc, and, gte, count, sql, inArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

const GROUPS_SUMMARY_CACHE_KEY = "jagalog:groups_summary";

export async function GET(
  _request: Request,
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

    const { id } = await params;

    const [group] = await db
      .select()
      .from(deviceGroups)
      .where(eq(deviceGroups.id, id))
      .limit(1);

    if (!group) {
      return NextResponse.json(
        { error: "Grup perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    // Ambil daftar perangkat di dalam grup ini
    const groupDevices = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        status: devices.status,
        lastSeenAt: devices.lastSeenAt,
        offlineAfterMinutes: devices.offlineAfterMinutes,
        pingEnabled: devices.pingEnabled,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
        createdAt: devices.createdAt,
      })
      .from(devices)
      .where(and(eq(devices.groupId, id), eq(devices.isActive, true)))
      .orderBy(asc(devices.name));

    const deviceIds = groupDevices.map((d) => d.id);

    // Ambil insiden terbuka untuk grup ini
    let openIncidentsList: any[] = [];
    if (deviceIds.length > 0) {
      openIncidentsList = await db
        .select({
          id: incidents.id,
          deviceId: incidents.deviceId,
          deviceName: devices.name,
          title: incidents.title,
          severity: incidents.severity,
          status: incidents.status,
          firstSeen: incidents.firstSeen,
          lastSeen: incidents.lastSeen,
          count: incidents.count,
        })
        .from(incidents)
        .leftJoin(devices, eq(incidents.deviceId, devices.id))
        .where(
          and(
            inArray(incidents.deviceId, deviceIds),
            eq(incidents.status, "open")
          )
        )
        .orderBy(desc(incidents.lastSeen));
    }

    // Hitung status breakdown
    let onlineCount = 0;
    let logStoppedCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;

    const devicesWithOnline = groupDevices.map((dev) => {
      const isOnline = isDeviceOnline(dev.lastSeenAt, dev.offlineAfterMinutes);
      const devStatus = dev.status || (isOnline ? "online" : "unknown");

      if (devStatus === "offline") offlineCount++;
      else if (devStatus === "log_stopped") logStoppedCount++;
      else if (devStatus === "online") onlineCount++;
      else unknownCount++;

      return {
        ...dev,
        isOnline,
        calculatedStatus: devStatus,
      };
    });

    const validTrackedCount = onlineCount + logStoppedCount + offlineCount;
    let uptime24h: number | null = null;
    if (validTrackedCount > 0) {
      uptime24h = Math.round((onlineCount / validTrackedCount) * 1000) / 10;
    }

    // Ambil agregasi volume log gabungan 24 jam terakhir (per jam)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let logVolume24h: { hour: string; count: number }[] = [];

    if (deviceIds.length > 0) {
      const hourlyLogs = await db
        .select({
          hourBucket: sql<string>`to_char(date_trunc('hour', ${logEvents.eventTime}), 'YYYY-MM-DD"T"HH24:00:00')`,
          count: count(),
        })
        .from(logEvents)
        .where(
          and(
            inArray(logEvents.deviceId, deviceIds),
            gte(logEvents.eventTime, twentyFourHoursAgo)
          )
        )
        .groupBy(sql`date_trunc('hour', ${logEvents.eventTime})`)
        .orderBy(sql`date_trunc('hour', ${logEvents.eventTime}) asc`);

      logVolume24h = hourlyLogs.map((h) => ({
        hour: h.hourBucket,
        count: Number(h.count),
      }));
    }

    return NextResponse.json({
      group,
      devices: devicesWithOnline,
      openIncidents: openIncidentsList,
      summary: {
        totalDevices: groupDevices.length,
        onlineCount,
        logStoppedCount,
        offlineCount,
        unknownCount,
        openIncidentCount: openIncidentsList.length,
        uptime24h,
      },
      logVolume24h,
    });
  } catch (error) {
    console.error("GET /api/groups/[id] error:", error);
    return NextResponse.json(
      { error: "Gagal mengambil data detail grup." },
      { status: 500 }
    );
  }
}

export async function PUT(
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat mengubah grup perangkat." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await request.json();
    const parseResult = updateDeviceGroupSchema.safeParse(body);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Data grup tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(deviceGroups)
      .where(eq(deviceGroups.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json(
        { error: "Grup perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    const data = parseResult.data;

    // Jika nama diubah, cek duplikasi
    if (data.nama && data.nama.trim().toLowerCase() !== existing.nama.toLowerCase()) {
      const [duplicate] = await db
        .select({ id: deviceGroups.id })
        .from(deviceGroups)
        .where(
          and(
            sql`lower(${deviceGroups.nama}) = lower(${data.nama.trim()})`,
            sql`${deviceGroups.id} != ${id}`
          )
        )
        .limit(1);

      if (duplicate) {
        return NextResponse.json(
          { error: "Nama grup sudah dipakai." },
          { status: 409 }
        );
      }
    }

    const updatePayload: Record<string, any> = {};
    if (data.nama !== undefined) updatePayload.nama = data.nama.trim();
    if (data.deskripsi !== undefined) updatePayload.deskripsi = data.deskripsi?.trim() || null;
    if (data.warnaGaris !== undefined) updatePayload.warnaGaris = data.warnaGaris;
    if (data.urutan !== undefined) updatePayload.urutan = data.urutan;
    if (data.parentId !== undefined) updatePayload.parentId = data.parentId || null;

    const [updated] = await db
      .update(deviceGroups)
      .set(updatePayload)
      .where(eq(deviceGroups.id, id))
      .returning();

    // Invalidate Redis cache
    try {
      await redis.del(GROUPS_SUMMARY_CACHE_KEY);
    } catch (err) {
      console.warn("Gagal menghapus cache Redis groups_summary:", err);
    }

    // Broadcast SSE
    await publishChangeImmediately({
      tipe: "grup.berubah",
      perangkat_id: null,
      data_ringkas: {
        aksi: "diubah",
        groupId: updated.id,
        nama: updated.nama,
      },
    });

    return NextResponse.json({ group: updated });
  } catch (error) {
    console.error("PUT /api/groups/[id] error:", error);
    return NextResponse.json(
      { error: "Gagal memperbarui grup perangkat." },
      { status: 500 }
    );
  }
}

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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghapus grup perangkat." },
        { status: 403 }
      );
    }

    const { id } = await params;

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Body opsional jika default detach
    }

    const parseResult = deleteDeviceGroupSchema.safeParse(body);
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Opsi penghapusan tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { action, targetGroupId } = parseResult.data;

    const [groupToDelete] = await db
      .select()
      .from(deviceGroups)
      .where(eq(deviceGroups.id, id))
      .limit(1);

    if (!groupToDelete) {
      return NextResponse.json(
        { error: "Grup perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    // Jalankan dalam transaksi: perangkat TIDAK PERNAH dihapus
    await db.transaction(async (tx) => {
      if (action === "move" && targetGroupId) {
        // Pindahkan perangkat ke targetGroupId
        await tx
          .update(devices)
          .set({ groupId: targetGroupId })
          .where(eq(devices.groupId, id));
      } else {
        // Lepas seluruh perangkat (set null)
        await tx
          .update(devices)
          .set({ groupId: null })
          .where(eq(devices.groupId, id));
      }

      // Hapus grup
      await tx.delete(deviceGroups).where(eq(deviceGroups.id, id));
    });

    // Invalidate Redis cache
    try {
      await redis.del(GROUPS_SUMMARY_CACHE_KEY);
      await redis.del("jagalog:fleet_summary");
    } catch (err) {
      console.warn("Gagal menghapus cache Redis groups_summary:", err);
    }

    // Broadcast SSE
    await publishChangeImmediately({
      tipe: "grup.berubah",
      perangkat_id: null,
      data_ringkas: {
        aksi: "dihapus",
        groupId: id,
        nama: groupToDelete.nama,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Grup '${groupToDelete.nama}' berhasil dihapus. Perangkat ${
        action === "move" ? "dipindahkan ke grup tujuan" : "dilepas menjadi tanpa grup"
      }.`,
    });
  } catch (error) {
    console.error("DELETE /api/groups/[id] error:", error);
    return NextResponse.json(
      { error: "Gagal menghapus grup perangkat." },
      { status: 500 }
    );
  }
}
