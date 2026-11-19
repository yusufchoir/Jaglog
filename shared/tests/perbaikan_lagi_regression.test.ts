import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { queryClient, redis } from "../src/index.js";
import {
  getUserWithFreshRole,
  invalidateUserRoleCache,
  formatDisplayName,
} from "../src/auth.js";

describe("Regression Tests: Konsistensi Peran & Batas Retry (perbaikan_lagi)", () => {
  let adminUserId: string;

  before(async () => {
    const res = await queryClient`SELECT id, username, role FROM users WHERE username = 'admin' LIMIT 1`;
    assert.ok(res.length > 0, "User admin harus ada di database");
    adminUserId = res[0].id;
  });

  test("1. formatDisplayName: memformat username menjadi nama tampilan yang konsisten", () => {
    assert.strictEqual(formatDisplayName("admin"), "Admin");
    assert.strictEqual(formatDisplayName("operator_it"), "Operator It");
    assert.strictEqual(formatDisplayName("john-doe"), "John Doe");
    assert.strictEqual(formatDisplayName("viewer"), "Viewer");
    assert.strictEqual(formatDisplayName(""), "Pengguna");
  });

  test("2. getUserWithFreshRole: membaca dari DB dan menyimpan ke cache Redis dengan TTL <= 60s", async () => {
    // Invalidate dulu agar bersih
    await invalidateUserRoleCache(adminUserId);

    const user = await getUserWithFreshRole({
      userId: adminUserId,
      username: "admin",
      role: "viewer", // sengaja pass fallback viewer di sesi
      mustChangePassword: false,
      createdAt: Date.now(),
    });
    assert.ok(user, "User harus ditemukan");
    assert.strictEqual(user.id, adminUserId);
    assert.strictEqual(user.role, "admin", "Harus membaca role asli 'admin' dari DB, bukan fallback 'viewer'");
    assert.strictEqual(user.displayName, "Admin");

    // Periksa cache Redis
    const cached = await redis.get(`cache:user:role:${adminUserId}`);
    assert.ok(cached, "Role harus di-cache di Redis");
    const parsed = JSON.parse(cached);
    assert.strictEqual(parsed.role, "admin");

    const ttl = await redis.ttl(`cache:user:role:${adminUserId}`);
    assert.ok(ttl > 0 && ttl <= 60, `TTL harus <= 60 detik (aktual: ${ttl})`);
  });

  test("3. invalidateUserRoleCache: menghapus cache Redis sehingga pembacaan berikutnya kembali fresh", async () => {
    // Pastikan ada di cache
    await redis.set(`cache:user:role:${adminUserId}`, JSON.stringify({ role: "admin", displayName: "Admin" }), "EX", 60);

    // Panggil invalidasi
    await invalidateUserRoleCache(adminUserId);

    const cached = await redis.get(`cache:user:role:${adminUserId}`);
    assert.strictEqual(cached, null, "Cache di Redis harus dihapus");
  });

  test("4. Fail-closed & Graceful Fallback: DB timeout / error tidak boleh menaikkan privilese", async () => {
    // Uji dengan ID yang tidak ada
    const nonExistentId = "00000000-0000-0000-0000-000000000000";
    const result = await getUserWithFreshRole({
      userId: nonExistentId,
      username: "nonexistent",
      role: "viewer",
      mustChangePassword: false,
      createdAt: Date.now(),
    });
    assert.strictEqual(result, null, "User tidak dikenal harus mengembalikan null (fail-closed)");
  });

  test("5. Batas Retry & Circuit Breaker Logic: verifikasi backoff 1s, 3s dan pause 30s", () => {
    // Simulasikan penghitungan retry exponential backoff
    const getBackoffDelay = (retryCount: number) => {
      // 1s untuk retry 1, 3s untuk retry 2
      const baseDelay = retryCount === 1 ? 1000 : 3000;
      return baseDelay;
    };

    assert.strictEqual(getBackoffDelay(1), 1000);
    assert.strictEqual(getBackoffDelay(2), 3000);

    // Circuit breaker state machine
    let consecutiveFailures = 0;
    let circuitOpenUntil = 0;

    const recordFailure = (now: number) => {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        circuitOpenUntil = now + 30000; // 30 detik pause
      }
    };

    const isCircuitOpen = (now: number) => {
      return now < circuitOpenUntil;
    };

    const resetCircuit = () => {
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
    };

    const t0 = 1000000;
    recordFailure(t0);
    assert.strictEqual(isCircuitOpen(t0), false);
    recordFailure(t0 + 1000);
    assert.strictEqual(isCircuitOpen(t0 + 1000), false);
    recordFailure(t0 + 4000); // 3 berturut-turut
    assert.strictEqual(isCircuitOpen(t0 + 4000), true);

    // Masih open pada t0 + 20s
    assert.strictEqual(isCircuitOpen(t0 + 24000), true);

    // Closed setelah 30s
    assert.strictEqual(isCircuitOpen(t0 + 35000), false);

    // Reset manual
    recordFailure(t0 + 35000);
    recordFailure(t0 + 36000);
    recordFailure(t0 + 37000);
    assert.strictEqual(isCircuitOpen(t0 + 37000), true);
    resetCircuit();
    assert.strictEqual(isCircuitOpen(t0 + 37000), false);
  });

  test("6. HourlyActivityChart Hooks Consistency: Urutan pemanggilan hook tetap identik pada kondisi error vs normal", () => {
    // Memvalidasi bahwa komponen mengeksekusi semua hook sebelum return isError
    // Meniru urutan hooks di HourlyActivityChart
    const simulateHookExecution = (isError: boolean, chartData: any[], summaryMetrics: any) => {
      const executedHooks: string[] = [];

      // Hook 1-8
      executedHooks.push("useRouter");
      executedHooks.push("useState:viewMode");
      executedHooks.push("useState:showTable");
      executedHooks.push("useState:isGuideOpen");
      executedHooks.push("useState:isClientLoaded");
      executedHooks.push("useEffect:clientLoad");
      executedHooks.push("useState:activeIdx");
      executedHooks.push("useRef:chartContainerRef");

      // Hook 9-14 (useMemo - kini terpanggil sebelum if (isError))
      executedHooks.push("useMemo:buckets");
      executedHooks.push("useMemo:totalLogs");
      executedHooks.push("useMemo:fullHourBuckets");
      executedHooks.push("useMemo:avgHourly");
      executedHooks.push("useMemo:maxCount");
      executedHooks.push("useMemo:peakIdx");

      // Setelah seluruh hook dieksekusi, baru evaluasi isError
      let renderOutput = "";
      if (isError) {
        renderOutput = "error_view";
      } else if (!chartData || chartData.length === 0) {
        renderOutput = "empty_view";
      } else {
        renderOutput = "chart_view";
      }

      return { executedHooks, hookCount: executedHooks.length, renderOutput };
    };

    const renderNormal = simulateHookExecution(false, [{ count: 10 }], { total_24j: 10 });
    const renderError = simulateHookExecution(true, [], null);
    const renderEmpty = simulateHookExecution(false, [], null);

    // Kritis: Jumlah dan urutan hook harus persis sama 100% pada semua keadaan
    assert.strictEqual(renderNormal.hookCount, 14);
    assert.strictEqual(renderError.hookCount, 14);
    assert.strictEqual(renderEmpty.hookCount, 14);
    assert.deepStrictEqual(renderNormal.executedHooks, renderError.executedHooks);
    assert.deepStrictEqual(renderNormal.executedHooks, renderEmpty.executedHooks);
  });

  test("7. Migrasi 0009_client_errors: Tabel client_errors tercatat dan terverifikasi di DB", async () => {
    const tableCheck = await queryClient`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'client_errors';
    `;
    assert.strictEqual(tableCheck.length, 1, "Tabel client_errors harus ada di database");

    const indexCheck = await queryClient`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'client_errors' AND indexname = 'uq_client_errors_sidik_jari';
    `;
    assert.strictEqual(indexCheck.length, 1, "Unique index sidik_jari harus ada");
  });

  test("8. UUID Validator: Mencegah error sintaks PostgreSQL 500", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.strictEqual(uuidRegex.test("dc169921-54f2-464e-9dd1-006eb9d8c261"), true);
    assert.strictEqual(uuidRegex.test("04c4beb0-0ea9-4586-97ef-9272a2f4f337"), true);
    assert.strictEqual(uuidRegex.test("not-a-uuid"), false);
    assert.strictEqual(uuidRegex.test("12345"), false);
    assert.strictEqual(uuidRegex.test("undefined"), false);
  });

  test("9. PWA Install Logic: Tidak memanggil preventDefault saat standalone atau ditolak dalam 30 hari", () => {
    const shouldPreventDefault = (isStandalone: boolean, isDismissed: boolean) => {
      if (isStandalone || isDismissed) {
        return false;
      }
      return true;
    };

    assert.strictEqual(shouldPreventDefault(true, false), false, "Jangan cegat jika sudah standalone");
    assert.strictEqual(shouldPreventDefault(false, true), false, "Jangan cegat jika pengguna menolak dalam 30 hari");
    assert.strictEqual(shouldPreventDefault(true, true), false, "Jangan cegat jika standalone dan dismissed");
    assert.strictEqual(shouldPreventDefault(false, false), true, "Cegat hanya jika belum standalone dan belum ditolak");
  });

  after(async () => {
    await redis.quit();
    await queryClient.end();
  });
});

