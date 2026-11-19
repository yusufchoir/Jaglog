import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups, logEvents, incidents, aiAnalyses, deviceStatusHistory, deviceLogHourly } from "@shared/schema";
import { eq, sql, and, desc } from "drizzle-orm";
import { calculateDeviceUptime, getDeviceStatusTimeline, generate24HourBucketsWib, computeChartSummary, HourlyBucketData } from "@shared/monitoring";
import { getDeviceIngestDiagnostics, getUnknownSourcesList } from "@shared/ingest-diagnostics";
import { redis } from "@shared/redis";
import { sanitizeForJson, safeJsonStringify } from "@shared/serialization";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  const startTime = performance.now();
  let dbTime = 0;
  let cacheTime = 0;

  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const resolvedParams = await Promise.resolve(params);
    const deviceId = resolvedParams?.id;

    // Validasi format UUID untuk mencegah error sintaks database 500
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!deviceId || !uuidRegex.test(deviceId)) {
      return NextResponse.json(
        { error: "Format ID perangkat tidak valid." },
        { status: 400 }
      );
    }
    const cacheKey = `cache:device:stats:${deviceId}`;

    const cacheStart = performance.now();
    try {
      const cached = await redis.get(cacheKey);
      cacheTime = performance.now() - cacheStart;
      if (cached) {
        const parsedCache = JSON.parse(cached);
        const [freshIngestDiag, freshUnknownSources] = await Promise.all([
          getDeviceIngestDiagnostics(deviceId),
          session.user.role === "admin" ? getUnknownSourcesList() : Promise.resolve([]),
        ]);
        parsedCache.ingestDiagnostics = freshIngestDiag;
        if (session.user.role === "admin") {
          parsedCache.unknownSources = freshUnknownSources;
        }
        const totalDuration = performance.now() - startTime;
        const res = NextResponse.json(sanitizeForJson(parsedCache));
        res.headers.set(
          "Server-Timing",
          `cache;dur=${cacheTime.toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
        );
        return res;
      }
    } catch {
      cacheTime = performance.now() - cacheStart;
    }

    const dbStart = performance.now();

    // 1. Ambil data perangkat utama (Fail-fast bila 404)
    const [deviceRow] = await db
      .select({
        device: devices,
        groupName: deviceGroups.nama,
        groupWarnaGaris: deviceGroups.warnaGaris,
      })
      .from(devices)
      .leftJoin(deviceGroups, eq(devices.groupId, deviceGroups.id))
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!deviceRow?.device) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }
    const device = deviceRow.device;
    const groupName = deviceRow.groupName || null;
    const groupWarnaGaris = deviceRow.groupWarnaGaris || null;

    const now = new Date();
    const wibBucketsMeta = generate24HourBucketsWib(now);

    // 2. Eksekusi seluruh sub-query secara terisolasi via Promise.allSettled
    // Satu kegagalan sub-query (mis. timeout RTO atau ketiadaan AI) TIDAK membatalkan seluruh respons
    const [
      hourlySettled,
      prior24hSettled,
      catSettled,
      ipSettled,
      accSettled,
      aiSettled,
      openIncidentsSettled,
      timelineSettled,
      uptimeSettled,
      rtoSettled,
    ] = await Promise.allSettled([
      db.execute<{
        hour_slot: string;
        received_count: string;
        stored_count: string;
        dropped_count: string;
        severity_critical: string;
        severity_error: string;
        severity_warning: string;
        severity_notice: string;
        severity_info: string;
        severity_debug: string;
      }>(sql`
        SELECT
          to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00') AS hour_slot,
          received_count::text,
          stored_count::text,
          dropped_count::text,
          severity_critical::text,
          severity_error::text,
          severity_warning::text,
          severity_notice::text,
          severity_info::text,
          severity_debug::text
        FROM device_log_hourly
        WHERE device_id = ${deviceId}::uuid
          AND hour_bucket >= NOW() - INTERVAL '48 hours'
        ORDER BY hour_bucket ASC
      `),
      db.execute<{ count: string }>(sql`
        SELECT COALESCE(SUM(received_count), 0)::text as count
        FROM device_log_hourly
        WHERE device_id = ${deviceId}::uuid
          AND hour_bucket >= NOW() - INTERVAL '48 hours'
          AND hour_bucket < NOW() - INTERVAL '24 hours'
      `),
      db.execute<{ category: string; count: string }>(sql`
        SELECT category, COUNT(*)::text as count
        FROM log_events
        WHERE device_id = ${deviceId}::uuid
          AND event_time >= NOW() - INTERVAL '24 hours'
        GROUP BY category
      `),
      db.execute<{ ip: string; count: string }>(sql`
        SELECT parsed->>'src_ip' AS ip, COUNT(*)::text as count
        FROM log_events
        WHERE device_id = ${deviceId}::uuid
          AND event_time >= NOW() - INTERVAL '24 hours'
          AND parsed->>'src_ip' IS NOT NULL
          AND parsed->>'src_ip' != ''
        GROUP BY parsed->>'src_ip'
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),
      db.execute<{ account: string; count: string }>(sql`
        SELECT parsed->>'actor' AS account, COUNT(*)::text as count
        FROM log_events
        WHERE device_id = ${deviceId}::uuid
          AND event_time >= NOW() - INTERVAL '24 hours'
          AND parsed->>'actor' IS NOT NULL
          AND parsed->>'actor' != ''
        GROUP BY parsed->>'actor'
        ORDER BY COUNT(*) DESC
        LIMIT 5
      `),
      db
        .select()
        .from(aiAnalyses)
        .where(eq(aiAnalyses.deviceId, deviceId))
        .orderBy(desc(aiAnalyses.createdAt))
        .limit(1),
      db
        .select({ count: sql<string>`count(*)` })
        .from(incidents)
        .where(
          and(
            eq(incidents.deviceId, deviceId),
            eq(incidents.status, "open")
          )
        ),
      getDeviceStatusTimeline(deviceId),
      calculateDeviceUptime(deviceId),
      db
        .select()
        .from(deviceStatusHistory)
        .where(
          and(
            eq(deviceStatusHistory.deviceId, deviceId),
            eq(deviceStatusHistory.status, "rto")
          )
        )
        .orderBy(desc(deviceStatusHistory.startedAt))
        .limit(10),
    ]);

    // Ekstraksi hasil terisolasi dengan nilai default aman
    const hourlyRows = hourlySettled.status === "fulfilled" ? (hourlySettled.value as any[]) : [];
    const prior24hRow = prior24hSettled.status === "fulfilled" ? (prior24hSettled.value as any[]) : [];
    const catRows = catSettled.status === "fulfilled" ? (catSettled.value as any[]) : [];
    const ipRows = ipSettled.status === "fulfilled" ? (ipSettled.value as any[]) : [];
    const accRows = accSettled.status === "fulfilled" ? (accSettled.value as any[]) : [];
    const aiRows = aiSettled.status === "fulfilled" ? (aiSettled.value as any[]) : [];
    const latestAi = aiRows[0] || null;
    const openIncidentRows = openIncidentsSettled.status === "fulfilled" ? (openIncidentsSettled.value as any[]) : [];
    const timeline = timelineSettled.status === "fulfilled" ? (timelineSettled.value as any[]) : [];
    const uptime = uptimeSettled.status === "fulfilled" ? (uptimeSettled.value as any) : { uptime24h: 100, uptime7d: 100 };
    const rtoHistory = rtoSettled.status === "fulfilled" ? (rtoSettled.value as any[]) : [];

    // Catat status kesehatan tiap bagian untuk observabilitas UI
    const sectionStatus = {
      device: "ok",
      hourlyVolume: hourlySettled.status === "fulfilled" ? (hourlyRows.length > 0 ? "ok" : "tanpa_data") : "gagal",
      severityBreakdown: hourlySettled.status === "fulfilled" ? (hourlyRows.length > 0 ? "ok" : "tanpa_data") : "gagal",
      categoryBreakdown: catSettled.status === "fulfilled" ? (catRows.length > 0 ? "ok" : "tanpa_data") : "gagal",
      topIp: ipSettled.status === "fulfilled" ? (ipRows.length > 0 ? "ok" : "tanpa_data") : "gagal",
      topAccounts: accSettled.status === "fulfilled" ? (accRows.length > 0 ? "ok" : "tanpa_data") : "gagal",
      latestAiAnalysis: aiSettled.status === "fulfilled" ? (latestAi ? "ok" : "tanpa_data") : "gagal",
      openIncidents: openIncidentsSettled.status === "fulfilled" ? "ok" : "gagal",
      timeline: timelineSettled.status === "fulfilled" ? (timeline.length > 0 ? "ok" : "tanpa_data") : "gagal",
      uptime: uptimeSettled.status === "fulfilled" ? "ok" : "gagal",
      rtoHistory: rtoSettled.status === "fulfilled" ? (rtoHistory.length > 0 ? "ok" : "tanpa_data") : "gagal",
    };

    const hourlyMap = new Map<string, any>();
    for (const r of hourlyRows) {
      if (r && r.hour_slot) {
        hourlyMap.set(r.hour_slot, r);
      }
    }

    let totCritical = 0;
    let totError = 0;
    let totWarning = 0;
    let totNotice = 0;
    let totInfo = 0;
    let totDebug = 0;

    const hourlyChart: HourlyBucketData[] = wibBucketsMeta.map((meta) => {
      const agg = hourlyMap.get(meta.fullTimeStr);
      const received = agg ? parseInt(agg.received_count || "0", 10) : 0;
      const critical = agg ? parseInt(agg.severity_critical || "0", 10) : 0;
      const error = agg ? parseInt(agg.severity_error || "0", 10) : 0;
      const warning = agg ? parseInt(agg.severity_warning || "0", 10) : 0;
      const notice = agg ? parseInt(agg.severity_notice || "0", 10) : 0;
      const info = agg ? parseInt(agg.severity_info || "0", 10) : 0;
      const debug = agg ? parseInt(agg.severity_debug || "0", 10) : 0;

      totCritical += critical;
      totError += error;
      totWarning += warning;
      totNotice += notice;
      totInfo += info;
      totDebug += debug;

      return {
        mulai: meta.start.toISOString(),
        selesai: meta.end.toISOString(),
        hour: meta.hourStr,
        fullTime: meta.fullTimeStr,
        labelWib: meta.labelWib,
        rentangWib: meta.rentangWib,
        tanggalWib: meta.tanggalWib,
        gantiHari: meta.gantiHari,
        jumlah_log: received,
        count: received,
        jumlah_per_severity: {
          critical,
          error,
          warning,
          notice,
          info,
          debug,
        },
        jumlah_perangkat_aktif: received > 0 ? 1 : 0,
        parsial: meta.isPartial,
        menitBerjalan: meta.elapsedMinutes,
        top_perangkat: received > 0 ? [{ id: device.id, name: device.name, count: received }] : [],
      };
    });

    const totalPrev24h = parseInt(prior24hRow[0]?.count || "0", 10);
    const chartSummary = computeChartSummary(hourlyChart, totalPrev24h);
    const totalLogs24h = chartSummary.total_24j;

    const formattedHourly = hourlyChart.map((h) => ({
      hour: h.hour,
      fullTime: h.fullTime,
      count: h.jumlah_log,
    }));

    const severityDistribution: Record<string, number> = {
      "2": totCritical,
      "3": totError,
      "4": totWarning,
      "5": totNotice,
      "6": totInfo,
      "7": totDebug,
    };

    const categoryDistribution: Record<string, number> = {};
    for (const r of catRows) {
      if (r && r.category) {
        categoryDistribution[r.category] = parseInt(r.count || "0", 10);
      }
    }

    const topSourceIps = ipRows
      .filter((r) => r && r.ip)
      .map((r) => ({ ip: r.ip, count: parseInt(r.count || "0", 10) }));

    const topAccounts = accRows
      .filter((r) => r && r.account)
      .map((r) => ({ account: r.account, count: parseInt(r.count || "0", 10) }));

    const openIncidentsCount = parseInt(openIncidentRows[0]?.count || "0", 10);

    const [ingestDiagnostics, unknownSources] = await Promise.all([
      getDeviceIngestDiagnostics(deviceId),
      session.user.role === "admin" ? getUnknownSourcesList() : Promise.resolve([]),
    ]);

    const effectiveStatus = device.isActive ? (device.status || "unknown") : "unknown";
    const effectiveIsOnline = device.isActive ? effectiveStatus === "online" : false;

    const deviceDetail = {
      id: device.id,
      name: device.name,
      ip: device.ipAddress,
      ipAddress: device.ipAddress,
      type: device.type,
      location: device.location || null,
      groupId: device.groupId || null,
      groupName,
      groupWarnaGaris,
      notes: device.notes || null,
      isActive: device.isActive,
      offlineAfterMinutes: device.offlineAfterMinutes,
      pingEnabled: device.pingEnabled,
      pingFailureThreshold: device.pingFailureThreshold,
      notifyOnRto: device.notifyOnRto,
      timezone: device.timezone,
      status: effectiveStatus,
      statusChangedAt: device.statusChangedAt,
      lastPingAt: device.lastPingAt,
      lastPingOk: device.isActive ? device.lastPingOk : null,
      lastPingRtt: device.isActive ? device.lastPingRtt : null,
      isOnline: effectiveIsOnline,
      lastSeen: device.lastSeenAt,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
      logCount24h: totalLogs24h,
      openIncidents: openIncidentsCount,
      openIncidentCount: openIncidentsCount,
      hasIngestToken: Boolean(device.ingestTokenHash),
    };

    const udpPort = Number(process.env.SYSLOG_UDP_PORT || 5514);
    const tcpPort = Number(process.env.SYSLOG_TCP_PORT || 5514);

    const serverConfig = {
      pingEnabled: device.pingEnabled,
      offlineAfterMinutes: device.offlineAfterMinutes,
      collectorPort: udpPort,
      collectorIp: "127.0.0.1",
      protocol: "udp",
      syslogUdpPort: udpPort,
      syslogTcpPort: tcpPort,
    };

    const responsePayload: Record<string, any> = {
      device: deviceDetail,
      serverConfig,
      ingestDiagnostics,
      sectionStatus,
      hourlyVolume: formattedHourly,
      hourlyChart,
      chartSummary,
      severityBreakdown: severityDistribution,
      categoryBreakdown: categoryDistribution,
      topIp: topSourceIps,
      topAccounts,
      latestDailyAnalysis: latestAi || null,
      uptime,
      statusTimeline: timeline,
      rtoHistory,
      stats: {
        totalLogs24h,
        openIncidentsCount,
        hourlyVolume: formattedHourly,
        hourlyChart,
        chartSummary,
        severityDistribution,
        categoryDistribution,
        topSourceIps,
        topAccounts,
        latestAiAnalysis: latestAi || null,
        uptime,
        statusTimeline: timeline,
        rtoHistory,
      },
    };

    if (session.user.role === "admin") {
      responsePayload.unknownSources = unknownSources;
    }

    dbTime = performance.now() - dbStart;

    // Simpan ke Cache Redis menggunakan safeJsonStringify
    try {
      await redis.set(cacheKey, safeJsonStringify(responsePayload), "EX", 15);
    } catch {
      // Abaikan jika Redis write error (jalur cadangan tanpa cache)
    }

    const totalDuration = performance.now() - startTime;
    const sanitized = sanitizeForJson(responsePayload);
    const res = NextResponse.json(sanitized);
    res.headers.set(
      "Server-Timing",
      `db;dur=${dbTime.toFixed(1)}, cache;dur=${cacheTime.toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
    );
    return res;
  } catch (err: any) {
    const randomSuffix = Math.random().toString(36).substring(2, 7).toUpperCase();
    const refId = `ERR-DEVSTATS-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`;
    console.error(`[GET /api/devices/[id]/stats] [${refId}] Error:`, err?.stack || err);
    return NextResponse.json(
      {
        error: "Gagal memuat statistik perangkat.",
        code: "DEVSTATS_INTERNAL_ERROR",
        ref_id: refId,
      },
      { status: 500 }
    );
  }
}
