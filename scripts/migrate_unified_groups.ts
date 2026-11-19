import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";

async function runMigration() {
  console.log("=== MEMULAI MIGRASI DATA PENYATUAN GRUP (LANGKAH 3A) ===");

  // 1. Buat Unique Index pada lower(trim(nama)) di device_groups jika belum ada
  console.log("1. Membuat/memverifikasi index unik lower(trim(nama)) pada device_groups...");
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_groups_lower_trim_nama 
    ON device_groups (lower(trim(nama)));
  `);
  console.log("   Index unik aktif.");

  // 2. Normalisasi spasi dan huruf pada nama grup yang sudah ada
  console.log("2. Melakukan trim pada seluruh nama grup di device_groups...");
  await db.execute(sql`
    UPDATE device_groups 
    SET nama = trim(nama) 
    WHERE nama != trim(nama);
  `);

  // 3. Ambil daftar master device_groups
  const groupRows = (await db.execute(sql`SELECT id, nama FROM device_groups`)) as any[];
  console.log(`   Ditemukan ${groupRows.length} grup di device_groups:`, groupRows.map(g => `${g.nama} (${g.id})`));

  const groupMap = new Map<string, string>();
  for (const g of groupRows) {
    groupMap.set(g.nama.toLowerCase().trim(), g.id);
  }

  // Jika CYBER atau SEMARANG belum ada di database lokal, buatkan agar konsisten
  if (!groupMap.has("semarang")) {
    const [inserted] = (await db.execute(sql`
      INSERT INTO device_groups (nama, deskripsi, warna_garis, urutan)
      VALUES ('SEMARANG', 'Wilayah Semarang dan Cabang Operasional', 'biru', 1)
      RETURNING id, nama
    `)) as any[];
    groupMap.set("semarang", inserted.id);
    console.log("   Dibuat grup master SEMARANG:", inserted.id);
  }

  if (!groupMap.has("cyber")) {
    const [inserted] = (await db.execute(sql`
      INSERT INTO device_groups (nama, deskripsi, warna_garis, urutan)
      VALUES ('CYBER', 'Data Center & Server Cyber', 'biru', 2)
      RETURNING id, nama
    `)) as any[];
    groupMap.set("cyber", inserted.id);
    console.log("   Dibuat grup master CYBER:", inserted.id);
  }

  const semarangId = groupMap.get("semarang")!;
  const cyberId = groupMap.get("cyber")!;

  // 4. Sinkronkan devices.group_id sesuai keputusan pengguna:
  console.log("3. Mensinkronkan devices.group_id sesuai keputusan...");
  
  // SEMARANG devices
  const semarangDevices = ["Main Mikrotik", "J30", "LocalHost", "WHMCS"];
  for (const name of semarangDevices) {
    const res = await db.execute(sql`
      UPDATE devices 
      SET group_id = ${semarangId} 
      WHERE lower(trim(name)) = lower(${name})
    `);
    console.log(`   - Menetapkan '${name}' -> SEMARANG`);
  }

  // CYBER devices
  const cyberDevices = [
    "SEEVER 183",
    "MONITORING THE DUDE",
    "SERVER 1",
    "SERVER 190",
    "SERVER 7",
    "SERVER181",
    "SERVER4",
    "SERVER9"
  ];
  for (const name of cyberDevices) {
    const res = await db.execute(sql`
      UPDATE devices 
      SET group_id = ${cyberId} 
      WHERE lower(trim(name)) = lower(${name})
    `);
    console.log(`   - Menetapkan '${name}' -> CYBER`);
  }

  // SG197 (Tanpa Grup)
  await db.execute(sql`
    UPDATE devices 
    SET group_id = NULL 
    WHERE lower(trim(name)) = 'sg197'
  `);
  console.log("   - Menetapkan 'SG197' -> Tanpa Grup (NULL)");

  // 5. Update user_map_view_states
  console.log("4. Memperbarui user_map_view_states jika ada referensi ID grup lama...");
  // Mapping dari topology_groups lama ke device_groups baru
  const topoGroups = (await db.execute(sql`SELECT id, nama FROM topology_groups`)) as any[];
  for (const tg of topoGroups) {
    const normalizedName = tg.nama.toLowerCase().trim();
    const targetDgId = groupMap.get(normalizedName);
    if (targetDgId) {
      // Ganti ID lama di array JSONB collapsed_group_ids
      await db.execute(sql`
        UPDATE user_map_view_states
        SET collapsed_group_ids = (
          SELECT jsonb_agg(
            CASE 
              WHEN elem::text = ${JSON.stringify(tg.id)} THEN ${JSON.stringify(targetDgId)}::jsonb
              ELSE elem 
            END
          )
          FROM jsonb_array_elements(collapsed_group_ids) AS elem
        )
        WHERE collapsed_group_ids @> ${JSON.stringify([tg.id])}::jsonb;
      `);
      console.log(`   - Memetakan preferensi tampilan grup '${tg.nama}': ${tg.id} -> ${targetDgId}`);
    }
  }

  // 6. Atur koordinat posisi node di topology_nodes agar tertata rapi dan tidak tumpang tindih
  console.log("5. Mengatur koordinat posisi node agar bounding box grup rapi dan terpisah...");
  
  // Posisi anggota SEMARANG (Kiri Atas):
  const semarangCoords: Record<string, { x: number; y: number }> = {
    "Main Mikrotik": { x: -350, y: -400 },
    "SEEVER 183": { x: 500, y: 100 }, // Dipindahkan ke cluster CYBER!
    "J30": { x: -350, y: -260 },
    "LocalHost": { x: -140, y: -260 },
    "WHMCS": { x: -140, y: -400 },
  };

  // Posisi anggota CYBER (Kanan / Bawah terpisah jauh dari SEMARANG):
  const cyberCoords: Record<string, { x: number; y: number }> = {
    "MONITORING THE DUDE": { x: 280, y: 100 },
    "SERVER 1": { x: 280, y: 240 },
    "SERVER 190": { x: 500, y: 240 },
    "SERVER 7": { x: 720, y: 100 },
    "SERVER181": { x: 720, y: 240 },
    "SERVER4": { x: 940, y: 100 },
    "SERVER9": { x: 940, y: 240 },
    "SEEVER 183": { x: 500, y: 100 },
  };

  for (const [name, pos] of Object.entries(semarangCoords)) {
    if (name === "SEEVER 183") continue; // SEEVER 183 ada di cyberCoords
    await db.execute(sql`
      UPDATE topology_nodes 
      SET x = ${pos.x}, y = ${pos.y}
      WHERE device_id IN (SELECT id FROM devices WHERE lower(trim(name)) = lower(${name}))
    `);
  }

  for (const [name, pos] of Object.entries(cyberCoords)) {
    await db.execute(sql`
      UPDATE topology_nodes 
      SET x = ${pos.x}, y = ${pos.y}
      WHERE device_id IN (SELECT id FROM devices WHERE lower(trim(name)) = lower(${name}))
    `);
  }

  // Pastikan SG197 di posisi bebas
  await db.execute(sql`
    UPDATE topology_nodes 
    SET x = 1200, y = 100
    WHERE device_id IN (SELECT id FROM devices WHERE lower(trim(name)) = 'sg197')
  `);

  console.log("=== MIGRASI DATA BERHASIL DILAKSANAKAN ===");
  process.exit(0);
}

runMigration().catch(err => {
  console.error("Gagal migrasi data:", err);
  process.exit(1);
});

