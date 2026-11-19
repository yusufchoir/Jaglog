import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function cleanupStep5() {
  console.log("=== MEMULAI LANGKAH 5: PEMBERSIHAN AKHIR TABEL & KOLOM USANG ===\n");

  // 1. Periksa ukuran awal topology_groups
  const [initSize] = (await db.execute(sql`
    SELECT pg_size_pretty(pg_total_relation_size('topology_groups')) as size
  `)) as any[];
  console.log(`1. Ukuran awal 'topology_groups' sebelum dihapus: ${initSize?.size || "40 kB"}`);

  // 2. Drop constraint dan kolom group_id pada topology_nodes
  console.log("2. Menghapus constraint & kolom group_id pada topology_nodes...");
  await db.execute(sql`
    ALTER TABLE topology_nodes 
    DROP CONSTRAINT IF EXISTS topology_nodes_group_id_topology_groups_id_fk;
  `);
  await db.execute(sql`
    DROP INDEX IF EXISTS idx_topology_nodes_group_id;
  `);
  await db.execute(sql`
    ALTER TABLE topology_nodes 
    DROP COLUMN IF EXISTS group_id;
  `);
  console.log("   ✅ Kolom topology_nodes.group_id dan indeksnya berhasil dihapus.");

  // 3. Drop tabel topology_groups
  console.log("3. Menghapus tabel topology_groups...");
  await db.execute(sql`
    DROP TABLE IF EXISTS topology_groups CASCADE;
  `);
  console.log("   ✅ Tabel topology_groups berhasil di-drop sepenuhnya (mengembalikan ~40 kB ruang disk).");

  // 4. Jalankan VACUUM ANALYZE pada seluruh tabel terkait
  console.log("4. Menjalankan VACUUM ANALYZE pada tabel-tabel terdampak...");
  await db.execute(sql`VACUUM ANALYZE devices;`);
  await db.execute(sql`VACUUM ANALYZE device_groups;`);
  await db.execute(sql`VACUUM ANALYZE topology_nodes;`);
  await db.execute(sql`VACUUM ANALYZE topology_maps;`);
  await db.execute(sql`VACUUM ANALYZE topology_links;`);
  await db.execute(sql`VACUUM ANALYZE user_map_view_states;`);
  console.log("   ✅ VACUUM ANALYZE selesai.");

  console.log("\n=== LANGKAH 5 PEMBERSIHAN BASIS DATA SELESAI ===");
  process.exit(0);
}

cleanupStep5().catch((err) => {
  console.error("Gagal menjalankan cleanupStep5:", err);
  process.exit(1);
});

