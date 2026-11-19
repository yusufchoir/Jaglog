import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { devices, deviceGroups, incidents, aiAnalyses } from "../shared/src/schema";
import { desc, eq } from "drizzle-orm";

async function measureQueries() {
  console.log("=== PENGUKURAN INDIVIDUAL QUERY GET /api/stats/dashboard ===");
  const iterations = 5;

  async function benchQuery(name: string, fn: () => Promise<any>) {
    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const t0 = performance.now();
      await fn();
      times.push(performance.now() - t0);
    }
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`[${avg.toFixed(2)} ms] ${name}`);
    return avg;
  }

  // 1. allDevices
  await benchQuery("Q1: allDevices (SELECT * FROM devices ORDER BY name)", () =>
    db.select({
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
    }).from(devices).orderBy(devices.name)
  );

  // 2. openIncidents
  await benchQuery("Q2: openIncidents by severity", () =>
    db.execute(sql`
      SELECT severity, COUNT(*)::text as count
      FROM incidents
      WHERE status = 'open'
      GROUP BY severity
    `)
  );

  // 3. hourlyLogsAgg (48 hours)
  await benchQuery("Q3: hourlyLogsAgg (device_log_hourly 48h)", () =>
    db.execute(sql`
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
    `)
  );

  // 4. topDevsRows (CTE ROW_NUMBER)
  await benchQuery("Q4: topDevsRows (CTE ROW_NUMBER per hour)", () =>
    db.execute(sql`
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
    `)
  );

  // 5. prior24hRow
  await benchQuery("Q5: prior24hRow (24h-48h comparison)", () =>
    db.execute(sql`
      SELECT COALESCE(SUM(received_count), 0)::text as count
      FROM device_log_hourly
      WHERE hour_bucket >= NOW() - INTERVAL '48 hours'
        AND hour_bucket < NOW() - INTERVAL '24 hours'
    `)
  );

  // 6. devLogCounts
  await benchQuery("Q6: devLogCounts per device (24h)", () =>
    db.execute(sql`
      SELECT device_id, SUM(received_count)::text as count
      FROM device_log_hourly
      WHERE hour_bucket >= NOW() - INTERVAL '24 hours'
      GROUP BY device_id
    `)
  );

  // 7. devOpenIncidentRows
  await benchQuery("Q7: devOpenIncidentRows per device", () =>
    db.execute(sql`
      SELECT device_id, COUNT(*)::text as count
      FROM incidents
      WHERE status = 'open'
      GROUP BY device_id
    `)
  );

  // 8. allSparklineRows
  await benchQuery("Q8: allSparklineRows (6h)", () =>
    db.execute(sql`
      SELECT
        device_id,
        to_char(date_trunc('hour', hour_bucket AT TIME ZONE 'Asia/Jakarta'), 'YYYY-MM-DD HH24') as time_bucket,
        SUM(received_count)::text as count
      FROM device_log_hourly
      WHERE hour_bucket >= NOW() - INTERVAL '6 hours'
      GROUP BY device_id, time_bucket
      ORDER BY device_id, time_bucket ASC
    `)
  );

  // 9. recentIncidents
  await benchQuery("Q9: recentIncidents (JOIN devices LIMIT 10)", () =>
    db.select({
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
    .limit(10)
  );

  // 10. latestAi
  await benchQuery("Q10: latestAi (JOIN devices LIMIT 1)", () =>
    db.select({
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
    .limit(1)
  );

  // 11. allGroups
  await benchQuery("Q11: allGroups (SELECT * FROM device_groups)", () =>
    db.select({
      id: deviceGroups.id,
      nama: deviceGroups.nama,
      warnaGaris: deviceGroups.warnaGaris,
      urutan: deviceGroups.urutan,
    })
    .from(deviceGroups)
    .orderBy(deviceGroups.urutan, deviceGroups.nama)
  );

  process.exit(0);
}

measureQueries().catch((e) => {
  console.error(e);
  process.exit(1);
});

