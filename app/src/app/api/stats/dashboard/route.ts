import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices, deviceGroups, logEvents, incidents, aiAnalyses, deviceLogHourly } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { redis } from "@shared/redis";
import { formatDisplayName } from "@shared/auth";
import { generate24HourBucketsWib, computeChartSummary, HourlyBucketData } from "@shared/monitoring";

export const dynamic = "force-dynamic";

const DASHBOARD_CACHE_KEY = "cache:dashboard:stats";
const DASHBOARD_CACHE_TTL = 15; // 15 detik
const DASHBOARD_STALE_KEY = "cache:dashboard:stats:stale";
const DASHBOARD_STALE_TTL = 300; // 5 menit cadangan stale-while-revalidate
const DASHBOARD_STAMPEDE_LOCK_KEY = "lock:dashboard:stats:compute";

/**
 * Helper timeout tegas agar operasi Redis/DB tidak menggantung tanpa batas
 */
async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const startTime = performance.now();
  let dbTime = 0;
  let cacheTime = 0;
  let acquiredLock = false;

  // Sakelar Pengaman (Kill Switch): DASHBOARD_FAST_PATH=false mematikan stampede lock & cache baru
  const isFastPath = process.env.DASHBOARD_FAST_PATH !== "false";

  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir.", code: "UNAUTHORIZED" },
        { status: 401 }
      );
    }

    const safeUsername = session.user.username || "admin";
    const safeRole = session.user.role || "admin";
    const safeDisplayName = formatDisplayName(safeUsername);

    // Ambil stale cache sebagai cadangan parsial jika ada sub-query yang gagal
    let staleCacheData: any = null;
    try {
      const staleRaw = await withTimeout(redis.get(DASHBOARD_STALE_KEY), 150, null);
      if (staleRaw) {
        staleCacheData = JSON.parse(staleRaw);
      }
    } catch {}

    // 0. Cek Cache Redis Segar (Timeout tegas <= 150 ms)
    if (isFastPath) {
      const cacheStart = performance.now();
      const cached = await withTimeout(redis.get(DASHBOARD_CACHE_KEY), 150, null);
      cacheTime = performance.now() - cacheStart;

      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const totalDuration = performance.now() - startTime;
          const res = NextResponse.json({
            ...parsed,
            currentUser: {
              username: safeUsername,
              displayName: safeDisplayName,
              role: safeRole,
            },
          });
          res.headers.set(
            "Server-Timing",
            `cache;dur=${cacheTime.toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
          );
          return res;
        } catch {
          // Fallback jika JSON korup
        }
      }

      // 0.B Pelindung Stampede: Kunci pembangun tunggal dengan TTL 3 detik
      try {
        const lockRes = await withTimeout(
          redis.set(DASHBOARD_STAMPEDE_LOCK_KEY, "locked", "EX", 3, "NX"),
          250,
          null
        );
        acquiredLock = lockRes === "OK";
      } catch {
        acquiredLock = true; // Jika Redis error/offline, lanjut degradasi anggun
      }

      if (!acquiredLock) {
        // Jika ada request lain yang sedang membangun cache, gunakan stale cache
        if (staleCacheData) {
          const totalDuration = performance.now() - startTime;
          const res = NextResponse.json({
            ...staleCacheData,
            status: {
              ...staleCacheData.status,
              isStale: true,
            },
            currentUser: {
              username: safeUsername,
              displayName: safeDisplayName,
              role: safeRole,
            },
          });
          res.headers.set(
            "Server-Timing",
            `stale;dur=${(performance.now() - cacheStart).toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
          );
          return res;
        }

        // Jika cold boot tanpa stale data, tunggu maksimal 200 ms lalu coba baca cache sekali lagi
        await new Promise((r) => setTimeout(r, 200));
        const retryCached = await withTimeout(redis.get(DASHBOARD_CACHE_KEY), 150, null);
        if (retryCached) {
          try {
            const parsed = JSON.parse(retryCached);
            const totalDuration = performance.now() - startTime;
            const res = NextResponse.json({
              ...parsed,
              currentUser: {
                username: safeUsername,
                displayName: safeDisplayName,
                role: safeRole,
              },
            });
            res.headers.set(
              "Server-Timing",
              `waited;dur=${(performance.now() - cacheStart).toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
            );
            return res;
          } catch {}
        }
      }
    }

    const now = new Date();
    const dbStart = performance.now();

    // Inisialisasi Status Parsial per Widget
    const sectionStatus: Record<string, "ok" | "basi" | "gagal"> = {
      devices: "ok",
      incidents: "ok",
      hourlyChart: "ok",
      ai: "ok",
      areas: "ok",
    };
    const sectionErrors: Record<string, { message: string; code: string }> = {};

    // =========================================================================
    // SEKSI 1: PERANGKAT & STATUS KONEKTIVITAS
    // =========================================================================
    let allDevices: any[] = [];
    let onlineDevicesCount = 0;
    let offlineDevicesCount = 0;
    let logStoppedDevicesCount = 0;
    let unknownDevicesCount = 0;
    let devLogCountMap = new Map<string, number>();
    let devIncidentCountMap = new Map<string, number>();
    let devSparklineMap = new Map<string, number[]>();
    let deviceCards: any[] = [];

    try {
      const [devList, devLogCounts, devOpenIncidentRows, allSparklineRows] = await Promise.all([
        db
          .select({
            id: devices.id,
            name: devices.name,
            type: devices.type,
            ipAddress: devices.ipAddress,
            groupId: devices.groupId,
            isActive: devices.isActive,
            offlineAfterMinutes: devices.offlineAfterMinutes,
            pingEnabled: devices.pingEnabled,
            status: devices.status,
            statusChangedAt: devices.statusChangedAt,
            lastSeenAt: devices.lastSeenAt,
          })
          .from(devices)
          .orderBy(devices.name),

        db.execute<{ device_id: string; count: string }>(sql`
          SELECT device_id, SUM(received_count)::text as count
          FROM device_log_hourly
          WHERE hour_bucket >= NOW() - INTERVAL '24 hours'
          GROUP BY device_id
        `),

        db.execute<{ device_id: string; count: string }>(sql`
          SELECT device_id, COUNT(*)::text as count
          FROM incidents
          WHERE status = 'open'
          GROUP BY device_id
        `),

        db.execute<{ device_id: string; time_bucket: string; count: string }>(sql`
          SELECT
            device_id,
            to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24') as time_bucket,
            SUM(received_count)::text as count
          FROM device_log_hourly
          WHERE hour_bucket >= NOW() - INTERVAL '6 hours'
          GROUP BY device_id, time_bucket
          ORDER BY device_id, time_bucket ASC
        `),
      ]);

      allDevices = devList;

      for (const dev of allDevices) {
        const st = dev.status || "unknown";
        if (st === "online") onlineDevicesCount++;
        else if (st === "log_stopped") logStoppedDevicesCount++;
        else if (st === "offline" || st === "rto") offlineDevicesCount++;
        else unknownDevicesCount++;
      }

      for (const row of devLogCounts) {
        devLogCountMap.set(row.device_id, parseInt(row.count, 10));
      }
      // Fallback: jika tabel agregasi hourly belum terisi untuk 24 jam, baca hitungan per perangkat dari log_events
      if (devLogCounts.length === 0) {
        try {
          const rawDevCounts = await db.execute<{ device_id: string; count: string }>(sql`
            SELECT device_id, COUNT(*)::text as count
            FROM log_events
            WHERE event_time >= NOW() - INTERVAL '24 hours'
            GROUP BY device_id
          `);
          for (const row of rawDevCounts) {
            devLogCountMap.set(row.device_id, parseInt(row.count, 10));
          }
        } catch {}
      }
      for (const row of devOpenIncidentRows) {
        devIncidentCountMap.set(row.device_id, parseInt(row.count, 10));
      }
      for (const row of allSparklineRows) {
        const arr = devSparklineMap.get(row.device_id) || [];
        arr.push(parseInt(row.count, 10));
        devSparklineMap.set(row.device_id, arr);
      }

      deviceCards = allDevices.map((dev) => ({
        id: dev.id,
        name: dev.name,
        type: dev.type,
        ipAddress: dev.ipAddress,
        groupId: dev.groupId,
        status: dev.status || "unknown",
        statusChangedAt: dev.statusChangedAt,
        isOnline: (dev.status || "unknown") === "online",
        lastSeenAt: dev.lastSeenAt,
        logCount24h: devLogCountMap.get(dev.id) || 0,
        openIncidentCount: devIncidentCountMap.get(dev.id) || 0,
        sparkline: devSparklineMap.get(dev.id) || [],
      }));
    } catch (err: any) {
      console.warn("[Dashboard API] Sub-query Devices gagal:", err.message);
      if (staleCacheData?.devices) {
        deviceCards = staleCacheData.devices;
        onlineDevicesCount = staleCacheData.summary?.onlineDevicesCount || 0;
        offlineDevicesCount = staleCacheData.summary?.offlineDevicesCount || 0;
        logStoppedDevicesCount = staleCacheData.summary?.logStoppedDevicesCount || 0;
        unknownDevicesCount = staleCacheData.summary?.unknownDevicesCount || 0;
        sectionStatus.devices = "basi";
      } else {
        sectionStatus.devices = "gagal";
        sectionErrors.devices = { message: "Gagal memuat daftar perangkat.", code: "DEV_QUERY_ERR" };
      }
    }

    // =========================================================================
    // SEKSI 2: INSIDEN KEAMANAN
    // =========================================================================
    let incidentsBySeverity = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
    let recentIncidents: any[] = [];

    try {
      const [openIncidentsRows, recentIncidentsRows] = await Promise.all([
        db.execute<{ severity: string; count: string }>(sql`
          SELECT severity, COUNT(*)::text as count
          FROM incidents
          WHERE status = 'open'
          GROUP BY severity
        `),
        db
          .select({
            id: incidents.id,
            deviceId: incidents.deviceId,
            deviceName: devices.name,
            deviceType: devices.type,
            ruleKey: incidents.ruleKey,
            severity: incidents.severity,
            title: incidents.title,
            mainEntity: incidents.mainEntity,
            count: incidents.count,
            status: incidents.status,
            lastSeen: incidents.lastSeen,
          })
          .from(incidents)
          .leftJoin(devices, eq(incidents.deviceId, devices.id))
          .orderBy(desc(incidents.lastSeen))
          .limit(10),
      ]);

      for (const r of openIncidentsRows) {
        const sev = r.severity.toLowerCase() as keyof typeof incidentsBySeverity;
        if (sev in incidentsBySeverity) {
          const c = parseInt(r.count, 10);
          incidentsBySeverity[sev] = c;
          incidentsBySeverity.total += c;
        }
      }

      recentIncidents = recentIncidentsRows.map((i) => ({
        id: i.id,
        deviceId: i.deviceId,
        deviceName: i.deviceName || "Perangkat",
        deviceType: i.deviceType || "other",
        ruleKey: i.ruleKey,
        severity: i.severity,
        title: i.title,
        mainEntity: i.mainEntity,
        count: i.count,
        status: i.status,
        lastSeen: i.lastSeen instanceof Date ? i.lastSeen.toISOString() : String(i.lastSeen),
      }));
    } catch (err: any) {
      console.warn("[Dashboard API] Sub-query Incidents gagal:", err.message);
      if (staleCacheData?.recentIncidents) {
        recentIncidents = staleCacheData.recentIncidents;
        incidentsBySeverity = staleCacheData.summary?.incidentsBySeverity || incidentsBySeverity;
        sectionStatus.incidents = "basi";
      } else {
        sectionStatus.incidents = "gagal";
        sectionErrors.incidents = { message: "Gagal memuat insiden keamanan.", code: "INC_QUERY_ERR" };
      }
    }

    // =========================================================================
    // SEKSI 3: GRAFIK & VOLUME LOG 24 JAM
    // =========================================================================
    let hourlyChart: HourlyBucketData[] = [];
    let chartSummary: any = null;
    let totalLogs24h = 0;

    try {
      const wibBucketsMeta = generate24HourBucketsWib(now);

      const [hourlyLogsAgg, topDevsRows, prior24hRow] = await Promise.all([
        db.execute<{
          hour_slot: string;
          received_count: string;
          stored_count: string;
          dropped_count: string;
          critical: string;
          error: string;
          warning: string;
          notice: string;
          info: string;
          debug: string;
          active_devices: string;
        }>(sql`
          SELECT
            to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00') AS hour_slot,
            SUM(received_count)::text AS received_count,
            SUM(stored_count)::text AS stored_count,
            SUM(dropped_count)::text AS dropped_count,
            SUM(severity_critical)::text AS critical,
            SUM(severity_error)::text AS error,
            SUM(severity_warning)::text AS warning,
            SUM(severity_notice)::text AS notice,
            SUM(severity_info)::text AS info,
            SUM(severity_debug)::text AS debug,
            COUNT(DISTINCT device_id)::text AS active_devices
          FROM device_log_hourly
          WHERE hour_bucket >= NOW() - INTERVAL '48 hours'
          GROUP BY hour_slot
          ORDER BY hour_slot ASC
        `),
        db.execute<{
          hour_slot: string;
          device_id: string;
          device_name: string;
          count: string;
        }>(sql`
          WITH hourly_dev_rank AS (
            SELECT
              to_char(date_trunc('hour', h.hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00') AS hour_slot,
              h.device_id,
              d.name as device_name,
              SUM(h.received_count)::int as count,
              ROW_NUMBER() OVER (
                PARTITION BY to_char(date_trunc('hour', h.hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24:00')
                ORDER BY SUM(h.received_count) DESC
              ) as rn
            FROM device_log_hourly h
            JOIN devices d ON h.device_id = d.id
            WHERE h.hour_bucket >= NOW() - INTERVAL '24 hours'
            GROUP BY hour_slot, h.device_id, d.name
          )
          SELECT hour_slot, device_id, device_name, count
          FROM hourly_dev_rank
          WHERE rn <= 3
          ORDER BY hour_slot ASC, count DESC
        `),
        db.execute<{ count: string }>(sql`
          SELECT COALESCE(SUM(received_count), 0)::text as count
          FROM device_log_hourly
          WHERE hour_bucket >= NOW() - INTERVAL '48 hours'
            AND hour_bucket < NOW() - INTERVAL '24 hours'
        `),
      ]);

      const hourlyAggMap = new Map<string, typeof hourlyLogsAgg[0]>();
      for (const row of hourlyLogsAgg) {
        hourlyAggMap.set(row.hour_slot, row);
      }

      const topDevsMap = new Map<string, Array<{ id: string; name: string; count: number }>>();
      for (const row of topDevsRows) {
        const arr = topDevsMap.get(row.hour_slot) || [];
        arr.push({
          id: row.device_id,
          name: row.device_name,
          count: parseInt(row.count, 10),
        });
        topDevsMap.set(row.hour_slot, arr);
      }

      hourlyChart = wibBucketsMeta.map((meta) => {
        const agg = hourlyAggMap.get(meta.fullTimeStr);
        const received = agg ? parseInt(agg.received_count, 10) : 0;
        const critical = agg ? parseInt(agg.critical, 10) : 0;
        const error = agg ? parseInt(agg.error, 10) : 0;
        const warning = agg ? parseInt(agg.warning, 10) : 0;
        const notice = agg ? parseInt(agg.notice, 10) : 0;
        const info = agg ? parseInt(agg.info, 10) : 0;
        const debug = agg ? parseInt(agg.debug, 10) : 0;
        const activeDevices = agg ? parseInt(agg.active_devices, 10) : 0;

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
          jumlah_perangkat_aktif: activeDevices,
          parsial: meta.isPartial,
          menitBerjalan: meta.elapsedMinutes,
          top_perangkat: topDevsMap.get(meta.fullTimeStr) || [],
        };
      });

      const totalPrev24h = parseInt(prior24hRow[0]?.count || "0", 10);
      chartSummary = computeChartSummary(hourlyChart, totalPrev24h);
      totalLogs24h = chartSummary.total_24j;

      // Fallback Kejujuran Data: Jika agregasi hourly 0 tetapi ada log baru di log_events
      if (totalLogs24h === 0) {
        try {
          const [directLogsCount] = await db.execute<{ count: string }>(sql`
            SELECT COUNT(*)::text as count
            FROM log_events
            WHERE event_time >= NOW() - INTERVAL '24 hours'
          `);
          const directCount = parseInt(directLogsCount?.count || "0", 10);
          if (directCount > 0) {
            totalLogs24h = directCount;
            chartSummary.total_24j = directCount;
            chartSummary.penjelasan_otomatis = `Terdeteksi ${directCount.toLocaleString("id-ID")} log dalam antrian sinkronisasi.`;
            if (hourlyChart.length > 0) {
              const lastBucket = hourlyChart[hourlyChart.length - 1];
              lastBucket.jumlah_log = directCount;
              lastBucket.count = directCount;
            }
          }
        } catch {}
      }
    } catch (err: any) {
      console.warn("[Dashboard API] Sub-query Hourly Chart gagal:", err.message);
      if (staleCacheData?.hourlyChart) {
        hourlyChart = staleCacheData.hourlyChart;
        chartSummary = staleCacheData.chartSummary;
        totalLogs24h = staleCacheData.summary?.totalLogs24h || 0;
        sectionStatus.hourlyChart = "basi";
      } else {
        sectionStatus.hourlyChart = "gagal";
        sectionErrors.hourlyChart = { message: "Gagal memuat grafik aktivitas log.", code: "CHART_QUERY_ERR" };
      }
    }

    // =========================================================================
    // SEKSI 4: ANALISA AI TERAKHIR
    // =========================================================================
    let latestAi: any = null;
    try {
      const [aiRow] = await db
        .select({
          id: aiAnalyses.id,
          riskLevel: aiAnalyses.riskLevel,
          summary: aiAnalyses.summary,
          suspectedAttack: aiAnalyses.suspectedAttack,
          createdAt: aiAnalyses.createdAt,
          deviceName: devices.name,
        })
        .from(aiAnalyses)
        .leftJoin(devices, eq(aiAnalyses.deviceId, devices.id))
        .orderBy(desc(aiAnalyses.createdAt))
        .limit(1);

      latestAi = aiRow || null;
    } catch (err: any) {
      console.warn("[Dashboard API] Sub-query AI Analysis gagal:", err.message);
      if (staleCacheData?.summary?.latestAiAnalysis !== undefined) {
        latestAi = staleCacheData.summary.latestAiAnalysis;
        sectionStatus.ai = "basi";
      } else {
        sectionStatus.ai = "gagal";
        sectionErrors.ai = { message: "Gagal memuat status analisa AI.", code: "AI_QUERY_ERR" };
      }
    }

    // =========================================================================
    // SEKSI 5: AREA & RINGKASAN NOC
    // =========================================================================
    let areaSummary: any[] = [];
    let ringkasanNoc: any = null;

    try {
      const allGroups = await db
        .select({
          id: deviceGroups.id,
          nama: deviceGroups.nama,
          warnaGaris: deviceGroups.warnaGaris,
          urutan: deviceGroups.urutan,
        })
        .from(deviceGroups)
        .orderBy(deviceGroups.urutan, deviceGroups.nama);

      areaSummary = allGroups.map((grp) => {
        const groupDevs = allDevices.filter((d) => d.groupId === grp.id);
        let online = 0;
        let logStopped = 0;
        let offline = 0;
        let unknown = 0;
        let openIncs = 0;

        for (const d of groupDevs) {
          const st = d.status || "unknown";
          if (st === "online") online++;
          else if (st === "log_stopped") logStopped++;
          else if (st === "offline") offline++;
          else unknown++;

          openIncs += devIncidentCountMap.get(d.id) || 0;
        }

        return {
          id: grp.id,
          nama: grp.nama,
          warnaGaris: grp.warnaGaris,
          totalDevices: groupDevs.length,
          onlineCount: online,
          logStoppedCount: logStopped,
          offlineCount: offline,
          unknownCount: unknown,
          openIncidentCount: openIncs,
        };
      });

      const byTypeMap = new Map<string, { count: number; online: number; problematic: number; openIncidents: number }>();
      for (const d of deviceCards) {
        const t = (d.type || "other").toLowerCase();
        const cur = byTypeMap.get(t) || { count: 0, online: 0, problematic: 0, openIncidents: 0 };
        cur.count++;
        if (d.status === "online") cur.online++;
        if (d.status === "log_stopped" || d.status === "offline") cur.problematic++;
        cur.openIncidents += d.openIncidentCount;
        byTypeMap.set(t, cur);
      }

      const byType = Array.from(byTypeMap.entries()).map(([tipe, stats]) => ({ tipe, ...stats }));

      // Rincian insiden per severity per perangkat untuk heatmap
      let devIncSeverityRows: Array<{ device_id: string; severity: string; count: string }> = [];
      try {
        devIncSeverityRows = await db.execute<{ device_id: string; severity: string; count: string }>(sql`
          SELECT device_id, severity, COUNT(*)::text as count
          FROM incidents
          WHERE status = 'open'
          GROUP BY device_id, severity
        `);
      } catch {}

      const devIncSeverityMap = new Map<string, { critical: number; high: number; medium: number; low: number; total: number }>();
      for (const row of devIncSeverityRows) {
        const cur = devIncSeverityMap.get(row.device_id) || { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
        const c = parseInt(row.count, 10) || 0;
        cur.total += c;
        if (row.severity === "critical") cur.critical += c;
        else if (row.severity === "high") cur.high += c;
        else if (row.severity === "medium") cur.medium += c;
        else if (row.severity === "low") cur.low += c;
        devIncSeverityMap.set(row.device_id, cur);
      }

      const heatmap = [...deviceCards]
        .sort((a, b) => {
          const score = (n: typeof a) => {
            if (n.status === "offline" || n.status === "rto") return 4;
            if (n.openIncidentCount > 0) return 3;
            if (n.status === "log_stopped") return 2;
            if (n.status === "unknown") return 1;
            return 0;
          };
          return score(b) - score(a);
        })
        .map((d) => {
          const rawSt = d.status || "unknown";
          const normSt = rawSt === "rto" ? "offline" : rawSt;
          const incObj = devIncSeverityMap.get(d.id) || {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            total: d.openIncidentCount || 0,
          };
          return {
            id: d.id,
            deviceId: d.id,
            nama: d.name,
            tipe: d.type,
            ip: d.ipAddress,
            lokasi: null,
            status: normSt as any,
            pingStatus: rawSt === "rto" ? "down" : rawSt === "online" ? "up" : "unknown",
            rttMs: null,
            insidenTerbuka: incObj,
            groupId: d.groupId || null,
          };
        });

      const formattedAlarmTerbaru = recentIncidents.map((i) => ({
        id: i.id,
        deviceId: i.deviceId,
        deviceName: i.deviceName || "Perangkat",
        deviceType: i.deviceType || "other",
        severity: i.severity as any,
        title: i.title,
        status: i.status as any,
        lastSeen: i.lastSeen,
      }));

      ringkasanNoc = {
        totalNodes: allDevices.length,
        onlineCount: onlineDevicesCount,
        logStoppedCount: logStoppedDevicesCount,
        offlineCount: offlineDevicesCount,
        unknownCount: unknownDevicesCount,
        insiden: incidentsBySeverity,
        perJenis: byType,
        heatmap,
        alarmTerbaru: formattedAlarmTerbaru,
        // Properti aditif untuk kompatibilitas ke belakang:
        nodesOnline: onlineDevicesCount,
        nodesLogStopped: logStoppedDevicesCount,
        nodesOffline: offlineDevicesCount,
        nodesUnknown: unknownDevicesCount,
        byType,
        heatmapNodes: heatmap,
        recentIncidents: formattedAlarmTerbaru,
        groups: areaSummary.map((g) => ({
          id: g.id,
          nama: g.nama,
          warnaGaris: g.warnaGaris as any,
          totalNodes: g.totalDevices,
          onlineNodes: g.onlineCount,
          openIncidentsCount: g.openIncidentCount,
        })),
      };
    } catch (err: any) {
      console.warn("[Dashboard API] Sub-query Area Summary gagal:", err.message);
      if (staleCacheData?.areaSummary) {
        areaSummary = staleCacheData.areaSummary;
        ringkasanNoc = staleCacheData.ringkasanNoc;
        sectionStatus.areas = "basi";
      } else {
        sectionStatus.areas = "gagal";
        sectionErrors.areas = { message: "Gagal memuat ringkasan area dan topologi.", code: "AREA_QUERY_ERR" };
      }
    }

    dbTime = performance.now() - dbStart;

    // Periksa apakah SEMUA seksi gagal tanpa cadangan sama sekali
    const allSectionsFailed = Object.values(sectionStatus).every((s) => s === "gagal");
    if (allSectionsFailed) {
      if (acquiredLock) {
        try {
          await withTimeout(redis.del(DASHBOARD_STAMPEDE_LOCK_KEY), 150, 0);
        } catch {}
      }
      return NextResponse.json(
        {
          error: "Gagal memuat seluruh data ringkasan dashboard.",
          code: "ALL_SECTIONS_FAILED",
          sectionErrors,
        },
        { status: 500 }
      );
    }

    const responseData = {
      status: sectionStatus,
      sectionErrors,
      summary: {
        onlineDevicesCount,
        offlineDevicesCount,
        logStoppedDevicesCount,
        unknownDevicesCount,
        totalDevicesCount: allDevices.length,
        incidentsBySeverity,
        totalLogs24h,
        latestAiAnalysis: latestAi || null,
      },
      hourlyChart,
      chartSummary,
      devices: deviceCards,
      recentIncidents,
      areaSummary,
      ringkasanNoc,
      isFastPath,
      refreshedAt: new Date().toISOString(),
    };

    // Simpan cache fresh dan stale ke Redis secara asinkron tanpa memblokir atau menggagalkan response
    try {
      await Promise.allSettled([
        withTimeout(
          redis.set(DASHBOARD_CACHE_KEY, JSON.stringify(responseData), "EX", DASHBOARD_CACHE_TTL),
          200,
          null
        ),
        withTimeout(
          redis.set(DASHBOARD_STALE_KEY, JSON.stringify(responseData), "EX", DASHBOARD_STALE_TTL),
          200,
          null
        ),
      ]);
    } catch {
      // Abaikan kegagalan penulisan cache (prinsip toleransi kegagalan Redis)
    } finally {
      if (acquiredLock) {
        try {
          await withTimeout(redis.del(DASHBOARD_STAMPEDE_LOCK_KEY), 150, 0);
        } catch {}
      }
    }

    const totalDuration = performance.now() - startTime;
    const res = NextResponse.json({
      ...responseData,
      currentUser: {
        username: safeUsername,
        displayName: safeDisplayName,
        role: safeRole,
      },
    });

    res.headers.set(
      "Server-Timing",
      `db;dur=${dbTime.toFixed(1)}, cache;dur=${cacheTime.toFixed(1)}, total;dur=${totalDuration.toFixed(1)}`
    );
    return res;
  } catch (err: any) {
    console.error("GET /api/stats/dashboard Fatal Error:", err);

    if (acquiredLock) {
      try {
        await withTimeout(redis.del(DASHBOARD_STAMPEDE_LOCK_KEY), 150, 0);
      } catch {}
    }

    return NextResponse.json(
      { error: "Server terlalu sibuk atau terjadi kesalahan internal.", code: "FATAL_ERROR" },
      { status: 500 }
    );
  }
}
