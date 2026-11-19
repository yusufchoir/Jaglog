import { db } from "./db";
import { devices, deviceGroups, logEvents, incidents, topologyNodes } from "./schema";
import { isDeviceOnline, calculateDeviceStatus, DeviceMonitoringStatus } from "./devices";
import { publishChangeImmediately } from "./events/publisher";
import { redis } from "./redis";
import { eq, desc, asc, and, gte, sql, inArray } from "drizzle-orm";

export interface FleetDevice {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
  location: string | null;
  groupId: string | null;
  groupName: string | null;
  groupColor: string | null;
  status: DeviceMonitoringStatus;
  calculatedStatus: DeviceMonitoringStatus;
  isOnline: boolean;
  lastSeenAt: Date | string | null;
  offlineAfterMinutes: number;
  pingEnabled: boolean;
  lastPingOk: boolean | null;
  lastPingRtt: number | null;
  logCount24h: number;
  openIncidentCount: number;
  criticalIncidentCount: number;
  createdAt: Date | string;
}

export interface FleetGroup {
  id: string;
  nama: string;
  deskripsi: string | null;
  warnaGaris: string;
  urutan: number;
  parentId: string | null;
  memberCount: number;
  onlineCount: number;
  openIncidentCount: number;
  criticalIncidentCount: number;
  worstStatus: "critical" | "warning" | "offline" | "normal";
  createdAt: Date | string;
}

export interface FleetSummary {
  devices: FleetDevice[];
  groups: FleetGroup[];
  stats: {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    logStoppedDevices: number;
    unknownDevices: number;
    totalIncidents: number;
    criticalIncidents: number;
  };
}

const FLEET_CACHE_KEY = "jagalog:fleet_summary";
const FLEET_CACHE_TTL = 15; // 15 detik

/**
 * Single source of truth read model untuk seluruh armada (perangkat + grup).
 * Menggantikan query N+1 dan fetch ganda antar halaman.
 */
