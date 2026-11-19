import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function measureTopQueries() {
  const queryLogs: Array<{ name: string; query: string; calls: number; total_exec_time: number; mean_exec_time: number }> = [];

  async function track(name: string, q: string, fn: () => Promise<any>, calls = 1) {
    const start = performance.now();
    for (let i = 0; i < calls; i++) {
      await fn();
    }
    const total = performance.now() - start;
    queryLogs.push({
      name,
      query: q,
      calls,
      total_exec_time: Math.round(total * 100) / 100,
      mean_exec_time: Math.round((total / calls) * 100) / 100
    });
  }

  // 1. Log events count per device (N+1 query in /api/devices)
  await track(
    "N+1 Log Events (24h) per device",
    "SELECT count(*) FROM log_events WHERE device_id = $1 AND event_time >= NOW() - INTERVAL '24 hours'",
    () => db.execute(sql`SELECT count(*) FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours'`),
    13
  );

  // 2. Open incidents count per device (N+1 query in /api/devices)
  await track(
    "N+1 Open Incidents per device",
    "SELECT count(*) FROM incidents WHERE device_id = $1 AND status = 'open'",
    () => db.execute(sql`SELECT count(*) FROM incidents WHERE status = 'open'`),
    13
  );

  // 3. Topology nodes + devices join (/api/peta)
  await track(
    "Topology nodes join devices",
    "SELECT tn.*, d.name, d.ip_address, d.status FROM topology_nodes tn LEFT JOIN devices d ON tn.device_id = d.id",
    () => db.execute(sql`SELECT tn.*, d.name, d.ip_address, d.status FROM topology_nodes tn LEFT JOIN devices d ON tn.device_id = d.id`),
    1
  );

  // 4. Log events hourly histogram (/api/stats/dashboard)
  await track(
    "Dashboard 24h Hourly Histogram",
    "SELECT date_trunc('hour', event_time) as h, count(*) FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours' GROUP BY h",
    () => db.execute(sql`SELECT date_trunc('hour', event_time) as h, count(*) FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours' GROUP BY h`),
    1
  );

  // 5. Recent incidents with devices (/api/stats/dashboard)
  await track(
    "Dashboard Recent Incidents with Devices",
    "SELECT i.*, d.name FROM incidents i LEFT JOIN devices d ON i.device_id = d.id ORDER BY i.last_seen DESC LIMIT 10",
    () => db.execute(sql`SELECT i.*, d.name FROM incidents i LEFT JOIN devices d ON i.device_id = d.id ORDER BY i.last_seen DESC LIMIT 10`),
    1
  );

  // 6. Devices with group (/api/devices & /api/stats/dashboard)
  await track(
    "Devices list with group",
    "SELECT d.*, dg.nama FROM devices d LEFT JOIN device_groups dg ON d.group_id = dg.id ORDER BY d.created_at DESC",
    () => db.execute(sql`SELECT d.*, dg.nama FROM devices d LEFT JOIN device_groups dg ON d.group_id = dg.id ORDER BY d.created_at DESC`),
    2
  );

  console.log("\n=================================================================");
  console.log("5 QUERY TERATAS BERDASARKAN TOTAL EXECUTION TIME (BASELINE):");
  console.log("=================================================================");
  queryLogs.sort((a, b) => b.total_exec_time - a.total_exec_time);
  console.table(queryLogs.slice(0, 5));

  console.log("\n=================================================================");
  console.log("5 QUERY TERATAS BERDASARKAN JUMLAH CALLS (BASELINE):");
  console.log("=================================================================");
  queryLogs.sort((a, b) => b.calls - a.calls);
  console.table(queryLogs.slice(0, 5));

  process.exit(0);
}

measureTopQueries().catch(err => {
  console.error(err);
  process.exit(1);
});

