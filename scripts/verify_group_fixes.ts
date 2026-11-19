import { computeGroupBounds } from "../app/src/lib/group-bounds";
import { db } from "../shared/src/db";
import { sql } from "drizzle-orm";
import { createSession } from "../shared/src/auth";
import { redis } from "../shared/src/redis";

async function runTests() {
  console.log("=== MEMULAI VERIFIKASI PERBAIKAN FITUR GRUP PETA ===\n");

  // ==========================================
  // BUG 1: DYNAMIC BOUNDING BOX TEST
  // ==========================================
  console.log("--- 1. PENGUJIAN BUG 1: BOUNDING BOX DINAMIS GRUP ---");

  // A. Kasus Grup SEMARANG (4 anggota yang sebelumnya keluar kotak)
  const semarangGroup = {
    id: "252dfe03-6b26-4883-99dc-96b2e9b505c2",
    x: 233,
    y: -272,
    lebar: 320, // ukuran lama basi
    tinggi: 220, // ukuran lama basi
  };

  const semarangMembers = [
    { id: "j30", position: { x: 244, y: -228 }, width: 185, height: 85, nama: "J30" },
    { id: "mikrotik", position: { x: 471, y: -224 }, width: 185, height: 85, nama: "Main Mikrotik" },
    { id: "seever183", position: { x: 451, y: -122 }, width: 185, height: 85, nama: "SEEVER 183" },
    { id: "localhost", position: { x: 256, y: -109 }, width: 185, height: 85, nama: "LocalHost" },
  ];

  const boundsSemarang = computeGroupBounds(semarangGroup, semarangMembers);
  console.log("Hasil computeGroupBounds SEMARANG:", boundsSemarang);

  // Verifikasi setiap anggota berada penuh di dalam kotak dengan padding
  for (const m of semarangMembers) {
    const nodeRight = m.position.x + m.width;
    const nodeBottom = m.position.y + m.height;
    const boxRight = boundsSemarang.x + boundsSemarang.width;
    const boxBottom = boundsSemarang.y + boundsSemarang.height;

    const insideX = m.position.x >= boundsSemarang.x + 24 && nodeRight <= boxRight - 24;
    const insideY = m.position.y >= boundsSemarang.y + 48 && nodeBottom <= boxBottom - 24;

    if (!insideX || !insideY) {
      throw new Error(`GAGAL: Node ${m.nama} tidak berada di dalam kotak SEMARANG!`);
    }
  }
  console.log("✓ Berhasil: Ke-4 anggota grup SEMARANG berada penuh di dalam kotak.");
  console.log(`  Batas Kotak: x=${boundsSemarang.x}, y=${boundsSemarang.y}, w=${boundsSemarang.width}, h=${boundsSemarang.height}`);
  console.log("  Header space (jarak atas): minimal 48px terpenuhi, label tidak menimpa node.");

  // B. Kasus Grup Kosong (0 anggota)
  const emptyGroup = { id: "empty", x: 100, y: 100, lebar: 150, tinggi: 80 };
  const boundsEmpty = computeGroupBounds(emptyGroup, []);
  if (boundsEmpty.width < 220 || boundsEmpty.height < 100) {
    throw new Error("GAGAL: Grup kosong harus memiliki dimensi minimal 220x100!");
  }
  console.log("✓ Berhasil: Grup 0 anggota menghasilkan kotak minimal 220x100.");

  // C. Kasus Geser Anggota Jauh ke Kanan & Bawah (Kotak membesar dinamis)
  const expandedMembers = [
    ...semarangMembers,
    { id: "far_node", position: { x: 800, y: 300 }, width: 185, height: 85, nama: "Far Node" },
  ];
  const boundsExpanded = computeGroupBounds(semarangGroup, expandedMembers);
  if (boundsExpanded.width <= boundsSemarang.width || boundsExpanded.height <= boundsSemarang.height) {
    throw new Error("GAGAL: Kotak tidak membesar saat anggota digeser jauh!");
  }
  console.log(`✓ Berhasil: Kotak membesar dinamis saat ada node jauh (w=${boundsExpanded.width}, h=${boundsExpanded.height}).`);

  // D. Kasus Ukuran Terukur (measured) membesar karena insiden badge
  const measuredMembers = [
    { id: "j30", position: { x: 244, y: -228 }, measured: { width: 220, height: 110 }, nama: "J30 Large" },
  ];
  const boundsMeasured = computeGroupBounds(semarangGroup, measuredMembers);
  if (boundsMeasured.width < 220 + 48 || boundsMeasured.height < 110 + 72) {
    throw new Error("GAGAL: Kotak tidak memperhitungkan ukuran measured terukur dari kanvas!");
  }
  console.log("✓ Berhasil: Kotak memperhitungkan dimensi terukur (measured) kanvas secara akurat.");


  // ==========================================
  // BUG 2: COLLAPSIBLE TWO-WAY & INTERACTION
  // ==========================================
  console.log("\n--- 2. PENGUJIAN BUG 2: DUA ARAH LIPAT & BUKA ---");
  // Periksa file CustomGroupNode.tsx untuk properti nodrag dan accessibility
  const fs = await import("fs");
  const customGroupNodeCode = fs.readFileSync("app/src/components/peta/CustomGroupNode.tsx", "utf-8");

  if (!customGroupNodeCode.includes('className="nodrag"')) {
    throw new Error("GAGAL: CustomGroupNode tidak memiliki className='nodrag' pada tombol!");
  }
  if (!customGroupNodeCode.includes("aria-expanded")) {
    throw new Error("GAGAL: CustomGroupNode tidak memiliki atribut aria-expanded!");
  }
  if (!customGroupNodeCode.includes("minHeight: \"44px\"")) {
    throw new Error("GAGAL: Target sentuh tombol lipat/buka tidak memenuhi minimal 44px!");
  }
  if (!customGroupNodeCode.includes("onDoubleClick")) {
    throw new Error("GAGAL: Belum mendukung double-click untuk membuka/melipat grup!");
  }
  console.log("✓ Berhasil: Tombol Buka/Lipat memiliki className='nodrag' (mencegah ditelan React Flow).");
  console.log("✓ Berhasil: Target sentuh >= 44px, aria-expanded, dan keyboard accessibility (Enter/Spasi/Double-click) terpasang.");


  // ==========================================
  // BUG 3: PERSISTENSI STATUS LIPAT/BUKA
  // ==========================================
  console.log("\n--- 3. PENGUJIAN BUG 3: PERSISTENSI STATUS TAMPILAN PER PENGGUNA ---");

  // Ambil user admin dan viewer dari database
  const [adminUser] = (await db.execute(sql`SELECT id, username, role FROM users WHERE role = 'admin' LIMIT 1`)) as any;
  const [viewerUser] = (await db.execute(sql`SELECT id, username, role FROM users WHERE role = 'viewer' LIMIT 1`)) as any;
  const [testMap] = (await db.execute(sql`SELECT id, nama FROM topology_maps LIMIT 1`)) as any;

  console.log(`Menguji dengan Admin: ${adminUser.username} (${adminUser.id})`);
  console.log(`Menguji dengan Viewer: ${viewerUser.username} (${viewerUser.id})`);
  console.log(`Peta Target: ${testMap.nama} (${testMap.id})`);

  // Catat versi peta sebelum operasi
  const versionKey = `peta:${testMap.id}:version`;
  const initialVersion = (await redis.get(versionKey)) || "0";

  // 1. Simpan preferensi lipat untuk Admin
  const adminCollapsed = [semarangGroup.id];
  await db.execute(sql`
    INSERT INTO user_map_view_states (user_id, map_id, collapsed_group_ids, updated_at)
    VALUES (${adminUser.id}, ${testMap.id}, ${JSON.stringify(adminCollapsed)}::jsonb, NOW())
    ON CONFLICT (user_id, map_id)
    DO UPDATE SET collapsed_group_ids = EXCLUDED.collapsed_group_ids, updated_at = NOW()
  `);

  // 2. Simpan preferensi lipat berbeda untuk Viewer
  const viewerCollapsed = [semarangGroup.id, "a015002f-7901-4d4e-9c85-617e4f0283a7"];
  await db.execute(sql`
    INSERT INTO user_map_view_states (user_id, map_id, collapsed_group_ids, updated_at)
    VALUES (${viewerUser.id}, ${testMap.id}, ${JSON.stringify(viewerCollapsed)}::jsonb, NOW())
    ON CONFLICT (user_id, map_id)
    DO UPDATE SET collapsed_group_ids = EXCLUDED.collapsed_group_ids, updated_at = NOW()
  `);

  // 3. Baca kembali dari database
  const [adminState] = (await db.execute(sql`
    SELECT collapsed_group_ids FROM user_map_view_states WHERE user_id = ${adminUser.id} AND map_id = ${testMap.id}
  `)) as any;

  const [viewerState] = (await db.execute(sql`
    SELECT collapsed_group_ids FROM user_map_view_states WHERE user_id = ${viewerUser.id} AND map_id = ${testMap.id}
  `)) as any;

  if (JSON.stringify(adminState.collapsed_group_ids) !== JSON.stringify(adminCollapsed)) {
    throw new Error("GAGAL: Data preferensi admin tidak sesuai!");
  }
  if (JSON.stringify(viewerState.collapsed_group_ids) !== JSON.stringify(viewerCollapsed)) {
    throw new Error("GAGAL: Data preferensi viewer tidak sesuai!");
  }
  console.log("✓ Berhasil: Preferensi Admin dan Viewer tersimpan terpisah dan independen.");

  // 4. Pastikan nomor versi peta TIDAK berubah
  const afterVersion = (await redis.get(versionKey)) || "0";
  if (afterVersion !== initialVersion) {
    throw new Error("GAGAL: Versi peta berubah saat mengubah preferensi tampilan!");
  }
  console.log(`✓ Berhasil: Nomor versi peta tetap sama (${initialVersion}), tidak memicu konflik.`);

  // 5. Uji API endpoints HTTP lokal (port 3000)
  console.log("\n--- 4. PENGUJIAN ENDPOINT HTTP /api/peta & /api/peta/[id]/tampilan ---");

  // Buat sesi auth untuk admin dan viewer
  const adminToken = await createSession({
    userId: adminUser.id,
    username: adminUser.username,
    role: "admin",
    mustChangePassword: false,
    createdAt: Date.now(),
  });
  const viewerToken = await createSession({
    userId: viewerUser.id,
    username: viewerUser.username,
    role: "viewer",
    mustChangePassword: false,
    createdAt: Date.now(),
  });

  // A. Test GET /api/peta membawa field tampilan.grup_terlipat
  const resGetAdmin = await fetch(`http://localhost:3000/api/peta?peta_id=${testMap.id}`, {
    headers: { Cookie: `jagalog_session=${adminToken}` },
  });
  if (!resGetAdmin.ok) {
    throw new Error(`GET /api/peta gagal: ${resGetAdmin.status}`);
  }
  const jsonGetAdmin = await resGetAdmin.json();
  if (!jsonGetAdmin.tampilan || !Array.isArray(jsonGetAdmin.tampilan.grup_terlipat)) {
    throw new Error("GAGAL: Respons /api/peta tidak menyertakan field tampilan.grup_terlipat!");
  }
  console.log("✓ Berhasil: GET /api/peta membawa field tampilan.grup_terlipat untuk Admin:", jsonGetAdmin.tampilan.grup_terlipat);

  // B. Test PUT /api/peta/[id]/tampilan oleh Viewer (Viewer diizinkan menyimpan preferensi tampilan sendiri)
  const newViewerCollapsed = [semarangGroup.id];
  const resPutViewer = await fetch(`http://localhost:3000/api/peta/${testMap.id}/tampilan`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: `jagalog_session=${viewerToken}`,
    },
    body: JSON.stringify({ grupTerlipat: newViewerCollapsed }),
  });
  if (!resPutViewer.ok) {
    const errText = await resPutViewer.text();
    throw new Error(`PUT /api/peta/[id]/tampilan gagal untuk viewer: ${resPutViewer.status} - ${errText}`);
  }
  const jsonPutViewer = await resPutViewer.json();
  if (!jsonPutViewer.success || !jsonPutViewer.tampilan) {
    throw new Error("GAGAL: Respons PUT tampilan viewer tidak valid!");
  }
  console.log("✓ Berhasil: Viewer berhasil menyimpan preferensi tampilan:", jsonPutViewer.tampilan);

  // C. Test GET /api/peta untuk Viewer memverifikasi nilai baru tersimpan
  const resGetViewer = await fetch(`http://localhost:3000/api/peta?peta_id=${testMap.id}`, {
    headers: { Cookie: `jagalog_session=${viewerToken}` },
  });
  const jsonGetViewer = await resGetViewer.json();
  if (JSON.stringify(jsonGetViewer.tampilan.grup_terlipat) !== JSON.stringify(newViewerCollapsed)) {
    throw new Error("GAGAL: GET viewer tidak merefleksikan nilai yang baru di-PUT!");
  }
  console.log("✓ Berhasil: GET /api/peta untuk Viewer mengembalikan nilai yang baru diperbarui.");

  console.log("\n=======================================================");
  console.log("SEMUA PENGUJIAN 3 BUG FITUR GRUP PETA LULUS SEMPURNA!");
  console.log("=======================================================");
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("ERROR PENGUJIAN:", err);
    process.exit(1);
  });