export async function getFleetSummary(forceFresh = false): Promise<FleetSummary> {
  // Cek cache Redis jika tidak dipaksa fresh
  if (!forceFresh) {
    try {
      const cached = await redis.get(FLEET_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Abaikan redis error dan lanjut query DB
    }
  }

  // 1. Ambil seluruh master grup (1 query)
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

  // 2. Ambil seluruh perangkat dengan info grup (1 query)
  const allDevices = await db
    .select({
      id: devices.id,
      name: devices.name,
      type: devices.type,
      ipAddress: devices.ipAddress,
      location: devices.location,
      groupId: devices.groupId,
      groupName: deviceGroups.nama,
      groupColor: deviceGroups.warnaGaris,
      status: devices.status,
      lastSeenAt: devices.lastSeenAt,
      offlineAfterMinutes: devices.offlineAfterMinutes,
      pingEnabled: devices.pingEnabled,
      lastPingOk: devices.lastPingOk,
      lastPingRtt: devices.lastPingRtt,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .leftJoin(deviceGroups, eq(devices.groupId, deviceGroups.id))
    .orderBy(asc(devices.name));

  // 3. Agregasi hitungan log 24 jam terakhir (1 query dengan GROUP BY device_id, TANPA N+1!)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const logCounts = await db
    .select({
      deviceId: logEvents.deviceId,
      total: sql<number>`count(*)::int`,
    })
    .from(logEvents)
    .where(gte(logEvents.eventTime, twentyFourHoursAgo))
    .groupBy(logEvents.deviceId);

  const logMap = new Map<string, number>();
  for (const r of logCounts) {
    if (r.deviceId) logMap.set(r.deviceId, r.total);
  }

  // 4. Agregasi insiden terbuka (1 query dengan GROUP BY device_id, severity, TANPA N+1!)
  const incidentCounts = await db
    .select({
      deviceId: incidents.deviceId,
      severity: incidents.severity,
      total: sql<number>`count(*)::int`,
    })
    .from(incidents)
    .where(eq(incidents.status, "open"))
    .groupBy(incidents.deviceId, incidents.severity);

  const incidentMap = new Map<string, { total: number; critical: number }>();
  for (const r of incidentCounts) {
    if (!r.deviceId) continue;
    const cur = incidentMap.get(r.deviceId) || { total: 0, critical: 0 };
    cur.total += r.total;
    if (r.severity === "critical") cur.critical += r.total;
    incidentMap.set(r.deviceId, cur);
  }

  // 5. Rakit data perangkat
  const enrichedDevices: FleetDevice[] = allDevices.map((d) => {
    const calcStatus = calculateDeviceStatus({
      lastSeenAt: d.lastSeenAt,
      offlineAfterMinutes: d.offlineAfterMinutes,
      pingEnabled: d.pingEnabled,
      lastPingOk: d.lastPingOk,
      lastPingAt: null,
    });
    const inc = incidentMap.get(d.id) || { total: 0, critical: 0 };
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      ipAddress: d.ipAddress,
      location: d.location,
      groupId: d.groupId,
      groupName: d.groupName,
      groupColor: d.groupColor,
      status: (d.status as DeviceMonitoringStatus) || calcStatus,
      calculatedStatus: calcStatus,
      isOnline: isDeviceOnline(d.lastSeenAt, d.offlineAfterMinutes),
      lastSeenAt: d.lastSeenAt,
      offlineAfterMinutes: d.offlineAfterMinutes,
      pingEnabled: d.pingEnabled,
      lastPingOk: d.lastPingOk,
      lastPingRtt: d.lastPingRtt,
      logCount24h: logMap.get(d.id) || 0,
      openIncidentCount: inc.total,
      criticalIncidentCount: inc.critical,
      createdAt: d.createdAt,
    };
  });

  // 6. Rakit data grup teragregasi
  const enrichedGroups: FleetGroup[] = allGroups.map((g) => {
    const members = enrichedDevices.filter((d) => d.groupId === g.id);
    const memberCount = members.length;
    const onlineCount = members.filter((d) => d.isOnline).length;
    const groupIncidents = members.reduce((acc, d) => acc + d.openIncidentCount, 0);
    const groupCritical = members.reduce((acc, d) => acc + d.criticalIncidentCount, 0);

    let worstStatus: "critical" | "warning" | "offline" | "normal" = "normal";
    if (groupCritical > 0) {
      worstStatus = "critical";
    } else if (members.some((d) => d.calculatedStatus === "offline")) {
      worstStatus = "offline";
    } else if (groupIncidents > 0 || members.some((d) => d.calculatedStatus === "log_stopped")) {
      worstStatus = "warning";
    }

    return {
      id: g.id,
      nama: g.nama,
      deskripsi: g.deskripsi,
      warnaGaris: g.warnaGaris,
      urutan: g.urutan,
      parentId: g.parentId,
      memberCount,
      onlineCount,
      openIncidentCount: groupIncidents,
      criticalIncidentCount: groupCritical,
      worstStatus,
      createdAt: g.createdAt,
    };
  });

  // 7. Hitung ringkasan armada global
  const summary: FleetSummary = {
    devices: enrichedDevices,
    groups: enrichedGroups,
    stats: {
      totalDevices: enrichedDevices.length,
      onlineDevices: enrichedDevices.filter((d) => d.isOnline).length,
      offlineDevices: enrichedDevices.filter((d) => d.calculatedStatus === "offline").length,
      logStoppedDevices: enrichedDevices.filter((d) => d.calculatedStatus === "log_stopped").length,
      unknownDevices: enrichedDevices.filter((d) => d.calculatedStatus === "unknown").length,
      totalIncidents: Array.from(incidentMap.values()).reduce((a, b) => a + b.total, 0),
      criticalIncidents: Array.from(incidentMap.values()).reduce((a, b) => a + b.critical, 0),
    },
  };

  // Simpan ke Redis cache
  try {
    await redis.set(FLEET_CACHE_KEY, JSON.stringify(summary), "EX", FLEET_CACHE_TTL);
  } catch {
    // Abaikan error redis
  }

  return summary;
}

/**
 * Satu jalur tulis keanggotaan grup perangkat (Single Write Handler).
 * Dipakai oleh form perangkat, aksi massal, halaman grup, dan kanvas peta.
 * Menjalankan update dalam 1 transaksi atomik, menginvalidasi cache, dan memancarkan SSE grup.berubah.
 */
export async function setDeviceGroup(options: {
  deviceIds: string[];
  groupId: string | null;
  targetPosition?: { x: number; y: number };
  mapId?: string;
  clientId?: string;
}): Promise<{
  success: boolean;
  updatedDevices: Array<{ id: string; name: string; groupId: string | null }>;
  targetGroup: { id: string; nama: string; warnaGaris: string } | null;
}> {
  const { deviceIds, groupId, targetPosition, mapId, clientId } = options;

  if (!deviceIds || deviceIds.length === 0) {
    throw new Error("Tidak ada perangkat yang dipilih untuk dipindahkan.");
  }

  if (deviceIds.length > 200) {
    throw new Error("Batas maksimal aksi massal adalah 200 perangkat.");
  }

  let targetGroup: { id: string; nama: string; warnaGaris: string } | null = null;

  // 1. Verifikasi keberadaan grup target jika bukan null
  if (groupId) {
    const [foundGroup] = await db
      .select({
        id: deviceGroups.id,
        nama: deviceGroups.nama,
        warnaGaris: deviceGroups.warnaGaris,
      })
      .from(deviceGroups)
      .where(eq(deviceGroups.id, groupId))
      .limit(1);

    if (!foundGroup) {
      throw new Error("Grup target tidak ditemukan.");
    }
    targetGroup = foundGroup;
  }

  // 2. Eksekusi transaksi atomik
  const updatedDevices = await db.transaction(async (tx) => {
    // Update devices.group_id
    const updated = await tx
      .update(devices)
      .set({
        groupId: groupId || null,
      })
      .where(inArray(devices.id, deviceIds))
      .returning({
        id: devices.id,
        name: devices.name,
        groupId: devices.groupId,
      });

    // Jika ada koordinat posisi baru untuk peta, update posisi node di peta
    if (targetPosition) {
      const nodeUpdates: any = {
        x: Math.round(targetPosition.x * 10) / 10,
        y: Math.round(targetPosition.y * 10) / 10,
        updatedAt: new Date(),
      };
      if (mapId) {
        await tx
          .update(topologyNodes)
          .set(nodeUpdates)
          .where(
            and(
              eq(topologyNodes.mapId, mapId),
              inArray(topologyNodes.deviceId, deviceIds)
            )
          );
      } else {
        await tx
          .update(topologyNodes)
          .set(nodeUpdates)
          .where(inArray(topologyNodes.deviceId, deviceIds));
      }
    }

    return updated;
  });

  // 3. Invalidate Redis Caches
  try {
    await redis.del(FLEET_CACHE_KEY);
    await redis.del("jagalog:groups_summary");
    for (const devId of deviceIds) {
      await redis.del(`cache:device:stats:${devId}`);
    }
  } catch (err) {
    console.warn("Gagal menghapus cache Redis:", err);
  }

  // 4. Publikasikan SATU event SSE grup.berubah
  try {
    await publishChangeImmediately({
      id: `evt_group_${Date.now()}`,
      tipe: "grup.berubah",
      perangkat_id: deviceIds.length === 1 ? deviceIds[0] : null,
      versi: Date.now(),
      waktu: new Date().toISOString(),
      clientId,
      data_ringkas: {
        jenis: "keanggotaan",
        device_ids: deviceIds,
        group_id: groupId,
        group_name: targetGroup ? targetGroup.nama : "Tanpa Grup",
        client_id: clientId,
      },
    });
  } catch (sseErr) {
    console.warn("Gagal memancarkan SSE grup.berubah:", sseErr);
  }

  return {
    success: true,
    updatedDevices,
    targetGroup,
  };
}
