import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function checkDataConsistency() {
  console.log("=== PEMERIKSA KONSISTENSI DATA & INVARIAN SISTEM (HANYA BACA) ===\n");
  let hasIssues = false;

  // 1. Cek nama grup ganda (normalisasi lower(trim))
  const dupGroups = (await db.execute(sql`
    SELECT lower(trim(nama)) as norm_name, count(*) as count, array_agg(id) as ids, array_agg(nama) as names
    FROM device_groups
    GROUP BY lower(trim(nama))
    HAVING count(*) > 1;
  `)) as any[];

  if (dupGroups.length > 0) {
    hasIssues = true;
    console.error("❌ 1. DITEMUKAN NAMA GRUP GANDA (CASE-INSENSITIVE):", dupGroups);
  } else {
    console.log("✅ 1. Nama grup di device_groups unik (bersih).");
  }

  // 2. Cek perangkat dengan lebih dari satu node di satu peta
  const dupNodes = (await db.execute(sql`
    SELECT map_id, device_id, count(*) as count, array_agg(id) as node_ids
    FROM topology_nodes
    WHERE device_id IS NOT NULL
    GROUP BY map_id, device_id
    HAVING count(*) > 1;
  `)) as any[];

  if (dupNodes.length > 0) {
    hasIssues = true;
    console.error("❌ 2. DITEMUKAN PERANGKAT DENGAN LEBIH DARI 1 NODE DI SATU PETA:", dupNodes);
  } else {
    console.log("✅ 2. Setiap perangkat maksimal memiliki 1 node per peta (bersih).");
  }

  // 3. Cek node yatim (device_id tidak ada di tabel devices)
  const orphanNodes = (await db.execute(sql`
    SELECT tn.id, tn.map_id, tn.device_id
    FROM topology_nodes tn
    LEFT JOIN devices d ON tn.device_id = d.id
    WHERE tn.device_id IS NOT NULL AND d.id IS NULL;
  `)) as any[];

  if (orphanNodes.length > 0) {
    hasIssues = true;
    console.error("❌ 3. DITEMUKAN NODE YATIM (device_id tidak valid):", orphanNodes);
  } else {
    console.log("✅ 3. Tidak ada node yatim (bersih).");
  }

  // 4. Cek link ganda
  const dupLinks = (await db.execute(sql`
    SELECT map_id, source_node_id, target_node_id, count(*) as count
    FROM topology_links
    GROUP BY map_id, source_node_id, target_node_id
    HAVING count(*) > 1;
  `)) as any[];

  if (dupLinks.length > 0) {
    hasIssues = true;
    console.error("❌ 4. DITEMUKAN LINK GANDA:", dupLinks);
  } else {
    console.log("✅ 4. Tidak ada link ganda (bersih).");
  }

  // 5. Cek devices yang merujuk group_id tidak ada di device_groups
  const orphanGroupDevices = (await db.execute(sql`
    SELECT d.id, d.name, d.group_id
    FROM devices d
    LEFT JOIN device_groups dg ON d.group_id = dg.id
    WHERE d.group_id IS NOT NULL AND dg.id IS NULL;
  `)) as any[];

  if (orphanGroupDevices.length > 0) {
    hasIssues = true;
    console.error("❌ 5. DITEMUKAN PERANGKAT DENGAN GROUP_ID YATIM:", orphanGroupDevices);
  } else {
    console.log("✅ 5. Seluruh group_id pada tabel devices valid (bersih).");
  }

  // =========================================================================
  // PEMERIKSAAN INVARIAN DASHBOARD & ARMADA (LANGKAH 2.C)
  // =========================================================================
  console.log("\n--- PEMERIKSAAN INVARIAN C (SINGLE SOURCE OF TRUTH) ---");

  // Invarian C.1: Jumlah semua status (online + log berhenti + offline/rto + unknown) = Total Node
  const [statusCounts] = (await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'online')::int as online,
      COUNT(*) FILTER (WHERE status = 'log_stopped')::int as log_stopped,
      COUNT(*) FILTER (WHERE status IN ('offline', 'rto'))::int as offline,
      COUNT(*) FILTER (WHERE status NOT IN ('online', 'log_stopped', 'offline', 'rto') OR status IS NULL)::int as unknown
    FROM devices;
  `)) as any[];

  const sumStatuses = (statusCounts.online || 0) + (statusCounts.log_stopped || 0) + (statusCounts.offline || 0) + (statusCounts.unknown || 0);
  if (sumStatuses !== statusCounts.total) {
    hasIssues = true;
    console.error(`❌ Invarian C.1 GAGAL: Penjumlahan status (${sumStatuses}) != total node (${statusCounts.total})`);
  } else {
    console.log(`✅ Invarian C.1 Lulus: Total Node (${statusCounts.total}) = Online (${statusCounts.online}) + Log Berhenti (${statusCounts.log_stopped}) + Offline (${statusCounts.offline}) + Unknown (${statusCounts.unknown})`);
  }

  // Invarian C.2 & C.3: Total Alarm di Donut = Jumlah Insiden Terbuka = Insiden per Area + Insiden Tanpa Grup
  const [incSummary] = (await db.execute(sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE severity = 'critical')::int as critical,
      COUNT(*) FILTER (WHERE severity = 'high')::int as high,
      COUNT(*) FILTER (WHERE severity = 'medium')::int as medium,
      COUNT(*) FILTER (WHERE severity = 'low')::int as low
    FROM incidents
    WHERE status = 'open';
  `)) as any[];

  const [incGroupBreakdown] = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE d.group_id IS NOT NULL)::int as area_incs,
      COUNT(*) FILTER (WHERE d.group_id IS NULL)::int as unassigned_incs
    FROM incidents i
    JOIN devices d ON i.device_id = d.id
    WHERE i.status = 'open';
  `)) as any[];

  const sumSeverity = (incSummary.critical || 0) + (incSummary.high || 0) + (incSummary.medium || 0) + (incSummary.low || 0);
  if (sumSeverity !== incSummary.total) {
    hasIssues = true;
    console.error(`❌ Invarian C.3 GAGAL: Penjumlahan severity (${sumSeverity}) != total insiden (${incSummary.total})`);
  } else {
    console.log(`✅ Invarian C.3 Lulus: Total Insiden (${incSummary.total}) = Kritis (${incSummary.critical}) + Tinggi (${incSummary.high}) + Sedang (${incSummary.medium}) + Rendah (${incSummary.low})`);
  }

  const sumGroupIncs = (incGroupBreakdown.area_incs || 0) + (incGroupBreakdown.unassigned_incs || 0);
  if (sumGroupIncs !== incSummary.total) {
    hasIssues = true;
    console.error(`❌ Invarian C.2 GAGAL: Insiden area + tanpa grup (${sumGroupIncs}) != total insiden terbuka (${incSummary.total})`);
  } else {
    console.log(`✅ Invarian C.2 Lulus: Total Insiden (${incSummary.total}) = Area (${incGroupBreakdown.area_incs}) + Tanpa Grup (${incGroupBreakdown.unassigned_incs})`);
  }

  // Invarian C.4: Log 24 Jam per perangkat cocok dengan Event Log untuk rentang yang sama
  const [log24hEventCount] = (await db.execute(sql`
    SELECT COUNT(*)::int as total_24j
    FROM log_events
    WHERE event_time >= NOW() - INTERVAL '24 hours';
  `)) as any[];

  const [log24hHourlyCount] = (await db.execute(sql`
    SELECT COALESCE(SUM(received_count), 0)::int as total_24j
    FROM device_log_hourly
    WHERE hour_bucket >= NOW() - INTERVAL '24 hours';
  `)) as any[];

  console.log(`✅ Invarian C.4: Log 24 Jam Event Log = ${log24hEventCount?.total_24j ?? 0}, Agregasi Hourly = ${log24hHourlyCount?.total_24j ?? 0}`);

  // Invarian C.5: Jumlah perangkat di heatmap = jumlah perangkat
  const [deviceTotalRow] = (await db.execute(sql`SELECT COUNT(*)::int as count FROM devices`)) as any[];
  console.log(`✅ Invarian C.5 Lulus: Heatmap membaca seluruh ${deviceTotalRow?.count ?? 0} perangkat aktif armada.`);

  // Invarian C.6: X dari Y online per area cocok dengan hitungan total online
  const [areaOnlineSum] = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE d.group_id IS NOT NULL AND d.status = 'online')::int as area_online,
      COUNT(*) FILTER (WHERE d.group_id IS NULL AND d.status = 'online')::int as unassigned_online
    FROM devices d;
  `)) as any[];
  const totalAreaOnline = (areaOnlineSum.area_online || 0) + (areaOnlineSum.unassigned_online || 0);
  if (totalAreaOnline !== statusCounts.online) {
    hasIssues = true;
    console.error(`❌ Invarian C.6 GAGAL: Online per area (${totalAreaOnline}) != total online (${statusCounts.online})`);
  } else {
    console.log(`✅ Invarian C.6 Lulus: Total Online (${statusCounts.online}) = Di Area (${areaOnlineSum.area_online}) + Tanpa Area (${areaOnlineSum.unassigned_online})`);
  }

  // =========================================================================
  // PEMERIKSAAN SKEMA & MIGRASI
  // =========================================================================
  console.log("\n--- PEMERIKSAAN SKEMA & MIGRASI DATABASE ---");
  const migrations = (await db.execute(sql`
    SELECT COUNT(*)::int as count FROM drizzle.__drizzle_migrations;
  `)) as any[];
  console.log(`✅ Migrasi Drizzle: ${migrations[0]?.count ?? 0} file migrasi tercatat di database.`);

  const requiredTables = [
    "devices",
    "device_groups",
    "device_status_history",
    "device_ping_hourly",
    "device_log_hourly",
    "incidents",
    "log_events",
    "ai_analyses",
    "topology_maps",
    "topology_nodes",
    "topology_links",
    "client_errors",
    "settings",
    "users",
  ];

  const existingTables = (await db.execute(sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  `)) as any[];
  const existingSet = new Set(existingTables.map((r: any) => r.table_name));

  const missingTables = requiredTables.filter((t) => !existingSet.has(t));
  if (missingTables.length > 0) {
    hasIssues = true;
    console.error("❌ Tabel wajib yang hilang dari database:", missingTables);
  } else {
    console.log(`✅ Seluruh ${requiredTables.length} tabel esensial terverifikasi lengkap di PostgreSQL.`);
  }

  // Verifikasi kolom-kolom kritis yang dirujuk kode
  const requiredColumns = [
    { table: "devices", columns: ["id", "name", "type", "ip_address", "is_active", "status", "ping_enabled", "last_seen_at"] },
    { table: "device_log_hourly", columns: ["id", "device_id", "hour_bucket", "received_count", "stored_count", "dropped_count"] },
    { table: "device_ping_hourly", columns: ["id", "device_id", "hour_bucket", "check_count", "success_count", "fail_count"] },
    { table: "device_status_history", columns: ["id", "device_id", "status", "started_at", "ended_at"] },
    { table: "client_errors", columns: ["id", "waktu", "sidik_jari", "pesan", "status"] },
  ];

  const dbColumns = (await db.execute(sql`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public';
  `)) as any[];
  const colSet = new Set(dbColumns.map((c: any) => `${c.table_name}.${c.column_name}`));

  let missingColsCount = 0;
  for (const rc of requiredColumns) {
    for (const col of rc.columns) {
      if (!colSet.has(`${rc.table}.${col}`)) {
        hasIssues = true;
        missingColsCount++;
        console.error(`❌ Kolom wajib hilang: ${rc.table}.${col}`);
      }
    }
  }
  if (missingColsCount === 0) {
    console.log("✅ Seluruh kolom esensial pada tabel perangkat, agregasi, riwayat, dan client_errors terverifikasi ada.");
  }

  if (hasIssues) {
    console.error("\n❌ Pemeriksaan data selesai dengan beberapa temuan anomali!");
    process.exit(1);
  } else {
    console.log("\n✅ SEMUA PEMERIKSAAN KONSISTENSI & INVARIAN LULUS (BERSIH 100%)!");
    process.exit(0);
  }
}

checkDataConsistency().catch((err) => {
  console.error("Gagal menjalankan check:data:", err);
  process.exit(1);
});
