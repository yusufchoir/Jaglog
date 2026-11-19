import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { db, queryClient } from "../src/db";
import { devices, users } from "../src/schema";
import { eq } from "drizzle-orm";
import { redis } from "../src/redis";
import { hash } from "../src/auth";

const BASE_URL = "http://localhost:3000";

describe("TAHAP 3 - Verifikasi Tombol Perangkat & Mutasi Aksi", () => {
  let adminCookie = "";
  let viewerCookie = "";
  let testDeviceId = "";
  let initialToken = "";

  before(async () => {
    // 1. Buat / pastikan user viewer untuk pengujian otorisasi
    const viewerPassword = "ViewerPassword123!";
    const [existingViewer] = await db
      .select()
      .from(users)
      .where(eq(users.username, "test_viewer_verify"))
      .limit(1);

    if (!existingViewer) {
      const pHash = await hash(viewerPassword);
      await db.insert(users).values({
        username: "test_viewer_verify",
        passwordHash: pHash,
        role: "viewer",
        isActive: true,
      });
    }

    // 2. Login sebagai Admin
    const adminLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "JagaLogAdmin123!" }),
    });
    assert.strictEqual(adminLoginRes.status, 200, "Admin login harus 200");
    adminCookie = (adminLoginRes.headers.get("set-cookie") || "").split(";")[0];

    // 3. Login sebagai Viewer
    const viewerLoginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "test_viewer_verify", password: viewerPassword }),
    });
    assert.strictEqual(viewerLoginRes.status, 200, "Viewer login harus 200");
    viewerCookie = (viewerLoginRes.headers.get("set-cookie") || "").split(";")[0];

    // 4. Buat perangkat uji untuk verifikasi tombol
    const createDeviceRes = await fetch(`${BASE_URL}/api/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({
        name: `Device-Verify-${Date.now()}`,
        type: "linux",
        ipAddress: `10.222.${Math.floor(Math.random() * 200) + 1}.1`,
        location: "Data Center Verifikasi",
        notes: "Uji verifikasi tombol",
        offlineAfterMinutes: 10,
        pingEnabled: false,
      }),
    });
    const createData = await createDeviceRes.json();
    assert.strictEqual(createDeviceRes.status, 201, "Perangkat uji harus berhasil dibuat");
    testDeviceId = createData.device.id;
    initialToken = createData.ingestToken;
  });

  after(async () => {
    try {
      if (testDeviceId) {
        await fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
          method: "DELETE",
          headers: { Cookie: adminCookie },
        });
      }
    } finally {
      await redis.quit();
      await queryClient.end();
    }
  });

  it("1. Klik Nonaktifkan: respon server < 300 ms dan hanya 1 request mutasi", async () => {
    const startTime = Date.now();
    const res = await fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ isActive: false }),
    });
    const elapsedMs = Date.now() - startTime;
    const data = await res.json();

    assert.strictEqual(res.status, 200, "Mutasi harus 200 OK");
    assert.strictEqual(data.device.isActive, false, "Status harus menjadi nonaktif");
    assert.ok(elapsedMs < 300, `Respon server harus < 300 ms (aktual: ${elapsedMs} ms)`);

    // Pastikan cache device stats di Redis diinvalidasi
    const cachedStats = await redis.get(`cache:device:stats:${testDeviceId}`);
    assert.strictEqual(cachedStats, null, "Cache Redis stats harus sudah dihapus");
  });

  it("2. Klik Aktifkan kembali: respon server < 300 ms", async () => {
    const startTime = Date.now();
    const res = await fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
      },
      body: JSON.stringify({ isActive: true }),
    });
    const elapsedMs = Date.now() - startTime;
    const data = await res.json();

    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.device.isActive, true, "Status harus kembali aktif");
    assert.ok(elapsedMs < 300, `Respon server harus < 300 ms (aktual: ${elapsedMs} ms)`);
  });

  it("3. Buat ulang token: token lama ditolak, token baru diterima oleh /api/ingest", async () => {
    // A. Uji ingest dengan token awal (harus diterima: 200/202)
    const ingestOldRes = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${initialToken}`,
      },
      body: JSON.stringify([
        {
          message: "Test log before token regeneration",
          category: "system",
          severity: 6,
        },
      ]),
    });
    assert.ok([200, 202].includes(ingestOldRes.status), `Token awal harus diterima (aktual: ${ingestOldRes.status})`);

    // B. Buat ulang token via API
    const regenStartTime = Date.now();
    const regenRes = await fetch(`${BASE_URL}/api/devices/${testDeviceId}/token`, {
      method: "POST",
      headers: { Cookie: adminCookie },
    });
    const regenElapsedMs = Date.now() - regenStartTime;
    const regenData = await regenRes.json();

    assert.strictEqual(regenRes.status, 200, "Regenerasi token harus 200 OK");
    assert.ok(regenData.ingestToken, "Harus mengembalikan token baru mentah");
    assert.notStrictEqual(regenData.ingestToken, initialToken, "Token baru harus berbeda dari token lama");

    // C. Uji ingest dengan token LAMA -> HARUS DITOLAK (401)
    const ingestOldAfterRegen = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${initialToken}`,
      },
      body: JSON.stringify([{ message: "Old token attempt" }]),
    });
    assert.strictEqual(ingestOldAfterRegen.status, 401, "Token lama harus langsung ditolak (401)");

    // D. Uji ingest dengan token BARU -> HARUS DITERIMA (200/202)
    const ingestNewRes = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${regenData.ingestToken}`,
      },
      body: JSON.stringify([
        {
          message: "Test log with regenerated token",
          category: "system",
          severity: 6,
        },
      ]),
    });
    assert.ok([200, 202].includes(ingestNewRes.status), `Token baru harus langsung diterima (aktual: ${ingestNewRes.status})`);
  });

  it("4. Viewer (bukan admin) mencoba kedua aksi: ditolak 403 Forbidden dengan pesan jelas", async () => {
    // A. Viewer mencoba toggle status
    const viewerToggleRes = await fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: viewerCookie,
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.strictEqual(viewerToggleRes.status, 403, "Viewer toggle harus 403");
    const toggleErr = await viewerToggleRes.json();
    assert.match(toggleErr.error, /Hanya peran Admin/i, "Pesan error harus eksplisit hak akses");

    // B. Viewer mencoba buat ulang token
    const viewerTokenRes = await fetch(`${BASE_URL}/api/devices/${testDeviceId}/token`, {
      method: "POST",
      headers: { Cookie: viewerCookie },
    });
    assert.strictEqual(viewerTokenRes.status, 403, "Viewer regenerate token harus 403");
    const tokenErr = await viewerTokenRes.json();
    assert.match(tokenErr.error, /Hanya peran Admin/i, "Pesan error harus eksplisit hak akses");
  });

  it("5. Sesi habis: ditolak 401 Unauthorized", async () => {
    const expiredRes = await fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: "jagalog_session=invalid_or_expired_token",
      },
      body: JSON.stringify({ isActive: false }),
    });
    assert.strictEqual(expiredRes.status, 401, "Sesi tidak valid harus 401");
    const expiredData = await expiredRes.json();
    assert.match(expiredData.error, /Sesi tidak/i);
  });

  it("6. Klik cepat 5 kali berturut-turut: konsistensi state terjamin", async () => {
    // Eksekusi 5 request simultan
    const promises = Array.from({ length: 5 }).map(() =>
      fetch(`${BASE_URL}/api/devices/${testDeviceId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: adminCookie,
        },
        body: JSON.stringify({ isActive: true }),
      })
    );

    const responses = await Promise.all(promises);
    for (const r of responses) {
      assert.strictEqual(r.status, 200, "Seluruh request harus diproses dengan aman");
    }

    // Verifikasi database akhir tetap konsisten
    const [finalDevice] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, testDeviceId));
    assert.strictEqual(finalDevice.isActive, true, "State akhir perangkat harus konsisten aktif");
  });
});
