import assert from "node:assert";

const BASE_URL = "http://localhost:3000";

async function runE2EDevicesTest() {
  console.log("=== Memulai Pengujian Integrasi E2E Fase 3: Manajemen Perangkat ===");

  // 1. Login sebagai Admin
  console.log("\n1. Melakukan login sebagai Admin...");
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.strictEqual(loginRes.status, 200, "Admin login harus berhasil HTTP 200");
  const sessionCookie = loginRes.headers.get("set-cookie")?.split(";")[0] || "";
  assert.ok(sessionCookie.includes("jagalog_session="), "Cookie sesi harus ada");
  console.log("✓ Login Admin berhasil.");

  const randomSuffix = Math.floor(Math.random() * 9000 + 1000);
  const ipMikrotik = `192.168.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;
  const ipLinux = `10.10.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`;

  let mikrotikId = "";
  let windowsId = "";
  let linuxId = "";

  // 2. Tambah 3 perangkat: MikroTik, Windows, Linux
  console.log("\n2. Menambahkan 3 perangkat contoh (MikroTik, Windows, Linux)...");

  // A. MikroTik
  const addMikrotikRes = await fetch(`${BASE_URL}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      name: `MikroTik-Router-${randomSuffix}`,
      type: "mikrotik",
      ipAddress: ipMikrotik,
      location: "Kantor Pusat Lt. 1",
      notes: "Router utama gateway internet",
    }),
  });
  assert.strictEqual(addMikrotikRes.status, 201, "Tambah MikroTik harus 201 Created");
  const mikrotikData = await addMikrotikRes.json();
  assert.ok(mikrotikData.device?.id);
  assert.ok(mikrotikData.ingestToken, "Harus mengembalikan ingest token sekali tampil");
  assert.strictEqual(mikrotikData.ingestToken.length, 64, "Token harus 64 hex karakter (32 bytes)");
  mikrotikId = mikrotikData.device.id;
  console.log(`✓ MikroTik '${mikrotikData.device.name}' berhasil dibuat dengan ID: ${mikrotikId}`);

  // B. Windows
  const addWindowsRes = await fetch(`${BASE_URL}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      name: `Win-Server-AD-${randomSuffix}`,
      type: "windows",
      ipAddress: null,
      location: "Data Center Virtual",
      notes: "Active Directory Domain Controller",
    }),
  });
  assert.strictEqual(addWindowsRes.status, 201, "Tambah Windows harus 201 Created");
  const windowsData = await addWindowsRes.json();
  windowsId = windowsData.device.id;
  console.log(`✓ Windows '${windowsData.device.name}' berhasil dibuat dengan ID: ${windowsId}`);

  // C. Linux
  const addLinuxRes = await fetch(`${BASE_URL}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      name: `Linux-Web-Prod-${randomSuffix}`,
      type: "linux",
      ipAddress: ipLinux,
      location: "Cloud DMZ",
      notes: "Nginx reverse proxy & app server",
    }),
  });
  assert.strictEqual(addLinuxRes.status, 201, "Tambah Linux harus 201 Created");
  const linuxData = await addLinuxRes.json();
  linuxId = linuxData.device.id;
  console.log(`✓ Linux '${linuxData.device.name}' berhasil dibuat dengan ID: ${linuxId}`);

  // 3. Uji validasi duplikasi IP
  console.log("\n3. Menguji pencegahan duplikasi alamat IP...");
  const duplicateIpRes = await fetch(`${BASE_URL}/api/devices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      name: `Duplikat-Router-${randomSuffix}`,
      type: "mikrotik",
      ipAddress: ipMikrotik, // IP yang sama persis
    }),
  });
  assert.strictEqual(duplicateIpRes.status, 409, "Duplikasi IP harus mengembalikan HTTP 409 Conflict");
  const duplicateIpData = await duplicateIpRes.json();
  assert.ok(duplicateIpData.error.includes("sudah digunakan"), "Pesan harus menerangkan IP sudah digunakan");
  console.log("✓ Berhasil: Duplikasi IP dicegah dengan HTTP 409 Conflict.");

  // 4. Ambil daftar perangkat via GET /api/devices
  console.log("\n4. Mengambil daftar perangkat (GET /api/devices)...");
  const listRes = await fetch(`${BASE_URL}/api/devices`, {
    headers: { Cookie: sessionCookie },
  });
  assert.strictEqual(listRes.status, 200);
  const listData = await listRes.json();
  assert.ok(Array.isArray(listData.devices));
  const foundMikrotik = listData.devices.find((d: any) => d.id === mikrotikId);
  const foundWindows = listData.devices.find((d: any) => d.id === windowsId);
  const foundLinux = listData.devices.find((d: any) => d.id === linuxId);
  assert.ok(foundMikrotik && foundWindows && foundLinux, "Ketiga perangkat harus ada di daftar");
  console.log(`✓ Berhasil: Daftar perangkat memuat ${listData.devices.length} perangkat.`);

  // 5. Ubah (PATCH) salah satu perangkat (Linux)
  console.log("\n5. Mengubah (update) perangkat Linux...");
  const updateRes = await fetch(`${BASE_URL}/api/devices/${linuxId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      name: `Linux-Web-Prod-${randomSuffix}-Updated`,
      location: "Cloud DMZ Singapore",
    }),
  });
  assert.strictEqual(updateRes.status, 200);
  const updateData = await updateRes.json();
  assert.strictEqual(updateData.device.name, `Linux-Web-Prod-${randomSuffix}-Updated`);
  assert.strictEqual(updateData.device.location, "Cloud DMZ Singapore");
  console.log("✓ Berhasil: Perangkat Linux berhasil diperbarui.");

  // 6. Nonaktifkan (PATCH) perangkat MikroTik
  console.log("\n6. Menonaktifkan perangkat MikroTik...");
  const deactivateRes = await fetch(`${BASE_URL}/api/devices/${mikrotikId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({ isActive: false }),
  });
  assert.strictEqual(deactivateRes.status, 200);
  const deactivateData = await deactivateRes.json();
  assert.strictEqual(deactivateData.device.isActive, false);
  console.log("✓ Berhasil: Perangkat MikroTik dinonaktifkan (isActive: false).");

  // 7. Regenerate Ingest Token untuk perangkat Windows
  console.log("\n7. Membuat ulang (regenerate) token ingest untuk perangkat Windows...");
  const regenTokenRes = await fetch(`${BASE_URL}/api/devices/${windowsId}/token`, {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
  assert.strictEqual(regenTokenRes.status, 200);
  const regenTokenData = await regenTokenRes.json();
  assert.ok(regenTokenData.ingestToken);
  assert.strictEqual(regenTokenData.ingestToken.length, 64);
  console.log("✓ Berhasil: Token ingest baru 64 karakter hex diterima.");

  // 8. Cek Detail Perangkat via GET /api/devices/[id]
  console.log("\n8. Mengambil data detail perangkat...");
  const detailRes = await fetch(`${BASE_URL}/api/devices/${mikrotikId}`, {
    headers: { Cookie: sessionCookie },
  });
  assert.strictEqual(detailRes.status, 200);
  const detailData = await detailRes.json();
  assert.strictEqual(detailData.device.id, mikrotikId);
  assert.strictEqual(detailData.device.isActive, false);
  assert.ok(detailData.serverConfig?.syslogUdpPort);
  console.log("✓ Berhasil: Detail perangkat dan konfigurasi server diterima.");

  console.log("\n=== SELURUH PENGUJIAN INTEGRASI FASE 3 LULUS 100% ===");
}

runE2EDevicesTest().catch((err) => {
  console.error("E2E Devices Test Failed:", err);
  process.exit(1);
});
