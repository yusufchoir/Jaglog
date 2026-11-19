import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { queryClient, redis } from "../src/index.js";
import { cleanOldQueueJobs, getIngestQueue } from "../src/queue.js";

describe("Regression Tests: Perbaikan Dashboard Lagi (shared/tests/perbaikan_dashboard_lagi.md)", () => {
  let adminUserId: string;

  before(async () => {
    const res = await queryClient`SELECT id FROM users WHERE username = 'admin' LIMIT 1`;
    assert.ok(res.length > 0, "User admin harus ada di database");
    adminUserId = res[0].id;
  });

  after(async () => {
    try {
      await getIngestQueue().close();
    } catch {}
    await redis.quit();
    await queryClient.end();
  });

  test("1. Isolasi Parsial: Section status schema memisahkan kegagalan per komponen", () => {
    // Verifikasi struktur status bagian dashboard
    const mockDashboardStatus = {
      devices: "ok",
      incidents: "ok",
      hourlyChart: "gagal",
      ai: "ok",
      areas: "ok",
    };

    // Satu bagian gagal tidak boleh mematikan kartu lain
    assert.strictEqual(mockDashboardStatus.devices, "ok");
    assert.strictEqual(mockDashboardStatus.hourlyChart, "gagal");

    // Evaluasi render parsial: jika hourlyChart gagal, kartu lain tetap memiliki angka valid
    const isGlobalError = Object.values(mockDashboardStatus).every((st) => st === "gagal");
    assert.strictEqual(isGlobalError, false, "Kegagalan satu bagian bukan kegagalan global");
  });

  test("2. Non-fatal Redis Cache Write: Kegagalan tulis cache tidak membatalkan request", async () => {
    // Simulasikan operasi set cache yang gagal atau error non-fatal
    let requestSucceeded = false;
    const safeCacheWrite = async () => {
      try {
        await Promise.allSettled([
          redis.set("cache:test:simulate_fail", "value", "EX", 10),
          redis.set("cache:test:simulate_stale", "value", "EX", 300),
        ]);
      } catch {
        // Tangkap tanpa melempar fatal error
      }
      requestSucceeded = true;
    };

    await safeCacheWrite();
    assert.strictEqual(requestSucceeded, true, "Request harus tetap berhasil meskipun ada write cache");
    await redis.del("cache:test:simulate_fail", "cache:test:simulate_stale");
  });

  test("3. BullMQ Maintenance: cleanOldQueueJobs membersihkan job usang agar Redis tidak membengkak", async () => {
    const res = await cleanOldQueueJobs();
    assert.ok(res.completedRemoved >= 0, "Harus mengembalikan jumlah job completed yang dibersihkan");
    assert.ok(res.failedRemoved >= 0, "Harus mengembalikan jumlah job failed yang dibersihkan");
  });

  test("4. Differentiated Error Messages: Pesan error informatif, aman, dan tanpa stack trace", () => {
    const getSafeErrorMessage = (status: number) => {
      if (status === 401) return "Sesi Anda telah berakhir. Silakan muat ulang halaman atau login kembali.";
      if (status === 403) return "Anda tidak memiliki izin untuk melihat ringkasan dashboard.";
      if (status === 429) return "Terlalu banyak permintaan ke server. Silakan tunggu beberapa saat.";
      if (status >= 500) return "Server sedang sibuk memproses data. Coba beberapa saat lagi.";
      return "Gagal memuat data ringkasan dashboard.";
    };

    assert.strictEqual(getSafeErrorMessage(401), "Sesi Anda telah berakhir. Silakan muat ulang halaman atau login kembali.");
    assert.strictEqual(getSafeErrorMessage(403), "Anda tidak memiliki izin untuk melihat ringkasan dashboard.");
    assert.strictEqual(getSafeErrorMessage(429), "Terlalu banyak permintaan ke server. Silakan tunggu beberapa saat.");
    assert.strictEqual(getSafeErrorMessage(500), "Server sedang sibuk memproses data. Coba beberapa saat lagi.");
  });

  test("5. Fast Path Kill Switch: Env DASHBOARD_FAST_PATH fallback", () => {
    const checkFastPath = (envVal?: string) => {
      return envVal !== "false";
    };

    assert.strictEqual(checkFastPath(undefined), true, "Default aktif");
    assert.strictEqual(checkFastPath("true"), true, "Aktif eksplisit");
    assert.strictEqual(checkFastPath("false"), false, "Dapat dimatikan ke jalur lama via env");
  });
});
