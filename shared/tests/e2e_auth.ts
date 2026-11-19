import assert from "node:assert";

const BASE_URL = "http://localhost:3000";

async function runE2ETests() {
  console.log("=== Memulai Pengujian Integrasi E2E Fase 2 ===");

  // 1. Cek proteksi halaman terlindung tanpa cookie
  console.log("\n1. Menguji proteksi halaman root tanpa login...");
  const unauthPageRes = await fetch(`${BASE_URL}/`, { redirect: "manual" });
  assert.ok(
    [307, 302].includes(unauthPageRes.status),
    `Halaman terlindung harus me-redirect ke login, status: ${unauthPageRes.status}`
  );
  const location = unauthPageRes.headers.get("location");
  assert.ok(location?.includes("/login"), `Redirect URL harus mengarah ke /login: ${location}`);
  console.log("✓ Berhasil: Halaman terlindung me-redirect ke /login dengan status", unauthPageRes.status);

  // 2. Cek proteksi API terlindung tanpa cookie
  console.log("\n2. Menguji proteksi API /api/users tanpa login...");
  const unauthApiRes = await fetch(`${BASE_URL}/api/users`);
  assert.strictEqual(unauthApiRes.status, 401, "API terlindung harus mengembalikan 401 Unauthorized");
  console.log("✓ Berhasil: API /api/users mengembalikan 401 Unauthorized.");

  // 3. Uji Rate Limiting: 5 kali salah, ke-6 diblokir HTTP 429
  console.log("\n3. Menguji Rate Limiting login (5x salah, ke-6 HTTP 429)...");
  const bruteUser = "attacker_" + Date.now();
  for (let i = 1; i <= 5; i++) {
    const failRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: bruteUser, password: "WrongPassword123!" }),
    });
    assert.strictEqual(failRes.status, 401, `Percobaan salah ke-${i} harus 401`);
    const failData = await failRes.json();
    assert.ok(failData.error, "Harus mengembalikan pesan error");
  }

  // Percobaan ke-6 harus 429
  const blockedRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: bruteUser, password: "WrongPassword123!" }),
  });
  assert.strictEqual(blockedRes.status, 429, "Percobaan ke-6 harus diblokir dengan HTTP 429 Too Many Requests");
  const blockedData = await blockedRes.json();
  assert.ok(blockedData.error.includes("dibatasi sementara"), "Pesan harus menyatakan akun dibatasi sementara");
  console.log("✓ Berhasil: Percobaan login ke-6 berhasil diblokir dengan HTTP 429.");

  // 4. Login dengan akun Admin yang valid
  console.log("\n4. Menguji login dengan akun admin valid...");
  const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
  });
  assert.strictEqual(adminRes.status, 200, "Admin login harus berhasil HTTP 200");
  const adminData = await adminRes.json();
  assert.strictEqual(adminData.success, true);
  assert.strictEqual(adminData.user.role, "admin");

  // Ambil cookie sesi dari respons
  const rawCookies = adminRes.headers.get("set-cookie");
  assert.ok(rawCookies && rawCookies.includes("jagalog_session="), "Harus menyetel cookie jagalog_session");
  const sessionCookie = rawCookies.split(";")[0];
  console.log("✓ Berhasil: Login admin sukses, cookie sesi diterima.");

  // 5. Admin mengakses daftar pengguna via API
  console.log("\n5. Menguji Admin mengakses /api/users...");
  const userListRes = await fetch(`${BASE_URL}/api/users`, {
    headers: { Cookie: sessionCookie },
  });
  assert.strictEqual(userListRes.status, 200, "Admin harus bisa mengakses /api/users");
  const userListData = await userListRes.json();
  assert.ok(Array.isArray(userListData.users), "Harus mengembalikan array users");
  console.log(`✓ Berhasil: Admin dapat mengakses daftar pengguna (${userListData.users.length} pengguna).`);

  // 6. Admin membuat akun baru dengan role Viewer
  console.log("\n6. Menguji Admin membuat akun baru role 'viewer'...");
  const viewerUsername = "operator_" + Math.floor(Math.random() * 10000);
  const createUserRes = await fetch(`${BASE_URL}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: sessionCookie,
    },
    body: JSON.stringify({
      username: viewerUsername,
      password: "OperatorPassword123!",
      role: "viewer",
    }),
  });
  assert.strictEqual(createUserRes.status, 201, "Pembuatan user harus 201 Created");
  const createUserData = await createUserRes.json();
  assert.strictEqual(createUserData.user.role, "viewer");
  console.log(`✓ Berhasil: User '${viewerUsername}' dengan role 'viewer' berhasil dibuat.`);

  // 7. Login sebagai Viewer dan coba akses endpoint Admin
  console.log("\n7. Menguji hak akses Viewer mencoba mengakses /api/users...");
  const viewerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: viewerUsername, password: "OperatorPassword123!" }),
  });
  assert.strictEqual(viewerLoginRes.status, 200);
  const viewerCookie = viewerLoginRes.headers.get("set-cookie")?.split(";")[0] || "";

  // Viewer coba panggil /api/users
  const forbiddenRes = await fetch(`${BASE_URL}/api/users`, {
    headers: { Cookie: viewerCookie },
  });
  assert.strictEqual(forbiddenRes.status, 403, "Viewer harus dilarang (403 Forbidden) mengakses endpoint manajemen user");
  console.log("✓ Berhasil: Role Viewer ditolak dengan HTTP 403 Forbidden saat membuka menu manajemen admin.");

  // 8. Logout
  console.log("\n8. Menguji aksi Logout...");
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: sessionCookie },
  });
  assert.strictEqual(logoutRes.status, 200);
  const logoutCookie = logoutRes.headers.get("set-cookie");
  assert.ok(logoutCookie?.includes("Max-Age=0"), "Cookie harus dikosongkan");
  console.log("✓ Berhasil: Logout membersihkan sesi dan menghapus cookie.");

  console.log("\n=== SELURUH PENGUJIAN INTEGRASI FASE 2 LULUS 100% ===");
}

runE2ETests().catch((err) => {
  console.error("E2E Test Failed:", err);
  process.exit(1);
});
