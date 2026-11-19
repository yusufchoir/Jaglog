import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import {
  topologyNodes,
  topologyLinks,
  devices,
  incidents,
  logEvents,
  aiAnalyses,
  deviceStatusHistory,
} from "@shared/schema";
import { eq, sql, and, desc, or } from "drizzle-orm";
import { calculateDeviceUptime, getDeviceStatusTimeline } from "@shared/monitoring";
import { redis } from "@shared/redis";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const nodeId = params.id;
    const cacheKey = `cache:peta:node:${nodeId}`;

    // Cek cache Redis
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached));
      }
    } catch {
      // Abaikan jika Redis gagal
    }

    // 1. Ambil data node
    const [node] = await db
      .select({
        id: topologyNodes.id,
        mapId: topologyNodes.mapId,
        deviceId: topologyNodes.deviceId,
        tipeVirtual: topologyNodes.tipeVirtual,
        label: topologyNodes.label,
        x: topologyNodes.x,
        y: topologyNodes.y,
        terkunci: topologyNodes.terkunci,
      })
      .from(topologyNodes)
      .where(eq(topologyNodes.id, nodeId))
      .limit(1);

    if (!node) {
      return NextResponse.json(
        { error: "Node topologi tidak ditemukan." },
        { status: 404 }
      );
    }

    // 2. Ambil koneksi terkait node ini (link source atau target)
    const connectedLinks = await db
      .select({
        linkId: topologyLinks.id,
        sourceNodeId: topologyLinks.sourceNodeId,
        targetNodeId: topologyLinks.targetNodeId,
        label: topologyLinks.label,
        tipe: topologyLinks.tipe,
      })
      .from(topologyLinks)
      .where(
        and(
          eq(topologyLinks.mapId, node.mapId),
          or(
            eq(topologyLinks.sourceNodeId, node.id),
            eq(topologyLinks.targetNodeId, node.id)
          )
        )
      );

    // Ambil info node-node yang terhubung dengannya
    const otherNodeIds = connectedLinks.map((l) =>
      l.sourceNodeId === node.id ? l.targetNodeId : l.sourceNodeId
    );

    let connectedNodesDetail: Array<{
      nodeId: string;
      nama: string;
      tipe: string;
      status: string;
      linkLabel: string | null;
      linkType: string;
    }> = [];

    if (otherNodeIds.length > 0) {
      const otherNodes = await db
        .select({
          id: topologyNodes.id,
          deviceId: topologyNodes.deviceId,
          tipeVirtual: topologyNodes.tipeVirtual,
          label: topologyNodes.label,
          devName: devices.name,
          devType: devices.type,
          devStatus: devices.status,
        })
        .from(topologyNodes)
        .leftJoin(devices, eq(topologyNodes.deviceId, devices.id))
        .where(sql`${topologyNodes.id} IN ${otherNodeIds}`);

      connectedNodesDetail = otherNodes.map((on) => {
        const link = connectedLinks.find(
          (l) => l.sourceNodeId === on.id || l.targetNodeId === on.id
        );
        const isVirt = !on.deviceId;
        return {
          nodeId: on.id,
          nama: isVirt ? (on.label || "Node Virtual") : (on.devName || "Perangkat"),
          tipe: isVirt ? (on.tipeVirtual || "virtual") : (on.devType || "other"),
          status: isVirt ? "online" : (on.devStatus || "unknown"),
          linkLabel: link?.label || null,
          linkType: link?.tipe || "kabel",
        };
      });
    }

    // Kasus Node Virtual (mis. Internet, ISP, Cloud)
    if (!node.deviceId) {
      const virtualPayload = {
        node: {
          id: node.id,
          mapId: node.mapId,
          isVirtual: true,
          tipeVirtual: node.tipeVirtual,
          nama: node.label || "Node Virtual",
          tipe: node.tipeVirtual || "virtual",
          status: "online",
          ip: null,
          lokasi: null,
          catatan: null,
          statusDurationText: "Aktif",
        },
        koneksi: connectedNodesDetail,
      };

      try {
        await redis.set(cacheKey, JSON.stringify(virtualPayload), "EX", 15);
      } catch {}

      return NextResponse.json(virtualPayload);
    }

    // Kasus Node Perangkat Fisik
    const deviceId = node.deviceId;
    const [device] = await db
      .select({
        id: devices.id,
        name: devices.name,
        type: devices.type,
        ipAddress: devices.ipAddress,
        location: devices.location,
        notes: devices.notes,
        status: devices.status,
        statusChangedAt: devices.statusChangedAt,
        lastSeenAt: devices.lastSeenAt,
        lastPingAt: devices.lastPingAt,
        lastPingOk: devices.lastPingOk,
        lastPingRtt: devices.lastPingRtt,
        pingEnabled: devices.pingEnabled,
        offlineAfterMinutes: devices.offlineAfterMinutes,
      })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!device) {
      return NextResponse.json(
        { error: "Data perangkat terkait tidak ditemukan." },
        { status: 404 }
      );
    }

    // Hitung Uptime & Riwayat Status 24h / 7d
    const uptime = await calculateDeviceUptime(deviceId);
    const statusTimeline = await getDeviceStatusTimeline(deviceId);

    // Hitung distribusi log 24 jam per severity (RFC 5424)
    // 0=Emergency, 1=Alert, 2=Critical, 3=Error, 4=Warning, 5=Notice, 6=Info, 7=Debug
    const logCountsBySeverity = await db.execute<{ severity: number; count: string }>(sql`
      SELECT severity, COUNT(*)::text as count
      FROM log_events
      WHERE device_id = ${deviceId}::uuid
        AND event_time >= NOW() - INTERVAL '24 hours'
      GROUP BY severity
    `);

    let sevCritical = 0;
    let sevError = 0;
    let sevWarning = 0;
    let sevInfo = 0;
    let totalLogs24h = 0;

    for (const r of logCountsBySeverity) {
      const c = parseInt(r.count, 10);
      totalLogs24h += c;
      const s = r.severity;
      if (s <= 2) sevCritical += c;
      else if (s === 3) sevError += c;
      else if (s === 4) sevWarning += c;
      else sevInfo += c; // 5, 6, 7
    }

    // Laju log terakhir (log dalam 1 jam terakhir / 60 = log/menit)
    const [logsLastHour] = await db
      .select({ count: sql<string>`count(*)` })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, deviceId),
          sql`${logEvents.eventTime} >= NOW() - INTERVAL '1 hour'`
        )
      );
    const logRatePerMinute = Math.round((parseInt(logsLastHour?.count || "0", 10) / 60) * 10) / 10;

    // 5 Event log terbaru (tanpa field raw mentah, tanpa token)
    const recentEvents = await db
      .select({
        id: logEvents.id,
        eventTime: logEvents.eventTime,
        severity: logEvents.severity,
        category: logEvents.category,
        message: logEvents.message,
      })
      .from(logEvents)
      .where(eq(logEvents.deviceId, deviceId))
      .orderBy(desc(logEvents.eventTime))
      .limit(5);

    // Insiden terbuka untuk perangkat ini
    const openIncidents = await db
      .select({
        id: incidents.id,
        severity: incidents.severity,
        title: incidents.title,
        status: incidents.status,
        firstSeen: incidents.firstSeen,
        lastSeen: incidents.lastSeen,
        count: incidents.count,
      })
      .from(incidents)
      .where(
        and(
          eq(incidents.deviceId, deviceId),
          eq(incidents.status, "open")
        )
      )
      .orderBy(desc(incidents.lastSeen))
      .limit(5);

    // Analisa AI terakhir untuk perangkat ini
    const [latestAi] = await db
      .select({
        id: aiAnalyses.id,
        riskLevel: aiAnalyses.riskLevel,
        summary: aiAnalyses.summary,
        recommendations: aiAnalyses.recommendations,
        suspectedAttack: aiAnalyses.suspectedAttack,
        createdAt: aiAnalyses.createdAt,
      })
      .from(aiAnalyses)
      .where(eq(aiAnalyses.deviceId, deviceId))
      .orderBy(desc(aiAnalyses.createdAt))
      .limit(1);

    // Hitung durasi status saat ini (mis. "sejak 14 menit lalu")
    let statusDurationText = "-";
    if (device.statusChangedAt) {
      const diffMs = Date.now() - new Date(device.statusChangedAt).getTime();
      const diffMins = Math.max(1, Math.floor(diffMs / 60000));
      if (diffMins < 60) {
        statusDurationText = `sejak ${diffMins} menit lalu`;
      } else {
        const hours = Math.floor(diffMins / 60);
        statusDurationText = `sejak ${hours} jam lalu`;
      }
    }

    const payload = {
      node: {
        id: node.id,
        mapId: node.mapId,
        deviceId: device.id,
        isVirtual: false,
        nama: device.name,
        tipe: device.type,
        ip: device.ipAddress,
        lokasi: device.location,
        catatan: device.notes,
        status: device.status || "unknown",
        statusDurationText,
        lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
        ping: {
          enabled: device.pingEnabled,
          isOk: device.lastPingOk,
          lastPingAt: device.lastPingAt ? device.lastPingAt.toISOString() : null,
          rttMs: device.lastPingRtt ?? null,
        },
        uptime: {
          uptime24h: uptime?.uptime24h ?? null,
          uptime7d: uptime?.uptime7d ?? null,
        },
        statusTimeline,
      },
      logStats: {
        total24h: totalLogs24h,
        breakdown: {
          critical: sevCritical,
          error: sevError,
          warning: sevWarning,
          info: sevInfo,
        },
        ratePerMinute: logRatePerMinute,
        recentEvents: recentEvents.map((e) => ({
          id: e.id,
          eventTime: e.eventTime.toISOString(),
          severity: e.severity,
          category: e.category,
          message: e.message.length > 120 ? e.message.slice(0, 120) + "..." : e.message,
        })),
      },
      insidenTerbuka: openIncidents.map((inc) => ({
        id: inc.id,
        severity: inc.severity,
        title: inc.title,
        count: inc.count,
        firstSeen: inc.firstSeen.toISOString(),
        lastSeen: inc.lastSeen.toISOString(),
      })),
      analisaAi: latestAi
        ? {
            id: latestAi.id,
            riskLevel: latestAi.riskLevel,
            summary: latestAi.summary,
            recommendations: (latestAi.recommendations as string[]) || [],
            suspectedAttack: latestAi.suspectedAttack,
            createdAt: latestAi.createdAt.toISOString(),
          }
        : null,
      koneksi: connectedNodesDetail,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(payload), "EX", 15);
    } catch {}

    return NextResponse.json(payload);
  } catch (err: any) {
    console.error("GET /api/peta/node/[id]/detail Error:", err);
    return NextResponse.json(
      { error: "Gagal memuat rincian node topologi." },
      { status: 500 }
    );
  }
}
