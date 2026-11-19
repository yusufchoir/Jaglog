import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import {
  topologyMaps,
  topologyNodes,
  topologyLinks,
  devices,
  deviceGroups,
  incidents,
  logEvents,
  userMapViewStates,
} from "@shared/schema";
import { eq, sql, and, desc, asc, inArray } from "drizzle-orm";
import { redis } from "@shared/redis";

export const dynamic = "force-dynamic";

const PETA_CACHE_TTL = 20; // detik

async function getUserTampilan(userId: string, mapId: string) {
  try {
    const [viewState] = await db
      .select({ collapsedGroupIds: userMapViewStates.collapsedGroupIds })
      .from(userMapViewStates)
      .where(
        and(
          eq(userMapViewStates.userId, userId),
          eq(userMapViewStates.mapId, mapId)
        )
      )
      .limit(1);

    return {
      grup_terlipat:
        viewState?.collapsedGroupIds && Array.isArray(viewState.collapsedGroupIds)
          ? viewState.collapsedGroupIds
          : [],
    };
  } catch (err) {
    console.error("Gagal mengambil preferensi tampilan pengguna:", err);
    return { grup_terlipat: [] };
  }
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const petaIdParam = searchParams.get("peta_id");

    // 1. Tentukan peta aktif (sesuai peta_id atau peta default)
    let activeMap;
    if (petaIdParam) {
      [activeMap] = await db
        .select()
        .from(topologyMaps)
        .where(eq(topologyMaps.id, petaIdParam))
        .limit(1);
    }

    if (!activeMap) {
      [activeMap] = await db
        .select()
        .from(topologyMaps)
        .where(eq(topologyMaps.isDefault, true))
        .limit(1);
    }

    // Jika belum ada peta sama sekali, buat peta default secara otomatis
    if (!activeMap) {
      const [newMap] = await db
        .insert(topologyMaps)
        .values({
          nama: "Peta Jaringan Utama",
          isDefault: true,
          isDemo: false,
        })
        .returning();
      activeMap = newMap;
    }

    const cacheKey = `cache:peta:${activeMap.id}`;

    // 2. Cek Cache Redis
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        const tampilan = await getUserTampilan(session.user.userId, activeMap.id);
        return NextResponse.json({
          ...parsed,
          tampilan,
          currentUser: { username: session.user.username, role: session.user.role },
        });
      }
    } catch {
      // Abaikan jika Redis gagal
    }

    // 3. Ambil seluruh master grup dari device_groups (SATU SUMBER KEBENARAN)
    const masterGroups = await db
      .select({
        id: deviceGroups.id,
        nama: deviceGroups.nama,
        warnaGaris: deviceGroups.warnaGaris,
        urutan: deviceGroups.urutan,
        parentId: deviceGroups.parentId,
        createdAt: deviceGroups.createdAt,
      })
      .from(deviceGroups)
      .orderBy(asc(deviceGroups.urutan), asc(deviceGroups.nama));

    const groups = masterGroups.map((g) => ({
      id: g.id,
      mapId: activeMap.id,
      deviceGroupId: g.id,
      nama: g.nama,
      warnaGaris: g.warnaGaris || "biru",
      x: 0,
      y: 0,
      lebar: 320,
      tinggi: 220,
      createdAt: g.createdAt,
      updatedAt: g.createdAt,
    }));

    // 4. Ambil seluruh node pada peta ini
    const nodes = await db
      .select({
        id: topologyNodes.id,
        mapId: topologyNodes.mapId,
        deviceId: topologyNodes.deviceId,
        tipeVirtual: topologyNodes.tipeVirtual,
        label: topologyNodes.label,
        x: topologyNodes.x,
        y: topologyNodes.y,
        terkunci: topologyNodes.terkunci,
        isDemo: topologyNodes.isDemo,
        createdAt: topologyNodes.createdAt,
        // Kolom perangkat jika terhubung ke device fisik
        devName: devices.name,
        devType: devices.type,
        devIp: devices.ipAddress,
        devLocation: devices.location,
        devGroupId: devices.groupId, // <-- Sumber keanggotaan tunggal!
        devStatus: devices.status,
        devStatusChangedAt: devices.statusChangedAt,
        devLastSeenAt: devices.lastSeenAt,
        devLastPingOk: devices.lastPingOk,
        devLastPingRtt: devices.lastPingRtt,
        devPingEnabled: devices.pingEnabled,
        devNotes: devices.notes,
      })
      .from(topologyNodes)
      .leftJoin(devices, eq(topologyNodes.deviceId, devices.id))
      .where(eq(topologyNodes.mapId, activeMap.id));

    // 5. Agregasi Insiden Terbuka per Device (Query Teragregasi Tanpa N+1)
    const incidentCounts = await db.execute<{
      device_id: string;
      severity: string;
      count: string;
    }>(sql`
      SELECT device_id, severity, COUNT(*)::text as count
      FROM incidents
      WHERE status = 'open'
      GROUP BY device_id, severity
    `);

    const devIncidentsMap = new Map<
      string,
      { critical: number; high: number; medium: number; low: number; total: number }
    >();

    for (const row of incidentCounts) {
      if (!row.device_id) continue;
      const cur = devIncidentsMap.get(row.device_id) || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        total: 0,
      };
      const cnt = parseInt(row.count, 10);
      const sev = row.severity.toLowerCase() as "critical" | "high" | "medium" | "low";
      if (sev in cur) {
        cur[sev] += cnt;
        cur.total += cnt;
      }
      devIncidentsMap.set(row.device_id, cur);
    }

    // 6. Format Node Ringkas
    const formattedNodes = nodes.map((n) => {
      const isVirtual = !n.deviceId;
      const inc = n.deviceId
        ? devIncidentsMap.get(n.deviceId) || { critical: 0, high: 0, medium: 0, low: 0, total: 0 }
        : { critical: 0, high: 0, medium: 0, low: 0, total: 0 };

      let pingStatus: "up" | "rto" | "disabled" | "unknown" = "unknown";
      if (!isVirtual) {
        if (!n.devPingEnabled) {
          pingStatus = "disabled";
        } else if (n.devLastPingOk === true) {
          pingStatus = "up";
        } else if (n.devLastPingOk === false) {
          pingStatus = "rto";
        }
      } else {
        pingStatus = "up";
      }

      const st = isVirtual ? "online" : (n.devStatus || "unknown");

      return {
        id: n.id,
        mapId: n.mapId,
        deviceId: n.deviceId,
        isVirtual,
        tipeVirtual: n.tipeVirtual,
        nama: isVirtual ? (n.label || "Node Virtual") : (n.devName || "Perangkat"),
        tipe: isVirtual ? (n.tipeVirtual || "other") : (n.devType || "other"),
        ip: n.devIp || null,
        lokasi: n.devLocation || null,
        status: st as "online" | "log_stopped" | "offline" | "unknown",
        statusChangedAt: n.devStatusChangedAt ? n.devStatusChangedAt.toISOString() : null,
        lastSeenAt: n.devLastSeenAt ? n.devLastSeenAt.toISOString() : null,
        pingStatus,
        rttMs: n.devLastPingRtt ?? null,
        insidenTerbuka: inc,
        x: n.x,
        y: n.y,
        groupId: isVirtual ? null : (n.devGroupId || null),
        terkunci: n.terkunci,
      };
    });

    // 7. Ambil seluruh link antar node pada peta ini
    const links = await db
      .select({
        id: topologyLinks.id,
        mapId: topologyLinks.mapId,
        sourceNodeId: topologyLinks.sourceNodeId,
        targetNodeId: topologyLinks.targetNodeId,
        label: topologyLinks.label,
        tipe: topologyLinks.tipe,
        isDemo: topologyLinks.isDemo,
      })
      .from(topologyLinks)
      .where(eq(topologyLinks.mapId, activeMap.id));

    // 8. Ambil perangkat yang belum ditempatkan di peta ini
    const placedDeviceIds = nodes
      .map((n) => n.deviceId)
      .filter((id): id is string => Boolean(id));

    let unplacedDevices: Array<{
      id: string;
      name: string;
      type: string;
      ipAddress: string | null;
      location: string | null;
      groupId: string | null;
      status: string;
    }> = [];

    if (placedDeviceIds.length > 0) {
      unplacedDevices = await db
        .select({
          id: devices.id,
          name: devices.name,
          type: devices.type,
          ipAddress: devices.ipAddress,
          location: devices.location,
          groupId: devices.groupId,
          status: devices.status,
        })
        .from(devices)
        .where(
          and(
            eq(devices.isActive, true),
            sql`${devices.id} NOT IN ${placedDeviceIds}`
          )
        )
        .orderBy(devices.name);
    } else {
      unplacedDevices = await db
        .select({
          id: devices.id,
          name: devices.name,
          type: devices.type,
          ipAddress: devices.ipAddress,
          location: devices.location,
          groupId: devices.groupId,
          status: devices.status,
        })
        .from(devices)
        .where(eq(devices.isActive, true))
        .orderBy(devices.name);
    }

    // 9. Hitung Ringkasan NOC untuk Widget
    let onlineCount = 0;
    let logStoppedCount = 0;
    let offlineCount = 0;
    let unknownCount = 0;

    const byTypeMap = new Map<
      string,
      { count: number; online: number; problematic: number; openIncidents: number }
    >();

    const totalIncidents = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: 0,
    };

    for (const node of formattedNodes) {
      if (node.status === "online") onlineCount++;
      else if (node.status === "log_stopped") logStoppedCount++;
      else if (node.status === "offline") offlineCount++;
      else unknownCount++;

      // Agregasi tipe
      const t = node.tipe.toLowerCase();
      const curType = byTypeMap.get(t) || { count: 0, online: 0, problematic: 0, openIncidents: 0 };
      curType.count++;
      if (node.status === "online") curType.online++;
      if (node.status === "log_stopped" || node.status === "offline") curType.problematic++;
      curType.openIncidents += node.insidenTerbuka.total;
      byTypeMap.set(t, curType);

      // Agregasi insiden
      totalIncidents.critical += node.insidenTerbuka.critical;
      totalIncidents.high += node.insidenTerbuka.high;
      totalIncidents.medium += node.insidenTerbuka.medium;
      totalIncidents.low += node.insidenTerbuka.low;
      totalIncidents.total += node.insidenTerbuka.total;
    }

    const byTypeSummary = Array.from(byTypeMap.entries()).map(([tipe, stats]) => ({
      tipe,
      ...stats,
    }));

    // Heatmap node list: urutkan yang bermasalah di depan
    const heatmapNodes = [...formattedNodes].sort((a, b) => {
      const score = (n: typeof a) => {
        if (n.status === "offline") return 4;
        if (n.insidenTerbuka.critical > 0 || n.insidenTerbuka.high > 0) return 3;
        if (n.status === "log_stopped") return 2;
        if (n.status === "unknown") return 1;
        return 0;
      };
      return score(b) - score(a);
    });

    // 5 Insiden Terbaru untuk Widget Alarm
    const recentIncidents = await db
      .select({
        id: incidents.id,
        deviceId: incidents.deviceId,
        deviceName: devices.name,
        deviceType: devices.type,
        severity: incidents.severity,
        title: incidents.title,
        status: incidents.status,
        lastSeen: incidents.lastSeen,
      })
      .from(incidents)
      .leftJoin(devices, eq(incidents.deviceId, devices.id))
      .where(eq(incidents.status, "open"))
      .orderBy(desc(incidents.lastSeen))
      .limit(5);

    // Hitung node online per grup
    const formattedGroups = groups.map((g) => {
      const groupNodes = formattedNodes.filter((n) => n.groupId === g.id);
      const onlineNodesInGroup = groupNodes.filter((n) => n.status === "online").length;
      return {
        ...g,
        totalNodes: groupNodes.length,
        onlineNodes: onlineNodesInGroup,
      };
    });

    // Ambil daftar semua peta yang ada untuk pemilih peta (map selector)
    const allMaps = await db
      .select({
        id: topologyMaps.id,
        nama: topologyMaps.nama,
        isDefault: topologyMaps.isDefault,
        createdAt: topologyMaps.createdAt,
      })
      .from(topologyMaps)
      .orderBy(desc(topologyMaps.isDefault), topologyMaps.nama);

    const payload = {
      peta: {
        id: activeMap.id,
        nama: activeMap.nama,
        isDefault: activeMap.isDefault,
        isDemo: activeMap.isDemo,
        createdAt: activeMap.createdAt,
      },
      daftarPeta: allMaps,
      grup: formattedGroups,
      node: formattedNodes,
      link: links,
      belumDitempatkan: unplacedDevices,
      ringkasan: {
        totalNodes: formattedNodes.length,
        onlineCount,
        logStoppedCount,
        offlineCount,
        unknownCount,
        insiden: totalIncidents,
        perJenis: byTypeSummary,
        heatmap: heatmapNodes,
        alarmTerbaru: recentIncidents,
      },
      versi: Date.now(),
    };

    // Tulis ke cache Redis
    try {
      await redis.set(cacheKey, JSON.stringify(payload), "EX", PETA_CACHE_TTL);
    } catch {
      // Abaikan
    }

    const tampilan = await getUserTampilan(session.user.userId, activeMap.id);

    return NextResponse.json({
      ...payload,
      tampilan,
      currentUser: { username: session.user.username, role: session.user.role },
    });
  } catch (err: any) {
    console.error("GET /api/peta Error:", err);
    return NextResponse.json(
      { error: "Gagal memuat data peta jaringan." },
      { status: 500 }
    );
  }
}
