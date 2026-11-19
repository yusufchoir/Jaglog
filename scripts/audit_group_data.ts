import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function audit() {
  console.log("=================================================================");
  console.log("AUDIT 1A: DATA REAL DI DATABASE");
  console.log("=================================================================");

  // 1. Device Groups
  const deviceGroupsList = (await db.execute(sql`
    SELECT id, nama, deskripsi, warna_garis, urutan, parent_id, created_at 
    FROM device_groups 
    ORDER BY nama
  `)) as any[];
  console.log(`\n1. device_groups (Total: ${deviceGroupsList.length}):`);
  console.table(deviceGroupsList.map(g => ({
    id: g.id,
    nama: g.nama,
    warna: g.warna_garis,
    parentId: g.parent_id
  })));

  // 2. Topology Groups
  const topologyGroupsList = (await db.execute(sql`
    SELECT id, map_id, device_group_id, nama, warna_garis, x, y, lebar, tinggi 
    FROM topology_groups 
    ORDER BY nama
  `)) as any[];
  console.log(`\n2. topology_groups (Total: ${topologyGroupsList.length}):`);
  console.table(topologyGroupsList.map(g => ({
    id: g.id,
    nama: g.nama,
    deviceGroupId: g.device_group_id,
    warna: g.warna_garis,
    x: g.x,
    y: g.y,
    w: g.lebar,
    h: g.tinggi
  })));

  // 3. Topology Maps
  const topologyMapsList = (await db.execute(sql`
    SELECT id, nama, is_default, is_demo FROM topology_maps
  `)) as any[];
  console.log(`\n3. topology_maps (Total: ${topologyMapsList.length}):`);
  console.table(topologyMapsList);

  // 4. Devices & Group Membership
  const devicesList = (await db.execute(sql`
    SELECT 
      d.id, 
      d.name, 
      d.ip_address, 
      d.location, 
      d.group_id AS dev_group_id,
      dg.nama AS dev_group_nama
    FROM devices d
    LEFT JOIN device_groups dg ON d.group_id = dg.id
    ORDER BY d.name
  `)) as any[];
  console.log(`\n4. devices (Total: ${devicesList.length}):`);

  // 5. Topology Nodes
  const nodesList = (await db.execute(sql`
    SELECT 
      tn.id AS node_id,
      tn.map_id,
      tn.device_id,
      d.name AS device_name,
      tn.label,
      tn.tipe_virtual,
      tn.x,
      tn.y,
      tn.group_id AS node_group_id,
      tg.nama AS topo_group_nama,
      tg.device_group_id AS topo_device_group_id
    FROM topology_nodes tn
    LEFT JOIN devices d ON tn.device_id = d.id
    LEFT JOIN topology_groups tg ON tn.group_id = tg.id
    ORDER BY COALESCE(d.name, tn.label)
  `)) as any[];
  console.log(`\n5. topology_nodes (Total: ${nodesList.length}):`);

  // 6. Mapping perbandingan Device vs Node vs Group
  console.log("\n=================================================================");
  console.log("TABEL KONFLIK KEANGGOTAAN PER PERANGKAT:");
  console.log("=================================================================");
  const conflictTable: any[] = [];

  for (const dev of devicesList) {
    const node = nodesList.find(n => n.device_id === dev.id);
    const devGroup = dev.dev_group_nama || "(Tanpa Grup)";
    const topoGroup = node ? (node.topo_group_nama || "(Tanpa Grup di Peta)") : "(Tidak ada di Peta)";
    
    // Hitung posisi visual terhadap kotak topology_groups jika node ada di peta
    let visualGroup = "(Luar Kotak)";
    if (node) {
      for (const tg of topologyGroupsList) {
        // Asumsi node width 185, height 85
        const nodeW = 185;
        const nodeH = 85;
        const inBox = (
          node.x >= tg.x &&
          node.x + nodeW <= tg.x + tg.lebar &&
          node.y >= tg.y &&
          node.y + nodeH <= tg.y + tg.tinggi
        );
        // Cek juga partial overlap
        const partialOverlap = (
          node.x < tg.x + tg.lebar &&
          node.x + nodeW > tg.x &&
          node.y < tg.y + tg.tinggi &&
          node.y + nodeH > tg.y
        );
        if (inBox) {
          visualGroup = `${tg.nama} (Penuh)`;
          break;
        } else if (partialOverlap) {
          visualGroup = `${tg.nama} (Parsial)`;
          break;
        }
      }
    }

    const isConflict = node && (devGroup !== topoGroup);

    conflictTable.push({
      perangkat: dev.name,
      ip: dev.ip_address,
      grup_di_devices: devGroup,
      grup_di_topology_nodes: topoGroup,
      grup_visual_kotak: visualGroup,
      ada_di_peta: node ? "Ya" : "Tidak",
      status_konflik: !node ? "Belum di peta" : (devGroup === topoGroup ? "SAMA" : "KONFLIK")
    });
  }

  console.table(conflictTable);

  // 7. Cek Duplikasi dan Yatim
  console.log("\n=================================================================");
  console.log("AUDIT ANOMALI: DUPLIKASI, YATIM & REFERENSI RUSAK");
  console.log("=================================================================");

  // a. Node ganda untuk perangkat yang sama
  const duplicateDeviceNodes = (await db.execute(sql`
    SELECT map_id, device_id, count(*) as count 
    FROM topology_nodes 
    WHERE device_id IS NOT NULL 
    GROUP BY map_id, device_id 
    HAVING count(*) > 1
  `)) as any[];
  console.log("- Node ganda untuk device_id yang sama:", duplicateDeviceNodes);

  // b. Node yatim (device_id tidak ada di tabel devices)
  const orphanNodes = (await db.execute(sql`
    SELECT tn.id, tn.map_id, tn.device_id 
    FROM topology_nodes tn 
    LEFT JOIN devices d ON tn.device_id = d.id 
    WHERE tn.device_id IS NOT NULL AND d.id IS NULL
  `)) as any[];
  console.log("- Node yatim (device_id merujuk id yang tidak ada):", orphanNodes);

  // c. Node dengan group_id yatim (group_id tidak ada di topology_groups)
  const orphanGroupNodes = (await db.execute(sql`
    SELECT tn.id, tn.map_id, tn.group_id 
    FROM topology_nodes tn 
    LEFT JOIN topology_groups tg ON tn.group_id = tg.id 
    WHERE tn.group_id IS NOT NULL AND tg.id IS NULL
  `)) as any[];
  console.log("- Node dengan topology group_id yatim:", orphanGroupNodes);

  // d. Devices dengan group_id yatim (group_id tidak ada di device_groups)
  const orphanDeviceGroups = (await db.execute(sql`
    SELECT d.id, d.name, d.group_id 
    FROM devices d 
    LEFT JOIN device_groups dg ON d.group_id = dg.id 
    WHERE d.group_id IS NOT NULL AND dg.id IS NULL
  `)) as any[];
  console.log("- Devices dengan device group_id yatim:", orphanDeviceGroups);

  // e. Link ganda
  const duplicateLinks = (await db.execute(sql`
    SELECT source_node_id, target_node_id, count(*) 
    FROM topology_links 
    GROUP BY source_node_id, target_node_id 
    HAVING count(*) > 1
  `)) as any[];
  console.log("- Link ganda:", duplicateLinks);

  // f. Nama grup mirip/sama di kedua tabel
  console.log("\nPerbandingan nama device_groups vs topology_groups:");
  const devGroupNames = deviceGroupsList.map(g => g.nama.trim().toLowerCase());
  const topoGroupNames = topologyGroupsList.map(g => g.nama.trim().toLowerCase());
  console.log("device_groups:", deviceGroupsList.map(g => g.nama));
  console.log("topology_groups:", topologyGroupsList.map(g => g.nama));

  process.exit(0);
}

audit().catch(e => {
  console.error("Error audit:", e);
  process.exit(1);
});

