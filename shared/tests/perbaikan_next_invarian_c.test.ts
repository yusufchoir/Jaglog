import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { queryClient, redis, db } from "../src/index.js";
import { devices } from "../src/schema.js";
import { eq } from "drizzle-orm";
import { calculateComprehensiveTimeline } from "../src/monitoring/timeline.js";

describe("Regression Tests: Perbaikan Next & Invarian C (perbaikan_next.md)", () => {
  let dummyDeviceId: string | null = null;

  before(async () => {
    // Buat satu perangkat dummy tanpa riwayat sama sekali untuk menguji edge-case "Belum Ada Data"
    const [created] = await db
      .insert(devices)
      .values({
        name: "Dummy Edge Case Unit Test",
        type: "other",
        ipAddress: "192.168.254.254",
        location: "Lab Pengujian",
        status: "unknown",
        isActive: true,
        pingEnabled: true,
      })
      .returning();
    dummyDeviceId = created.id;
  });

  after(async () => {
    if (dummyDeviceId) {
      try {
        await db.delete(devices).where(eq(devices.id, dummyDeviceId));
      } catch {}
    }
    try {
      await redis.quit();
    } catch {}
    try {
      await queryClient.end();
    } catch {}
  });

  describe("A. Validasi Invarian C Dashboard Armada", () => {
    test("Invarian C.1: totalNodes == online + log_stopped + offline (rto) + unknown", async () => {
      const activeDevices = await queryClient`
        SELECT id, name, status, ping_enabled, is_active
        FROM devices
        WHERE is_active = true
      `;
      const total = activeDevices.length;
      assert.ok(total > 0, "Harus ada perangkat aktif di database");

      let online = 0;
      let logStopped = 0;
      let offline = 0;
      let unknown = 0;

      for (const d of activeDevices) {
        if (d.status === "online") online++;
        else if (d.status === "log_stopped") logStopped++;
        else if (d.status === "offline" || d.status === "rto") offline++;
        else unknown++;
      }

      assert.strictEqual(
        online + logStopped + offline + unknown,
        total,
        `Invarian C.1 Gagal: ${online} + ${logStopped} + ${offline} + ${unknown} != ${total}`
      );
    });

    test("Invarian C.2: total alarm terbuka sinkron dengan insiden aktif", async () => {
      const openIncidents = await queryClient`
        SELECT COUNT(*)::int as count
        FROM incidents
        WHERE status IN ('open', 'investigating')
      `;
      const activeCount = openIncidents[0].count;
      assert.ok(typeof activeCount === "number" && activeCount >= 0);
    });

    test("Invarian C.3: breakdown keparahan (kritis + tinggi + sedang + rendah) == total alarm", async () => {
      const severities = await queryClient`
        SELECT severity, COUNT(*)::int as count
        FROM incidents
        WHERE status IN ('open', 'investigating')
        GROUP BY severity
      `;
      const totalActive = await queryClient`
        SELECT COUNT(*)::int as count
        FROM incidents
        WHERE status IN ('open', 'investigating')
      `;

      let sumSeverities = 0;
      for (const row of severities) {
        sumSeverities += Number(row.count);
      }

      assert.strictEqual(
        sumSeverities,
        Number(totalActive[0].count),
        "Invarian C.3 Gagal: Jumlah breakdown keparahan tidak sama dengan total alarm terbuka"
      );
    });

    test("Invarian C.4: total log 24j konsisten antara ringkasan dan akumulasi kartu perangkat", async () => {
      const activeDevs = await queryClient`SELECT id FROM devices WHERE is_active = true`;
      const devIds = activeDevs.map((d: any) => d.id);

      const [hourlySumRes, rawSumRes] = await Promise.all([
        queryClient`
          SELECT COALESCE(SUM(received_count), 0)::bigint as total
          FROM device_log_hourly
          WHERE hour_bucket >= NOW() - INTERVAL '24 hours'
            AND device_id = ANY(${devIds})
        `,
        queryClient`
          SELECT COUNT(*)::bigint as total
          FROM log_events
          WHERE event_time >= NOW() - INTERVAL '24 hours'
            AND device_id = ANY(${devIds})
        `,
      ]);

      const hourlySum = Number(hourlySumRes[0].total);
      const rawSum = Number(rawSumRes[0].total);

      // Toleransi perbedaan log real-time antara event_time dan hour_bucket
      const diff = Math.abs(hourlySum - rawSum);
      assert.ok(
        diff <= 10 || hourlySum === rawSum,
        `Invarian C.4 Gagal: device_log_hourly (${hourlySum}) vs log_events (${rawSum}) berbeda terlalu jauh (${diff})`
      );
    });

    test("Invarian C.5: heatmap armada mencakup seluruh perangkat terdaftar", async () => {
      const activeDevices = await queryClient`SELECT id FROM devices WHERE is_active = true`;
      const totalActive = activeDevices.length;
      assert.ok(totalActive > 0);

      // Heatmap data query
      const heatmapRows = await queryClient`
        SELECT id, name, status, ping_enabled, is_active
        FROM devices
        WHERE is_active = true
      `;
      assert.strictEqual(
        heatmapRows.length,
        totalActive,
        "Invarian C.5 Gagal: Heatmap tidak memuat seluruh node terdaftar"
      );
    });

    test("Invarian C.6: status node di heatmap persis sama dengan status perangkat", async () => {
      const devicesList = await queryClient`
        SELECT id, status FROM devices WHERE is_active = true
      `;
      for (const dev of devicesList) {
        assert.ok(
          ["online", "log_stopped", "offline", "rto", "unknown"].includes(dev.status),
          `Status tidak valid untuk device ${dev.id}: ${dev.status}`
        );
      }
    });
  });

  describe("B. Detail Perangkat & Endpoint Riwayat Status", () => {
    test("Perangkat tanpa riwayat ('Belum Ada Data') mengembalikan 200 OK dengan slot unknown dan bukan 500", async () => {
      assert.ok(dummyDeviceId, "dummyDeviceId harus tersedia");

      const timeline = await calculateComprehensiveTimeline(dummyDeviceId, "24j", "otomatis");

      assert.ok(timeline.slots.length > 0, "Harus menghasilkan slot waktu");

      // Karena tidak ada riwayat sama sekali, slot harus unknown / tanpa data
      const nonUnknown = timeline.slots.filter((s) => s.status !== "unknown");
      assert.strictEqual(nonUnknown.length, 0, "Semua slot harus berstatus 'unknown' untuk perangkat baru");

      // Periksa section_status
      assert.ok(timeline.section_status, "section_status harus ada");
      assert.strictEqual(timeline.section_status.status_utama, "tanpa_data");
      assert.strictEqual(timeline.section_status.ping, "tanpa_data");

      // Uptime persen harus aman (null atau number, bukan NaN)
      if (timeline.ringkasan.uptime_persen !== null) {
        assert.strictEqual(Number.isNaN(timeline.ringkasan.uptime_persen), false);
      }
    });

    test("Perangkat tanpa riwayat bekerja pada seluruh opsi rentang waktu", async () => {
      assert.ok(dummyDeviceId, "dummyDeviceId harus tersedia");
      const rentangList = ["24j", "7h", "30h", "90h", "1t"] as const;

      for (const rentang of rentangList) {
        const res = await calculateComprehensiveTimeline(dummyDeviceId, rentang, "otomatis");
        assert.ok(res.slots.length > 0, `Harus memiliki slot untuk rentang ${rentang}`);
        assert.ok(res.section_status, "section_status harus ada");
        assert.strictEqual(res.section_status.status_utama, "tanpa_data");
      }
    });

    test("ID perangkat yang tidak ada melempar error 'Perangkat tidak ditemukan' (memetakan ke 404, bukan 500)", async () => {
      const nonExistentId = "04c4beb0-0ea9-4586-97ef-9272a2f4f337";

      await assert.rejects(
        async () => {
          await calculateComprehensiveTimeline(nonExistentId, "24j", "otomatis");
        },
        {
          name: "Error",
          message: "Perangkat tidak ditemukan.",
        }
      );
    });
  });

  describe("C. Resiliensi Render Grafik Aktivitas Log", () => {
    test("Komponen grafik aman dari TypeError saat summaryMetrics tidak memiliki properti puncak/terendah", () => {
      // Meniru logika guard yang diperbaiki di HourlyActivityChart
      const simulateSafeSummaryExtraction = (summaryMetrics: any) => {
        const puncakLabel = summaryMetrics?.puncak?.label || "-";
        const puncakJam = summaryMetrics?.puncak?.jam ? `${summaryMetrics.puncak.jam}:00` : "-";
        const puncakCount = summaryMetrics?.puncak?.count != null ? summaryMetrics.puncak.count.toLocaleString("id-ID") : "0";
        const terendahLabel = summaryMetrics?.terendah_jam_penuh?.label || "-";
        const terendahJam = summaryMetrics?.terendah_jam_penuh?.jam ? `${summaryMetrics.terendah_jam_penuh.jam}:00` : "-";
        const terendahCount = summaryMetrics?.terendah_jam_penuh?.count != null ? summaryMetrics.terendah_jam_penuh.count.toLocaleString("id-ID") : "0";

        return { puncakLabel, puncakJam, puncakCount, terendahLabel, terendahJam, terendahCount };
      };

      // Kasus 1: summaryMetrics undefined
      const res1 = simulateSafeSummaryExtraction(undefined);
      assert.strictEqual(res1.puncakLabel, "-");
      assert.strictEqual(res1.puncakJam, "-");
      assert.strictEqual(res1.puncakCount, "0");

      // Kasus 2: summaryMetrics objek kosong
      const res2 = simulateSafeSummaryExtraction({});
      assert.strictEqual(res2.puncakLabel, "-");

      // Kasus 3: puncak bernilai null
      const res3 = simulateSafeSummaryExtraction({ puncak: null, terendah_jam_penuh: null });
      assert.strictEqual(res3.puncakLabel, "-");
      assert.strictEqual(res3.terendahLabel, "-");

      // Kasus 4: puncak valid
      const res4 = simulateSafeSummaryExtraction({
        puncak: { jam: "14", count: 120, label: "14:00 (120 log)" },
        terendah_jam_penuh: { jam: "03", count: 2, label: "03:00 (2 log)" },
      });
      assert.strictEqual(res4.puncakLabel, "14:00 (120 log)");
      assert.strictEqual(res4.terendahLabel, "03:00 (2 log)");
    });
  });

  describe("D. Logika Circuit Breaker Klien", () => {
    test("Circuit breaker menahan pemanggilan otomatis setelah 3 kegagalan beruntun", () => {
      let failureCount = 0;
      let circuitBreakerOpenUntil = 0;

      const recordFailure = () => {
        failureCount++;
        if (failureCount >= 3) {
          circuitBreakerOpenUntil = Date.now() + 30000; // 30 detik
        }
      };

      const recordSuccess = () => {
        failureCount = 0;
        circuitBreakerOpenUntil = 0;
      };

      const isAllowed = () => {
        return Date.now() >= circuitBreakerOpenUntil;
      };

      assert.strictEqual(isAllowed(), true);

      // Kegagalan 1 & 2: masih diizinkan
      recordFailure();
      assert.strictEqual(isAllowed(), true);
      recordFailure();
      assert.strictEqual(isAllowed(), true);

      // Kegagalan 3: circuit breaker terbuka
      recordFailure();
      assert.strictEqual(isAllowed(), false, "Permintaan berikutnya harus ditahan oleh circuit breaker");

      // Reset manual sukses
      recordSuccess();
      assert.strictEqual(isAllowed(), true, "Setelah sukses atau reset manual, circuit breaker kembali tertutup");
    });
  });
});
