import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { deviceGroups, devices, incidents, logEvents } from "@shared/schema";
import { createDeviceGroupSchema } from "@shared/groups";
import { isDeviceOnline } from "@shared/devices";
import { publishChangeImmediately } from "@shared/events/publisher";
import { redis } from "@shared/redis";
import { eq, desc, asc, and, gte, count, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const GROUPS_SUMMARY_CACHE_KEY = "jagalog:groups_summary";
const GROUPS_CACHE_TTL = 20; // 20 detik

export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    // Cek cache Redis
    try {
      const cached = await redis.get(GROUPS_SUMMARY_CACHE_KEY);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch (err) {
      console.warn("Gagal membaca cache Redis untuk groups_summary:", err);
    }

    // Ambil seluruh master grup
    const allGroups = await db
      .select({
        id: deviceGroups.id,
        nama: deviceGroups.nama,
        deskripsi: deviceGroups.deskripsi,
        warnaGaris: deviceGroups.warnaGaris,
        urutan: deviceGroups.urutan,
        parentId: deviceGroups.parentId,
        createdAt: deviceGroups.createdAt,
      })
      .from(deviceGroups)
      .orderBy(asc(deviceGroups.urutan), asc(deviceGroups.nama));

    // Ambil seluruh perangkat dengan statusnya
    const allDevices = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        groupId: devices.groupId,
        status: devices.status,
        lastSeenAt: devices.lastSeenAt,
        offlineAfterMinutes: devices.offlineAfterMinutes,
        pingEnabled: devices.pingEnabled,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
      })
      .from(devices)
      .where(eq(devices.isActive, true));

    // Ambil insiden terbuka per device
    const openIncidents = await db
      .select({
        deviceId: incidents.deviceId,
        total: count(),
      })
      .from(incidents)
      .where(eq(incidents.status, "open"))
      .groupBy(incidents.deviceId);

    const openIncidentMap = new Map<string, number>();
    for (const inc of openIncidents) {
      if (inc.deviceId) {
        openIncidentMap.set(inc.deviceId, Number(inc.total));
      }
    }

    // Petakan perangkat berdasarkan groupId
    const devicesByGroup = new Map<string, typeof allDevices>();
    let unassignedCount = 0;

    for (const dev of allDevices) {
      if (!dev.groupId) {
        unassignedCount++;
        continue;
      }
      const list = devicesByGroup.get(dev.groupId) || [];
      list.push(dev);
      devicesByGroup.set(dev.groupId, list);
    }

    const groupsWithStats = allGroups.map((grp) => {
      const groupDevs = devicesByGroup.get(grp.id) || [];
      const totalDevices = groupDevs.length;

      let onlineCount = 0;
      let logStoppedCount = 0;
      let offlineCount = 0;
      let unknownCount = 0;
      let totalOpenIncidents = 0;

      for (const dev of groupDevs) {
        const isOnline = isDeviceOnline(dev.lastSeenAt, dev.offlineAfterMinutes);
        const devStatus = dev.status || (isOnline ? "online" : "unknown");

        if (devStatus === "offline") {
          offlineCount++;
        } else if (devStatus === "log_stopped") {
          logStoppedCount++;
        } else if (devStatus === "online") {
          onlineCount++;
        } else {
          unknownCount++;
        }

        totalOpenIncidents += openIncidentMap.get(dev.id) || 0;
      }

      // Tentukan status terburuk grup (offline > log_stopped > unknown > online)
      let worstStatus: {
        code: "offline" | "log_stopped" | "unknown" | "online" | "empty";
        label: string;
        glyph: string;
        color: string;
      };

      if (totalDevices === 0) {
        worstStatus = {
          code: "empty",
          label: "Kosong",
          glyph: "○",
          color: "#5B6270",
        };
      } else if (offlineCount > 0) {
        worstStatus = {
          code: "offline",
          label: "Offline",
          glyph: "✕",
          color: "#C8372D",
        };
      } else if (logStoppedCount > 0) {
        worstStatus = {
          code: "log_stopped",
          label: "Log Berhenti",
          glyph: "⏸",
          color: "#D97706",
        };
      } else if (unknownCount > 0) {
        worstStatus = {
          code: "unknown",
          label: "Belum Ada Data",
          glyph: "?",
          color: "#5B6270",
        };
      } else {
        worstStatus = {
          code: "online",
          label: "Normal",
          glyph: "●",
          color: "#1F5FBF",
        };
      }

      // Kalkulasi uptime 24h gabungan
      // Jika semua perangkat unknown/empty -> null
      // Jika ada perangkat aktif -> persentase perangkat online / (online + log_stopped + offline)
      const validTrackedCount = onlineCount + logStoppedCount + offlineCount;
      let uptime24h: number | null = null;
      if (validTrackedCount > 0) {
        uptime24h = Math.round((onlineCount / validTrackedCount) * 1000) / 10;
      }

      return {
        ...grp,
        totalDevices,
        onlineCount,
        logStoppedCount,
        offlineCount,
        unknownCount,
        ringkasanStatus: `${onlineCount} dari ${totalDevices} online`,
        openIncidents: totalOpenIncidents,
        worstStatus,
        uptime24h,
      };
    });

    const payload = {
      groups: groupsWithStats,
      unassignedCount,
      totalDevices: allDevices.length,
      timestamp: new Date().toISOString(),
    };

    // Simpan ke cache Redis
    try {
      await redis.set(GROUPS_SUMMARY_CACHE_KEY, JSON.stringify(payload), "EX", GROUPS_CACHE_TTL);
    } catch (err) {
      console.warn("Gagal menulis cache Redis untuk groups_summary:", err);
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("GET /api/groups error:", error);
    return NextResponse.json(
      { error: "Gagal mengambil daftar grup perangkat." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat membuat grup perangkat." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = createDeviceGroupSchema.safeParse(body);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Data grup tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { nama, deskripsi, warnaGaris, urutan, parentId } = parseResult.data;

    // Cek duplikasi nama (case-insensitive)
    const [existing] = await db
      .select({ id: deviceGroups.id, nama: deviceGroups.nama })
      .from(deviceGroups)
      .where(sql`lower(${deviceGroups.nama}) = lower(${nama.trim()})`)
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Nama grup sudah dipakai." },
        { status: 409 }
      );
    }

    // Insert grup baru
    const [newGroup] = await db
      .insert(deviceGroups)
      .values({
        nama: nama.trim(),
        deskripsi: deskripsi?.trim() || null,
        warnaGaris,
        urutan,
        parentId: parentId || null,
      })
      .returning();

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
        aksi: "dibuat",
        groupId: newGroup.id,
        nama: newGroup.nama,
      },
    });

    return NextResponse.json({ group: newGroup }, { status: 201 });
  } catch (error) {
    console.error("POST /api/groups error:", error);
    return NextResponse.json(
      { error: "Gagal membuat grup perangkat baru." },
      { status: 500 }
    );
  }
}
