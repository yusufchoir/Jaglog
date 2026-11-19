import { db, queryClient } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function measureBaseline() {
  console.log("=== PENGUKURAN BASELINE (QUERY SQL & REQUEST) ===\n");

  const results: any[] = [];

  // Helper untuk mengukur waktu query
  async function timeQuery(name: string, fn: () => Promise<any>) {
    const start = performance.now();
    const res = await fn();
    const duration = performance.now() - start;
    return { name, duration: Math.round(duration * 100) / 100, rowCount: Array.isArray(res) ? res.length : 1 };
  }

  // 1. Simulasi Halaman / (Dashboard)
  console.log("1. Mengukur Halaman / (Dashboard):");
  // /api/stats/dashboard melakukan 8 query:
  let dashQueries = 0;
  const startDash = performance.now();
  await db.execute(sql`SELECT * FROM devices ORDER BY name`); dashQueries++;
  await db.execute(sql`SELECT count(*) FROM log_events WHERE event_time >= NOW() - INTERVAL '24 hours'`); dashQueries++;
  await db.execute(sql`
    SELECT date_trunc('hour', event_time) as hour, count(*) as count 
    FROM log_events 
    WHERE event_time >= NOW() - INTERVAL '24 hours' 
    GROUP BY hour ORDER BY hour
  `); dashQueries++;
  await db.execute(sql`
    SELECT i.*, d.name as device_name 
    FROM incidents i LEFT JOIN devices d ON i.device_id = d.id 
    ORDER BY i.last_seen DESC LIMIT 10
  `); dashQueries++;
  await db.execute(sql`
    SELECT a.*, d.name as device_name 
    FROM ai_analyses a LEFT JOIN devices d ON a.device_id = d.id 
    ORDER BY a.created_at DESC LIMIT 1
  `); dashQueries++;
  await db.execute(sql`SELECT * FROM device_groups ORDER BY urutan, nama`); dashQueries++;
  // Dan / memanggil /api/peta untuk ringkasan (7 query tambahan jika cache miss):
  await db.execute(sql`SELECT * FROM topology_maps WHERE is_default = true LIMIT 1`); dashQueries++;
  await db.execute(sql`SELECT * FROM topology_groups`); dashQueries++;
  await db.execute(sql`SELECT * FROM topology_nodes`); dashQueries++;
  await db.execute(sql`SELECT device_id, severity, count(*) FROM incidents WHERE status = 'open' GROUP BY device_id, severity`); dashQueries++;
  await db.execute(sql`SELECT * FROM topology_links`); dashQueries++;
  await db.execute(sql`SELECT * FROM devices WHERE id NOT IN (SELECT device_id FROM topology_nodes WHERE device_id IS NOT NULL)`); dashQueries++;
  const durDash = performance.now() - startDash;
  console.log(`- Dashboard: ${dashQueries} query SQL, ${Math.round(durDash * 100) / 100} ms`);
  results.push({ halaman: "/", request_api: 2, query_sql: dashQueries, durasi_ms: Math.round(durDash) });

  // 2. Simulasi Halaman /perangkat (N+1 query)
  console.log("\n2. Mengukur Halaman /perangkat:");
  let devQueries = 0;
  const startDev = performance.now();
  // Call 1: /api/groups
  await db.execute(sql`SELECT * FROM device_groups ORDER BY urutan, nama`); devQueries++;
  await db.execute(sql`SELECT * FROM devices WHERE is_active = true`); devQueries++;
  await db.execute(sql`SELECT device_id, count(*) FROM incidents WHERE status = 'open' GROUP BY device_id`); devQueries++;
  // Call 2: /api/devices (dengan loop N+1)
  const devs = (await db.execute(sql`SELECT * FROM devices LEFT JOIN device_groups ON devices.group_id = device_groups.id`)) as any[];
  devQueries++;
  for (const d of devs) {
    await db.execute(sql`SELECT count(*) FROM log_events WHERE device_id = ${d.id} AND event_time >= NOW() - INTERVAL '24 hours'`); devQueries++;
    await db.execute(sql`SELECT count(*) FROM incidents WHERE device_id = ${d.id} AND status = 'open'`); devQueries++;
  }
  const durDev = performance.now() - startDev;
  console.log(`- /perangkat (dengan ${devs.length} device): ${devQueries} query SQL (N+1 terjadi!), ${Math.round(durDev * 100) / 100} ms`);
  results.push({ halaman: "/perangkat", request_api: 2, query_sql: devQueries, durasi_ms: Math.round(durDev) });

  // 3. Simulasi Halaman /grup
  console.log("\n3. Mengukur Halaman /grup:");
  let grupQueries = 0;
  const startGrup = performance.now();
  await db.execute(sql`SELECT * FROM device_groups ORDER BY urutan, nama`); grupQueries++;
  await db.execute(sql`SELECT * FROM devices WHERE is_active = true`); grupQueries++;
  await db.execute(sql`SELECT device_id, count(*) FROM incidents WHERE status = 'open' GROUP BY device_id`); grupQueries++;
  const durGrup = performance.now() - startGrup;
  console.log(`- /grup: ${grupQueries} query SQL, ${Math.round(durGrup * 100) / 100} ms`);
  results.push({ halaman: "/grup", request_api: 2, query_sql: grupQueries, durasi_ms: Math.round(durGrup) });

  // 4. Simulasi Halaman /peta
  console.log("\n4. Mengukur Halaman /peta:");
  let petaQueries = 0;
  const startPeta = performance.now();
  await db.execute(sql`SELECT * FROM topology_maps WHERE is_default = true LIMIT 1`); petaQueries++;
  await db.execute(sql`SELECT * FROM topology_groups LEFT JOIN device_groups ON topology_groups.device_group_id = device_groups.id`); petaQueries++;
  await db.execute(sql`SELECT * FROM topology_nodes LEFT JOIN devices ON topology_nodes.device_id = devices.id`); petaQueries++;
  await db.execute(sql`SELECT device_id, severity, count(*) FROM incidents WHERE status = 'open' GROUP BY device_id, severity`); petaQueries++;
  await db.execute(sql`SELECT * FROM topology_links`); petaQueries++;
  await db.execute(sql`SELECT * FROM devices WHERE id NOT IN (SELECT device_id FROM topology_nodes WHERE device_id IS NOT NULL)`); petaQueries++;
  const durPeta = performance.now() - startPeta;
  console.log(`- /peta: ${petaQueries} query SQL, ${Math.round(durPeta * 100) / 100} ms`);
  results.push({ halaman: "/peta", request_api: 1, query_sql: petaQueries, durasi_ms: Math.round(durPeta) });

  console.log("\n=================================================================");
  console.log("TABEL BASELINE PENGAMBILAN DATA (BACA):");
  console.log("=================================================================");
  console.table(results);

  // 5. Baseline Aksi Tulis
  console.log("\n=================================================================");
  console.log("TABEL BASELINE PENGIRIMAN DATA (TULIS):");
  console.log("=================================================================");
  const writeBaseline = [
    {
      aksi: "Ubah grup di form perangkat",
      endpoint: "PATCH /api/devices/[id]",
      request_count: 1,
      payload_size: "Kecil (hanya field yang diubah)",
      tabel_ditulis: "devices (hanya devices.group_id)",
      sinkron_ke_peta: "TIDAK (topology_nodes tidak diupdate)"
    },
    {
      aksi: "Aksi massal 'Pindahkan ke grup'",
      endpoint: "POST /api/devices/bulk-group",
      request_count: 1,
      payload_size: "Sedang (deviceIds + groupId)",
      tabel_ditulis: "devices (hanya devices.group_id)",
      sinkron_ke_peta: "TIDAK (topology_nodes tidak diupdate)"
    },
    {
      aksi: "Tambah perangkat di hal grup",
      endpoint: "POST /api/devices/bulk-group",
      request_count: 1,
      payload_size: "Sedang",
      tabel_ditulis: "devices",
      sinkron_ke_peta: "TIDAK"
    },
    {
      aksi: "Seret node ke kotak grup lain di peta",
      endpoint: "PUT /api/peta/[id]/layout",
      request_count: 1,
      payload_size: "Besar (seluruh array nodes + groups)",
      tabel_ditulis: "topology_nodes (loop N query) & topology_groups",
      sinkron_ke_peta: "TIDAK (devices.group_id di hal perangkat TIDAK diupdate!)"
    },
    {
      aksi: "Buat grup di hal /grup",
      endpoint: "POST /api/groups",
      request_count: 1,
      payload_size: "Kecil (nama, warna, urutan)",
      tabel_ditulis: "device_groups",
      sinkron_ke_peta: "TIDAK (kotak topology_groups TIDAK dibuat)"
    },
    {
      aksi: "Buat grup di hal /peta (+ Grup)",
      endpoint: "POST /api/peta/[id]/groups",
      request_count: 1,
      payload_size: "Kecil (nama, warna, x, y)",
      tabel_ditulis: "topology_groups",
      sinkron_ke_peta: "TIDAK (device_groups TIDAK dibuat)"
    },
    {
      aksi: "Hapus grup di hal /grup",
      endpoint: "DELETE /api/groups/[id]",
      request_count: 1,
      payload_size: "Kecil (action, targetGroupId)",
      tabel_ditulis: "device_groups, devices.group_id = null",
      sinkron_ke_peta: "TIDAK (topology_groups di peta tetap ada!)"
    },
    {
      aksi: "Hapus grup di hal /peta",
      endpoint: "DELETE /api/peta/[id]/groups/[groupId]",
      request_count: 1,
      payload_size: "Kosong",
      tabel_ditulis: "topology_groups, topology_nodes.group_id = null",
      sinkron_ke_peta: "TIDAK (device_groups dan devices.group_id TIDAK disentuh!)"
    },
    {
      aksi: "Simpan tata letak peta",
      endpoint: "PUT /api/peta/[id]/layout",
      request_count: 1,
      payload_size: "Besar (seluruh node & grup peta)",
      tabel_ditulis: "topology_nodes (N query), topology_groups (M query)",
      sinkron_ke_peta: "N/A"
    },
    {
      aksi: "Lipat / buka grup peta",
      endpoint: "PUT /api/peta/[id]/tampilan",
      request_count: 1,
      payload_size: "Kecil (array group_id terlipat)",
      tabel_ditulis: "user_map_view_states",
      sinkron_ke_peta: "N/A (preferensi tampilan per user)"
    }
  ];
  console.table(writeBaseline);

  await queryClient.end();
}

measureBaseline().catch(e => {
  console.error("Baseline error:", e);
  process.exit(1);
});

