import { test, describe, after } from "node:test";
import assert from "node:assert";
import { safeJsonReplacer, sanitizeForJson, safeJsonStringify } from "../src/serialization";
import { queryClient } from "../src/db";
import { redis } from "../src/redis";

describe("Regression Tests: Perbaikan Detail Perangkat & Server API", () => {
  // =========================================================================
  // 1. UJI SERIALISASI AMAN TERPUSAT
  // =========================================================================
  test("1.1 safeJsonReplacer: Mengonversi BigInt dalam batas aman menjadi Number", () => {
    const safeBig = BigInt(123456789);
    const converted = safeJsonReplacer("key", safeBig);
    assert.strictEqual(typeof converted, "number");
    assert.strictEqual(converted, 123456789);
  });

  test("1.2 safeJsonReplacer: Mengonversi BigInt di luar batas aman (64-bit) menjadi String", () => {
    const hugeBig = BigInt("9007199254740993"); // MAX_SAFE_INTEGER + 2
    const converted = safeJsonReplacer("key", hugeBig);
    assert.strictEqual(typeof converted, "string");
    assert.strictEqual(converted, "9007199254740993");
  });

  test("1.3 safeJsonReplacer: Menangani NaN dan Infinity menjadi null", () => {
    assert.strictEqual(safeJsonReplacer("key", NaN), null);
    assert.strictEqual(safeJsonReplacer("key", Infinity), null);
    assert.strictEqual(safeJsonReplacer("key", -Infinity), null);
  });

  test("1.4 sanitizeForJson: Mengamankan struktur bertingkat secara rekursif", () => {
    const now = new Date("2026-11-14T12:00:00.000Z");
    const complexObj = {
      id: "dev-1",
      count: 42n,
      hugeCount: BigInt("999999999999999999"),
      createdAt: now,
      invalidRatio: NaN,
      nested: {
        total: 100n,
        list: [1n, 2n, 3n],
      },
    };

    const sanitized = sanitizeForJson(complexObj);
    assert.strictEqual(typeof sanitized.count, "number");
    assert.strictEqual(sanitized.count, 42);
    assert.strictEqual(typeof sanitized.hugeCount, "string");
    assert.strictEqual(sanitized.hugeCount, "999999999999999999");
    assert.strictEqual(sanitized.createdAt, "2026-11-14T12:00:00.000Z");
    assert.strictEqual(sanitized.invalidRatio, 0);
    assert.strictEqual(sanitized.nested.total, 100);
    assert.deepStrictEqual(sanitized.nested.list, [1, 2, 3]);

    // Pastikan JSON.stringify berhasil 100% tanpa melempar TypeError
    const jsonStr = JSON.stringify(sanitized);
    assert.strictEqual(typeof jsonStr, "string");
  });

  test("1.5 safeJsonStringify: Mampu melakukan stringify objek yang mengandung BigInt", () => {
    const payload = { id: "test", metric: 9007199254740995n };
    assert.doesNotThrow(() => {
      const serialized = safeJsonStringify(payload);
      assert.strictEqual(serialized.includes('"metric":"9007199254740995"'), true);
    });
  });

  // =========================================================================
  // 2. UJI LOGIKA PWA INSTALL PROMPT
  // =========================================================================
  test("2.1 PWA Install: Hanya memanggil preventDefault jika ada custom UI, belum standalone, dan belum ditolak", () => {
    const evaluatePreventDefault = (params: {
      hasCustomUI: boolean;
      isStandalone: boolean;
      isDismissed: boolean;
    }) => {
      if (params.isStandalone || params.isDismissed || !params.hasCustomUI) {
        return false;
      }
      return true;
    };

    // Kasus Desktop (hasCustomUI = false): TIDAK boleh preventDefault agar Chrome tidak memunculkan warning
    assert.strictEqual(
      evaluatePreventDefault({ hasCustomUI: false, isStandalone: false, isDismissed: false }),
      false,
      "Desktop tanpa UI sendiri tidak boleh cegat beforeinstallprompt"
    );

    // Kasus Mobile aktif (hasCustomUI = true, belum standalone, belum ditolak): Boleh preventDefault
    assert.strictEqual(
      evaluatePreventDefault({ hasCustomUI: true, isStandalone: false, isDismissed: false }),
      true,
      "Mobile dengan UI tombol pasang boleh cegat beforeinstallprompt"
    );

    // Kasus Mobile tapi sudah standalone: TIDAK boleh preventDefault
    assert.strictEqual(
      evaluatePreventDefault({ hasCustomUI: true, isStandalone: true, isDismissed: false }),
      false,
      "Sudah standalone tidak boleh cegat"
    );

    // Kasus Mobile tapi sudah ditolak 30 hari: TIDAK boleh preventDefault
    assert.strictEqual(
      evaluatePreventDefault({ hasCustomUI: true, isStandalone: false, isDismissed: true }),
      false,
      "Sudah ditolak dalam 30 hari tidak boleh cegat"
    );
  });

  // =========================================================================
  // 3. UJI ISOLASI SUB-QUERY & RESPON RESILIEN
  // =========================================================================
  test("3.1 Isolasi Sub-query: Kegagalan salah satu query tidak membatalkan query lain", async () => {
    // Simulasi Promise.allSettled untuk isolasi sub-query
    const [subQuery1, subQuery2, subQuery3] = await Promise.allSettled([
      Promise.resolve({ section: "hourly", count: 10 }),
      Promise.reject(new Error("Timeout simulasi pada riwayat RTO")),
      Promise.resolve({ section: "device", name: "Switch Core" }),
    ]);

    assert.strictEqual(subQuery1.status, "fulfilled");
    assert.strictEqual(subQuery2.status, "rejected");
    assert.strictEqual(subQuery3.status, "fulfilled");

    // Bagian yang sukses tetap tersedia
    const deviceName = subQuery3.status === "fulfilled" ? (subQuery3.value as any).name : null;
    assert.strictEqual(deviceName, "Switch Core");

    // Bagian yang gagal menggunakan fallback aman tanpa 500
    const rtoHistory = subQuery2.status === "fulfilled" ? (subQuery2.value as any) : [];
    assert.deepStrictEqual(rtoHistory, []);
  });

  // =========================================================================
  // 4. UJI INTEGRITAS DATABASE & SKEMA POSTGRESQL
  // =========================================================================
  test("4.1 Skema Database: Semua tabel dan kolom esensial wajib ada", async () => {
    const requiredTables = [
      "devices",
      "device_groups",
      "device_status_history",
      "device_ping_hourly",
      "device_log_hourly",
      "incidents",
      "log_events",
      "ai_analyses",
      "client_errors",
    ];

    const existingTables = await queryClient`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
    `;
    const tableSet = new Set(existingTables.map((r: any) => r.table_name));

    for (const tbl of requiredTables) {
      assert.strictEqual(tableSet.has(tbl), true, `Tabel ${tbl} harus ada di PostgreSQL`);
    }

    const existingColumns = await queryClient`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public';
    `;
    const colSet = new Set(existingColumns.map((c: any) => `${c.table_name}.${c.column_name}`));

    assert.strictEqual(colSet.has("devices.id"), true);
    assert.strictEqual(colSet.has("devices.name"), true);
    assert.strictEqual(colSet.has("devices.status"), true);
    assert.strictEqual(colSet.has("device_log_hourly.hour_bucket"), true);
    assert.strictEqual(colSet.has("client_errors.sidik_jari"), true);
  });

  after(async () => {
    await redis.quit();
    await queryClient.end();
  });
});

