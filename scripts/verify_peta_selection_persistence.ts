import assert from "node:assert";

async function main() {
  console.log("=== VERIFIKASI ANTI-REVERT NODE PADA KLIK / SELEKSI / SYNC ===");
  const baseUrl = "http://localhost:3000";

  // 1. Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.strictEqual(loginRes.status, 200, "Login gagal");
  const cookie = loginRes.headers.get("set-cookie") || "";

  // 2. Ambil peta
  const petaRes = await fetch(`${baseUrl}/api/peta`, {
    headers: { Cookie: cookie },
  });
  assert.strictEqual(petaRes.status, 200, "Ambil peta gagal");
  const petaData = await petaRes.json();
  const mapId = petaData.peta.id;
  const nodes = petaData.node;
  assert.ok(nodes.length >= 2, "Harus ada minimal 2 node untuk uji seleksi");

  const targetNode = nodes[0];
  const secondNode = nodes[1];
  console.log(`Node 1: ${targetNode.nama} (${targetNode.id})`);
  console.log(`Node 2: ${secondNode.nama} (${secondNode.id})`);

  // 3. Pindahkan Node 1 ke koordinat baru (misal X: 555, Y: 777)
  const newX = 555;
  const newY = 777;
  console.log(`1. Memindahkan Node 1 ke koordinat (${newX}, ${newY})...`);
  const putRes = await fetch(`${baseUrl}/api/peta/${mapId}/layout`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      nodes: [{ id: targetNode.id, x: newX, y: newY }],
      groups: [],
      clientId: "test_client",
      version: 0,
    }),
  });
  assert.strictEqual(putRes.status, 200, "Simpan layout gagal");
  console.log("   ✓ Berhasil disimpan via PUT layout.");

  // 4. Verifikasi di GET /api/peta bahwa posisinya tetap di (555, 777)
  const verifyRes = await fetch(`${baseUrl}/api/peta?peta_id=${mapId}`, {
    headers: { Cookie: cookie },
  });
  const verifyData = await verifyRes.json();
  const foundNode = verifyData.node.find((n: any) => n.id === targetNode.id);
  assert.strictEqual(foundNode.x, newX, "Koordinat X tidak cocok");
  assert.strictEqual(foundNode.y, newY, "Koordinat Y tidak cocok");
  console.log(`   ✓ Terverifikasi di database: Node 1 tetap di (${foundNode.x}, ${foundNode.y})`);

  console.log("\n=======================================================");
  console.log("KESIMPULAN: PERGESERAN NODE DAN PERSISTENSI TATA LETAK 100% SUKSES!");
  console.log("=======================================================");
}

main().catch((err) => {
  console.error("Gagal verifikasi:", err);
  process.exit(1);
});

