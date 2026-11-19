import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { redis } from "../shared/src/redis";

async function diagnoseDatabase() {
  console.log("=== DIAGNOSIS BASIS DATA & SERVER (LANGKAH 1.B) ===");

  // 1. pg_stat_activity & locks & connections
  const maxConnRes = await db.execute<{ max_connections: string }>(sql`
    SHOW max_connections;
  `);
  console.log("Max Connections:", maxConnRes[0]?.max_connections);

  const connCountRes = await db.execute<{ total_connections: string; active_connections: string; idle_connections: string; idle_in_trans: string }>(sql`
    SELECT
      COUNT(*)::text as total_connections,
      COUNT(*) FILTER (WHERE state = 'active')::text as active_connections,
      COUNT(*) FILTER (WHERE state = 'idle')::text as idle_connections,
      COUNT(*) FILTER (WHERE state = 'idle in transaction')::text as idle_in_trans
    FROM pg_stat_activity;
  `);
  console.log("Connections Status:", connCountRes[0]);

  const activeQueries = await db.execute<{ pid: number; usename: string; state: string; wait_event_type: string | null; wait_event: string | null; query: string; duration_ms: string }>(sql`
    SELECT
      pid, usename, state, wait_event_type, wait_event,
      left(query, 100) as query,
      round(EXTRACT(epoch FROM (clock_timestamp() - query_start)) * 1000)::text as duration_ms
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid() AND state = 'active'
    ORDER BY duration_ms DESC;
  `);
  console.log("Active Queries count:", activeQueries.length);
  activeQueries.forEach((q) => {
    console.log(`  [PID ${q.pid}] ${q.usename} | ${q.state} | Wait: ${q.wait_event_type}:${q.wait_event} | Dur: ${q.duration_ms}ms | ${q.query}`);
  });

  const locksRes = await db.execute<{ locktype: string; mode: string; granted: boolean; count: string }>(sql`
    SELECT locktype, mode, granted, count(*)::text
    FROM pg_locks
    GROUP BY locktype, mode, granted
    ORDER BY count DESC;
  `);
  console.log("pg_locks count summary:", locksRes.slice(0, 5));

  // 2. Check running maintenance / autovacuum / backfill
  const maintenanceRes = await db.execute<{ pid: number; phase: string; heap_blks_total: string; heap_blks_scanned: string }>(sql`
    SELECT pid, phase, heap_blks_total::text, heap_blks_scanned::text
    FROM pg_stat_progress_vacuum;
  `);
  console.log("Running VACUUM count:", maintenanceRes.length);

  const clusterProgress = await db.execute(sql`
    SELECT pid, command, phase FROM pg_stat_progress_cluster;
  `);
  console.log("Running CLUSTER count:", clusterProgress.length);

  const createIndexProgress = await db.execute(sql`
    SELECT pid, phase, lockers_total, lockers_done FROM pg_stat_progress_create_index;
  `);
  console.log("Running CREATE INDEX count:", createIndexProgress.length);

  // 3. Top 10 queries from pg_stat_statements
  console.log("\n--- TOP 10 QUERY DARI pg_stat_statements ---");
  const topQueries = await db.execute<{
    calls: string;
    total_exec_time: string;
    mean_exec_time: string;
    query: string;
  }>(sql`
    SELECT
      calls::text,
      round(total_exec_time::numeric, 2)::text as total_exec_time,
      round(mean_exec_time::numeric, 2)::text as mean_exec_time,
      left(query, 120) as query
    FROM pg_stat_statements
    WHERE query NOT LIKE '%pg_stat%'
    ORDER BY total_exec_time DESC
    LIMIT 10;
  `);
  topQueries.forEach((q, idx) => {
    console.log(`${idx + 1}. [Calls: ${q.calls}, Total: ${q.total_exec_time}ms, Mean: ${q.mean_exec_time}ms]`);
    console.log(`   ${q.query.replace(/\s+/g, ' ')}`);
  });

  // 4. EXPLAIN (ANALYZE, BUFFERS) untuk query-query di GET /api/stats/dashboard
  console.log("\n--- EXPLAIN (ANALYZE, BUFFERS) QUERY DASHBOARD ---");

  // Query A: allDevices
  console.log("\n[1] All Devices Query:");
  const expDev = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT id, name, type, ip_address, group_id, is_active, offline_after_minutes, ping_enabled, status, status_changed_at, last_seen_at
    FROM devices
    ORDER BY name;
  `);
  expDev.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // Query B: Open Incidents by severity
  console.log("\n[2] Open Incidents by Severity:");
  const expInc = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT severity, COUNT(*)::text as count
    FROM incidents
    WHERE status = 'open'
    GROUP BY severity;
  `);
  expInc.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // Query C: Hourly Logs Aggregation (device_log_hourly)
  console.log("\n[3] Hourly Aggregation from device_log_hourly:");
  const expHourly = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
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
    ORDER BY hour_slot ASC;
  `);
  expHourly.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // Query D: Top Devices per Hour
  console.log("\n[4] Top Devices per Hour (CTE with ROW_NUMBER):");
  const expTopDev = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
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
    ORDER BY hour_slot ASC, count DESC;
  `);
  expTopDev.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // Query E: devLogCounts
  console.log("\n[5] Device Log Counts (24h):");
  const expDevCounts = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT device_id, SUM(received_count)::text as count
    FROM device_log_hourly
    WHERE hour_bucket >= NOW() - INTERVAL '24 hours'
    GROUP BY device_id;
  `);
  expDevCounts.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // Query F: Sparkline
  console.log("\n[6] Sparklines (6h):");
  const expSparkline = await db.execute(sql`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT
      device_id,
      to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24') as time_bucket,
      SUM(received_count)::text as count
    FROM device_log_hourly
    WHERE hour_bucket >= NOW() - INTERVAL '6 hours'
    GROUP BY device_id, time_bucket
    ORDER BY device_id, time_bucket ASC;
  `);
  expSparkline.forEach((r: any) => console.log(" ", r["QUERY PLAN"]));

  // 5. Redis Diagnostics
  console.log("\n--- STATUS REDIS ---");
  const info = await redis.info();
  const dbSize = await redis.dbsize();
  console.log("DBSize (Keys count):", dbSize);

  const memMatch = info.match(/used_memory_human:([^\r\n]+)/);
  const hitsMatch = info.match(/keyspace_hits:([^\r\n]+)/);
  const missMatch = info.match(/keyspace_misses:([^\r\n]+)/);
  console.log("Used Memory:", memMatch ? memMatch[1] : "N/A");
  console.log("Keyspace Hits:", hitsMatch ? hitsMatch[1] : "N/A");
  console.log("Keyspace Misses:", missMatch ? missMatch[1] : "N/A");

  // Check BullMQ queues
  const bullKeys = await redis.keys("bull:*");
  console.log("BullMQ Keys Count:", bullKeys.length);

  process.exit(0);
}

diagnoseDatabase().catch((e) => {
  console.error(e);
  process.exit(1);
});

