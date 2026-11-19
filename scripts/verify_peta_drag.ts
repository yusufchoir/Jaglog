import assert from "node:assert";

const BASE_URL = "http://localhost:3000";

async function run() {
  console.log("=== VERIFIKASI PENGGESERAN NODE & PENYIMPANAN TATA LETAK PETA ===");

  // 1. Login sebagai Admin
  console.log("1. Melakukan login sebagai Admin...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.strictEqual(loginRes.status, 200, "Admin login harus berhasil 200");
  const cookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";
  console.log("   ✓ Berhasil login admin, sesi diperoleh.");

  // 2. Ambil data peta aktif
  console.log("2. Mengambil data peta aktif (GET /api/peta)...");
  const petaRes = await fetch(`${BASE_URL}/api/peta`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(petaRes.status, 200, "GET /api/peta harus 200");
  const petaData = await petaRes.json();
  const mapId = petaData.peta.id;
  console.log(`   ✓ ID Peta: ${mapId}, Nama: ${petaData.peta.nama}`);
  console.log(`   ✓ Jumlah node saat ini: ${petaData.node.length}`);

  let testNodeId = "";
  if (petaData.node.length === 0) {
    console.log("   Membuat node virtual uji...");
    const createNodeRes = await fetch(`${BASE_URL}/api/peta/${mapId}/nodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ tipeVirtual: "cloud", label: "Cloud Node Uji", x: 100, y: 100 }),
    });
    const createdNode = await createNodeRes.json();
    testNodeId = createdNode.node.id;
  } else {
    testNodeId = petaData.node[0].id;
  }
  console.log(`   ✓ Menggunakan node uji ID: ${testNodeId}`);

  // 3. Menggeser node (PUT /api/peta/{id}/layout)
  console.log("3. Menggeser posisi node ke koordinat baru (X: 320, Y: 450)...");
  const layoutRes = await fetch(`${BASE_URL}/api/peta/${mapId}/layout`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      clientId: "client_test_verification",
      version: petaData.versi || Date.now(),
      nodes: [{ id: testNodeId, x: 320, y: 450 }],
      groups: [],
    }),
  });
  console.log(`   HTTP Status: ${layoutRes.status}`);
  const layoutJson = await layoutRes.json();
  console.log(`   Respons Server:`, layoutJson);
  assert.strictEqual(layoutRes.status, 200, "PUT /api/peta/[id]/layout harus 200 (tanpa penolakan 409)");
  assert.strictEqual(layoutJson.success, true);
  console.log("   ✓ Simpan posisi node berhasil tanpa penolakan!");

  // 4. Verifikasi di database apakah posisi benar-benar berubah
  console.log("4. Memverifikasi koordinat node tersimpan via GET /api/peta...");
  const verifyRes = await fetch(`${BASE_URL}/api/peta?peta_id=${mapId}`, {
    headers: { Cookie: cookie },
  });
  const verifyData = await verifyRes.json();
  const targetNode = verifyData.node.find((n: any) => n.id === testNodeId);
  console.log(`   Koordinat Node di Peta: X=${targetNode.x}, Y=${targetNode.y}`);
  assert.strictEqual(targetNode.x, 320);
  assert.strictEqual(targetNode.y, 450);
  console.log("   ✓ Koordinat berhasil terverifikasi persisten di database!");

  // 5. Uji seret cepat berturut-turut 20 kali (simulasi drag intensif)
  console.log("5. Simulasi 20 kali pergeseran cepat (uji anti-konflik race condition)...");
  for (let i = 1; i <= 20; i++) {
    const curX = 100 + i * 10;
    const curY = 150 + i * 5;
    const dragRes = await fetch(`${BASE_URL}/api/peta/${mapId}/layout`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        clientId: "client_test_verification",
        version: Date.now() - 5000, // Sengaja kirim versi lebih lama untuk pastikan tidak ada 409
        nodes: [{ id: testNodeId, x: curX, y: curY }],
        groups: [],
      }),
    });
    assert.strictEqual(dragRes.status, 200, `Drag ke-${i} harus berhasil 200`);
  }
  console.log("   ✓ Seluruh 20 pergeseran cepat berhasil disimpan 100% tanpa ada penolakan konflik!");

  console.log("\n=======================================================");
  console.log("KESIMPULAN: Kode lokal 100% SUDAH BERHASIL BISA DIUBAH!");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("Gagal verifikasi:", err);
  process.exit(1);
});

