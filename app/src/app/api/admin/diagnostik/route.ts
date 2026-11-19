import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { db, queryClient } from "@shared/db";
import { redis } from "@shared/redis";
import { getUnknownSourcesList, getGlobalIngestRejections24h } from "@shared/ingest-diagnostics";
import fs from "fs";

export const dynamic = "force-dynamic";

const DIAGNOSTIC_CACHE_KEY = "cache:admin:diagnostik";
const DIAGNOSTIC_CACHE_TTL = 10; // 10 detik

export async function GET() {
  const startTime = performance.now();

  try {
    // 1. Wajib peran Admin (Fail-Closed)
    try {
      await requireAdmin();
    } catch {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat mengakses data diagnostik sistem." },
        { status: 403 }
      );
    }

    // 2. Cek Cache Ringan 10 detik (tetap ambil unknownSources dan ingestRejections24h secara langsung agar selalu segar)
    try {
      const cached = await redis.get(DIAGNOSTIC_CACHE_KEY);
      if (cached) {
        const parsedCache = JSON.parse(cached);
        const [freshUnknown, freshRejections] = await Promise.all([
          getUnknownSourcesList(),
          getGlobalIngestRejections24h(),
        ]);
        parsedCache.unknownSources = freshUnknown;
        parsedCache.ingestRejections24h = freshRejections;
        return NextResponse.json(parsedCache);
      }
    } catch {}

    const warnings: string[] = [];

    // 3. Cek PostgreSQL (Latensi, Koneksi, Kunci)
    let pgStatus: "ok" | "perlu_perhatian" | "gagal" = "ok";
    let pgLatency = 0;
    let activeConnections = 0;
    let maxConnections = 100;
    let waitingLocks = 0;

    try {
      const t0 = performance.now();
      await queryClient`SELECT 1`;
      pgLatency = performance.now() - t0;

      const [connRes, maxRes, lockRes] = await Promise.all([
        queryClient`SELECT count(*)::int as count FROM pg_stat_activity WHERE datname = 'jagalog'`,
        queryClient`SELECT setting::int as count FROM pg_settings WHERE name = 'max_connections'`,
        queryClient`SELECT count(*)::int as count FROM pg_locks WHERE NOT granted`,
      ]);

      activeConnections = connRes[0]?.count || 0;
      maxConnections = maxRes[0]?.count || 100;
      waitingLocks = lockRes[0]?.count || 0;

      if (activeConnections / maxConnections >= 0.8) {
        pgStatus = "perlu_perhatian";
        warnings.push(`Koneksi database mencapai ${((activeConnections / maxConnections) * 100).toFixed(0)}% dari batas maksimum.`);
      }
      if (waitingLocks > 0) {
        pgStatus = "perlu_perhatian";
        warnings.push(`Terdapat ${waitingLocks} transaksi database yang sedang menunggu kunci (locks).`);
      }
    } catch (err: any) {
      pgStatus = "gagal";
      warnings.push(`Database PostgreSQL tidak merespons: ${err.message}`);
    }

    // 4. Cek Redis (Latensi, Memori, Antrian BullMQ)
    let redisStatus: "ok" | "perlu_perhatian" | "gagal" = "ok";
    let redisLatency = 0;
    let usedMemoryHuman = "0B";
    let maxMemoryHuman = "0B";
    let maxMemoryPolicy = "noeviction";
    let bullmqWaitCount = 0;
    let bullmqActiveCount = 0;
    let bullmqFailedCount = 0;
    let bullmqCompletedCount = 0;
    let keysCount = 0;

    try {
      const t0 = performance.now();
      await redis.ping();
      redisLatency = performance.now() - t0;

      const [info, keys, waitLen, activeLen, failedLen, compLen] = await Promise.all([
        redis.info(),
        redis.dbsize(),
        redis.llen("bull:ingest:wait"),
        redis.llen("bull:ingest:active"),
        redis.zcard("bull:ingest:failed"),
        redis.zcard("bull:ingest:completed"),
      ]);

      keysCount = keys;
      bullmqWaitCount = waitLen;
      bullmqActiveCount = activeLen;
      bullmqFailedCount = failedLen;
      bullmqCompletedCount = compLen;

      const parseInfo = (str: string) => {
        const lines = str.split("\r\n");
        const map: Record<string, string> = {};
        for (const l of lines) {
          if (l.includes(":")) {
            const [k, v] = l.split(":");
            map[k] = v;
          }
        }
        return map;
      };

      const parsed = parseInfo(info);
      usedMemoryHuman = parsed.used_memory_human || "0B";
      maxMemoryHuman = parsed.maxmemory_human || "0B";
      maxMemoryPolicy = parsed.maxmemory_policy || "noeviction";

      const usedBytes = parseInt(parsed.used_memory || "0", 10);
      const maxBytes = parseInt(parsed.maxmemory || "0", 10);

      if (maxBytes > 0 && usedBytes / maxBytes >= 0.8) {
        redisStatus = "perlu_perhatian";
        warnings.push(`Penggunaan memori Redis mencapai ${((usedBytes / maxBytes) * 100).toFixed(0)}% dari batas maksimum.`);
      }

      if (bullmqWaitCount > 100) {
        redisStatus = "perlu_perhatian";
        warnings.push(`Terdapat ${bullmqWaitCount} antrian ingest menumpuk belum diproses oleh worker.`);
      }
    } catch (err: any) {
      redisStatus = "gagal";
      warnings.push(`Redis cache tidak merespons: ${err.message}`);
    }

    // 5. Cek Ruang Disk Server
    let diskStatus: "ok" | "perlu_perhatian" | "gagal" = "ok";
    let diskTotalGb = 0;
    let diskAvailGb = 0;
    let diskPercentUsed = 0;

    try {
      if (typeof fs.statfsSync === "function") {
        const stats = fs.statfsSync("/");
        const total = stats.bsize * stats.blocks;
        const avail = stats.bsize * stats.bavail;
        diskTotalGb = parseFloat((total / 1024 ** 3).toFixed(1));
        diskAvailGb = parseFloat((avail / 1024 ** 3).toFixed(1));
        diskPercentUsed = parseFloat((((total - avail) / total) * 100).toFixed(1));

        if (diskPercentUsed >= 80) {
          diskStatus = "perlu_perhatian";
          warnings.push(`Kapasitas disk mencapai ${diskPercentUsed}% (${diskAvailGb} GB tersisa dari ${diskTotalGb} GB).`);
        }
      }
    } catch {}

    // 6. Uji Ringan Tiap Bagian Dashboard (Probe)
    const probeSections: Record<string, { durationMs: number; status: "ok" | "gagal" }> = {};
    const probeStart = performance.now();

    try {
      const t = performance.now();
      await queryClient`SELECT id FROM devices LIMIT 1`;
      probeSections.devices = { durationMs: parseFloat((performance.now() - t).toFixed(1)), status: "ok" };
    } catch {
      probeSections.devices = { durationMs: 0, status: "gagal" };
    }

    try {
      const t = performance.now();
      await queryClient`SELECT id FROM incidents LIMIT 1`;
      probeSections.incidents = { durationMs: parseFloat((performance.now() - t).toFixed(1)), status: "ok" };
    } catch {
      probeSections.incidents = { durationMs: 0, status: "gagal" };
    }

    try {
      const t = performance.now();
      await queryClient`SELECT hour_bucket FROM device_log_hourly LIMIT 1`;
      probeSections.hourlyChart = { durationMs: parseFloat((performance.now() - t).toFixed(1)), status: "ok" };
    } catch {
      probeSections.hourlyChart = { durationMs: 0, status: "gagal" };
    }

    const totalProbeTime = parseFloat((performance.now() - probeStart).toFixed(1));

    let migrationCount = 0;
    try {
      const migRes = await queryClient`SELECT count(*)::int as count FROM drizzle.__drizzle_migrations`;
      migrationCount = migRes[0]?.count || 0;
    } catch {}

    let rawLogCount = 0;
    let hourlyAggCount = 0;
    try {
      const [rawRes, aggRes] = await Promise.all([
        queryClient`SELECT count(*)::int as count FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours'`,
        queryClient`SELECT COALESCE(SUM(received_count), 0)::int as count FROM device_log_hourly WHERE hour_bucket >= NOW() - INTERVAL '24 hours'`,
      ]);
      rawLogCount = rawRes[0]?.count || 0;
      hourlyAggCount = aggRes[0]?.count || 0;
      if (rawLogCount !== hourlyAggCount) {
        warnings.push(`Terdapat selisih antara log mentah 24j (${rawLogCount}) dan agregasi per jam (${hourlyAggCount}). Disarankan menjalankan backfill.`);
      }
    } catch {}

    // 7. Status Sistem Keseluruhan
    let overallStatus: "ok" | "perlu_perhatian" | "gagal" = "ok";
    if (pgStatus === "gagal" || redisStatus === "gagal") {
      overallStatus = "gagal";
    } else if (pgStatus === "perlu_perhatian" || redisStatus === "perlu_perhatian" || diskStatus === "perlu_perhatian") {
      overallStatus = "perlu_perhatian";
    }

    const [unknownSources, ingestRejections24h] = await Promise.all([
      getUnknownSourcesList(),
      getGlobalIngestRejections24h(),
    ]);

    const payload = {
      status: overallStatus,
      statusLabel:
        overallStatus === "ok"
          ? "Semua Layanan Berjalan Normal"
          : overallStatus === "perlu_perhatian"
          ? "Perlu Perhatian"
          : "Layanan Kritis Terganggu",
      warnings,
      unknownSources,
      ingestRejections24h,
      postgres: {
        status: pgStatus,
        latencyMs: parseFloat(pgLatency.toFixed(1)),
        activeConnections,
        maxConnections,
        connectionUsagePercent: parseFloat(((activeConnections / maxConnections) * 100).toFixed(1)),
        waitingLocks,
      },
      redis: {
        status: redisStatus,
        latencyMs: parseFloat(redisLatency.toFixed(1)),
        usedMemoryHuman,
        maxMemoryHuman,
        maxMemoryPolicy,
        keysCount,
        bullmq: {
          waiting: bullmqWaitCount,
          active: bullmqActiveCount,
          failed: bullmqFailedCount,
          completed: bullmqCompletedCount,
        },
      },
      disk: {
        status: diskStatus,
        totalGb: diskTotalGb,
        availGb: diskAvailGb,
        percentUsed: diskPercentUsed,
      },
      dashboardProbe: {
        totalDurationMs: totalProbeTime,
        sections: probeSections,
      },
      systemIntegrity: {
        migrationsApplied: migrationCount,
        rawLogs24h: rawLogCount,
        hourlyAggLogs24h: hourlyAggCount,
        isConsistent: rawLogCount === hourlyAggCount,
      },
      limits: {
        statementTimeout: "0 (tidak ada batas)",
        redisTimeoutMs: 150,
        stampedeLockTtlSeconds: 3,
        clientCircuitBreakerFailures: 3,
        clientCircuitBreakerCooldownSeconds: 30,
        fastPathActive: process.env.DASHBOARD_FAST_PATH !== "false",
      },
      build: {
        version: "1.0.0",
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      totalDurationMs: parseFloat((performance.now() - startTime).toFixed(1)),
    };

    // Simpan cache 10 detik di Redis
    try {
      await redis.set(DIAGNOSTIC_CACHE_KEY, JSON.stringify(payload), "EX", DIAGNOSTIC_CACHE_TTL);
    } catch {}

    return NextResponse.json(payload);
  } catch (fatalErr: any) {
    console.error("GET /api/admin/diagnostik Error:", fatalErr);
    return NextResponse.json(
      { error: "Gagal menjalankan pemeriksaan diagnostik sistem.", detail: fatalErr.message },
      { status: 500 }
    );
  }
}
