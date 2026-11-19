import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups, logEvents, incidents } from "@shared/schema";
import {
  createDeviceSchema,
  generateIngestToken,
  hashIngestToken,
  isDeviceOnline,
} from "@shared/devices";
import { pingDeviceWithDetails } from "@shared/monitoring/ping";
import { eq, desc, and, gte, count, sql } from "drizzle-orm";
import { redis } from "@shared/redis";
import { removeUnknownSourceIp } from "@shared/ingest-diagnostics";

export const dynamic = "force-dynamic";

// 1. GET /api/devices: Daftar seluruh perangkat beserta statistik 24h & insiden terbuka
export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const allDevices = await db
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
      .orderBy(desc(devices.createdAt));

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Ambil agregasi log 24h dan insiden terbuka secara tunggal (GROUP BY) tanpa N+1 loop
    const [logCounts, incidentCounts] = await Promise.all([
      db
        .select({
          deviceId: logEvents.deviceId,
          total: sql<number>`count(*)::int`,
        })
        .from(logEvents)
        .where(gte(logEvents.eventTime, twentyFourHoursAgo))
        .groupBy(logEvents.deviceId),
      db
        .select({
          deviceId: incidents.deviceId,
          total: sql<number>`count(*)::int`,
        })
        .from(incidents)
        .where(eq(incidents.status, "open"))
        .groupBy(incidents.deviceId),
    ]);

    const logMap = new Map<string, number>();
    for (const r of logCounts) {
      if (r.deviceId) logMap.set(r.deviceId, r.total);
    }

    const incidentMap = new Map<string, number>();
    for (const r of incidentCounts) {
      if (r.deviceId) incidentMap.set(r.deviceId, r.total);
    }

    const deviceStats = allDevices.map((dev) => ({
      ...dev,
      status: dev.isActive ? (dev.status || "unknown") : "unknown",
      lastPingOk: dev.isActive ? dev.lastPingOk : null,
      lastPingRtt: dev.isActive ? dev.lastPingRtt : null,
      isOnline: dev.isActive ? isDeviceOnline(dev.lastSeenAt, dev.offlineAfterMinutes) : false,
      logCount24h: logMap.get(dev.id) ?? 0,
      openIncidentCount: incidentMap.get(dev.id) ?? 0,
    }));

    return NextResponse.json({ devices: deviceStats });
  } catch (error) {
    console.error("GET /api/devices error:", error);
    return NextResponse.json(
      { error: "Gagal mengambil daftar perangkat." },
      { status: 500 }
    );
  }
}

// 2. POST /api/devices: Tambah perangkat baru (Admin only)
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menambahkan perangkat." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = createDeviceSchema.safeParse(body);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Data perangkat tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name, type, ipAddress, location, groupId, notes, offlineAfterMinutes, pingEnabled, pingFailureThreshold, notifyOnRto } = parseResult.data;

    // Cek duplikasi alamat IP jika ada
    if (ipAddress) {
      const [existingIp] = await db
        .select()
        .from(devices)
        .where(eq(devices.ipAddress, ipAddress))
        .limit(1);

      if (existingIp) {
        return NextResponse.json(
          { error: `Gagal menyimpan perangkat: Alamat IP '${ipAddress}' sudah digunakan oleh perangkat '${existingIp.name}'.` },
          { status: 409 }
        );
      }
    }

    // Generate ingest token 32-byte acak & hash SHA-256
    const rawIngestToken = generateIngestToken();
    const ingestTokenHash = hashIngestToken(rawIngestToken);

    // Jika memiliki IP address, default aktifkan pemantauan ping
    const isPingMonitored = Boolean(ipAddress && (pingEnabled !== false));
    let initialPingOk: boolean | null = null;
    let initialPingAt: Date | null = null;
    let initialPingRtt: number | null = null;
    let initialStatus: "online" | "log_stopped" | "offline" | "unknown" = "unknown";

    if (isPingMonitored && ipAddress) {
      try {
        const pingRes = await pingDeviceWithDetails(ipAddress, 2500, 2);
        initialPingOk = pingRes.isAlive;
        initialPingAt = new Date();
        initialPingRtt = pingRes.latencyMs;
        initialStatus = pingRes.isAlive ? "online" : "offline";
      } catch (pingErr) {
        console.error("Initial ping failed on device creation:", pingErr);
      }
    }

    const [newDevice] = await db
      .insert(devices)
      .values({
        name,
        type,
        ipAddress: ipAddress || null,
        location: location || null,
        groupId: groupId || null,
        notes: notes || null,
        offlineAfterMinutes: offlineAfterMinutes ?? 10,
        pingEnabled: isPingMonitored,
        pingFailureThreshold: pingFailureThreshold ?? 3,
        notifyOnRto: notifyOnRto ?? true,
        lastPingAt: initialPingAt,
        lastPingOk: initialPingOk,
        lastPingRtt: initialPingRtt,
        status: initialStatus,
        statusChangedAt: initialPingAt,
        ingestTokenHash,
        isActive: true,
      })
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
        pingFailureThreshold: devices.pingFailureThreshold,
        notifyOnRto: devices.notifyOnRto,
        lastPingAt: devices.lastPingAt,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
        status: devices.status,
        createdAt: devices.createdAt,
      });

    // Invalidate Redis catalog, groups, & hapus dari daftar sumber tidak dikenal jika ada IP
    try {
      await redis.del("cache:devices:catalog");
      await redis.del("jagalog:fleet_summary");
      if (groupId) {
        await redis.del("jagalog:groups_summary");
      }
      if (ipAddress) {
        await redis.del(`device:ip:${ipAddress}`);
        await removeUnknownSourceIp(ipAddress);
      }
    } catch (err) {
      console.warn("Gagal memperbarui cache Redis setelah tambah perangkat:", err);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Perangkat '${newDevice.name}' berhasil ditambahkan (Status: ${newDevice.status.toUpperCase()}).`,
        device: newDevice,
        // Token ini HANYA dikembalikan sekali saat pembuatan
        ingestToken: rawIngestToken,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/devices error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server saat menambahkan perangkat." },
      { status: 500 }
    );
  }
}
