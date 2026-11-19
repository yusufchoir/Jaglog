import { test, describe, after } from "node:test";
import assert from "node:assert";
import {
  generateSlotBoundaries,
  determineSlotStatus,
  resolveDateRange,
  resolveConcreteScale,
  timelineQuerySchema,
  VALID_RENTANG_SKALA,
  formatDurationHuman,
  calculateComprehensiveTimeline,
  calculateSlotCount,
  getValidScalesForRange,
  formatScaleChoices,
  parseWibDateInput,
  SCALE_LABEL_MAP,
  evaluatePingSlotStatus,
  evaluateLogDeliverySlotStatus,
} from "../src/monitoring/timeline";
import { db } from "../src/db";
import { devices, deviceStatusHistory } from "../src/schema";
import { eq } from "drizzle-orm";
import { redis } from "../src/redis";
import { queryClient } from "../src/db";

describe("Langkah 3: Timeline & Ketersediaan Status Unit & Integration Tests", () => {
  after(async () => {
    try {
      await redis.quit();
    } catch {}
    try {
      await queryClient.end();
    } catch {}
    setTimeout(() => process.exit(0), 100);
  });

  describe("1. Unit Test Slot Boundary Generation (WIB UTC+7 Alignment)", () => {
    test("24j dengan skala 30m menghasilkan tepat 48 slot", () => {
      const { start, end } = resolveDateRange("24j", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "30m");
      assert.strictEqual(slots.length, 48);
    });

    test("7h dengan skala 4j menghasilkan tepat 42 slot", () => {
      const { start, end } = resolveDateRange("7h", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "4j");
      assert.strictEqual(slots.length, 42);
    });

    test("30h dengan skala 1h menghasilkan tepat 30 slot", () => {
      const { start, end } = resolveDateRange("30h", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "1h");
      assert.strictEqual(slots.length, 30);
    });

    test("90h dengan skala 1h menghasilkan tepat 90 slot", () => {
      const { start, end } = resolveDateRange("90h", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "1h");
      assert.strictEqual(slots.length, 90);
    });

    test("1t dengan skala 1m menghasilkan tepat 52 slot (atau 53 saat batas minggu)", () => {
      const { start, end } = resolveDateRange("1t", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "1m");
      assert.ok(slots.length >= 52 && slots.length <= 53);
    });

    test("1t dengan skala 1b menghasilkan tepat 12 atau 13 slot bulanan", () => {
      const { start, end } = resolveDateRange("1t", undefined, undefined, new Date("2026-11-05T12:00:00Z"));
      const slots = generateSlotBoundaries(start, end, "1b");
      assert.ok(slots.length >= 12 && slots.length <= 13);
    });

    test("Pergantian bulan dan WIB tetap konsisten (tanpa pengaruh DST)", () => {
      // 1 Februari sampai 1 Maret 2026
      const start = new Date("2026-02-01T00:00:00+07:00");
      const end = new Date("2026-03-01T00:00:00+07:00");
      const slots = generateSlotBoundaries(start, end, "1h");
      assert.strictEqual(slots.length, 28); // 2026 bukan tahun kabisat (28 hari)
    });
  });

  describe("2. Unit Test Logika Ambang & Warna Status Slot (Threshold Engine)", () => {
    test("detik_tanpa_data >= 50% menghasilkan status 'unknown'", () => {
      const status = determineSlotStatus({
        slotDurationSeconds: 14400, // 4 jam
        detikOnline: 6000,
        detikLogBerhenti: 0,
        detikOffline: 0,
        detikTanpaData: 8000, // > 50%
      });
      assert.strictEqual(status, "unknown");
    });

    test("skala <= 1 jam: offline >= 60 detik (1 menit) mewarnai 'offline'", () => {
      const status = determineSlotStatus({
        slotDurationSeconds: 1800, // 30 menit
        detikOnline: 1730,
        detikLogBerhenti: 0,
        detikOffline: 70, // >= 60 detik
        detikTanpaData: 0,
      });
      assert.strictEqual(status, "offline");
    });

    test("skala <= 1 jam: gangguan singkat < 60 detik tetap hijau ('online')", () => {
      const status = determineSlotStatus({
        slotDurationSeconds: 1800, // 30 menit
        detikOnline: 1760,
        detikLogBerhenti: 0,
        detikOffline: 40, // < 60 detik
        detikTanpaData: 0,
      });
      assert.strictEqual(status, "online");
    });

    test("skala 4-6 jam: ambang offline adalah 2% dari durasi slot", () => {
      const dur = 4 * 3600; // 14400 detik. 2% = 288 detik
      // 200 detik (< 2%) -> online
      const st1 = determineSlotStatus({
        slotDurationSeconds: dur,
        detikOnline: dur - 200,
        detikLogBerhenti: 0,
        detikOffline: 200,
        detikTanpaData: 0,
      });
      assert.strictEqual(st1, "online");

      // 300 detik (>= 2%) -> offline
      const st2 = determineSlotStatus({
        slotDurationSeconds: dur,
        detikOnline: dur - 300,
        detikLogBerhenti: 0,
        detikOffline: 300,
        detikTanpaData: 0,
      });
      assert.strictEqual(st2, "offline");
    });

    test("skala 1 hari: ambang log_stopped adalah 1% bila tidak ada offline", () => {
      const dur = 86400; // 1 hari. 1% = 864 detik
      const status = determineSlotStatus({
        slotDurationSeconds: dur,
        detikOnline: dur - 1000,
        detikLogBerhenti: 1000, // >= 1%
        detikOffline: 0,
        detikTanpaData: 0,
      });
      assert.strictEqual(status, "log_stopped");
    });
  });

  describe("3. Validasi Query Schema & Kombinasi Rentang-Skala", () => {
    test("Kombinasi valid diterima oleh schema", () => {
      const res = timelineQuerySchema.safeParse({ rentang: "7h", skala: "4j" });
      assert.strictEqual(res.success, true);
    });

    test("Skala default 'otomatis' diterima oleh schema", () => {
      const res = timelineQuerySchema.safeParse({ rentang: "24j" });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.skala, "otomatis");
    });

    test("Rentang kustom 05/11 s/d 05/11 (hari yang sama) adalah VALID dan satu hari penuh", () => {
      const res = timelineQuerySchema.safeParse({
        rentang: "kustom",
        dari: "2026-11-05",
        sampai: "2026-11-05",
      });
      assert.strictEqual(res.success, true);

      // Verifikasi resolveDateRange normalisasi ke WIB awal dan akhir hari
      const { start, end } = resolveDateRange("kustom", "2026-11-05", "2026-11-05", new Date("2026-11-06T12:00:00Z"));
      const diffMs = end.getTime() - start.getTime();
      // Selisih 23:59:59.999 = 86399999 ms (~24 jam)
      assert.ok(diffMs >= 86399000 && diffMs <= 86400000);

      // Skala otomatis untuk 1 hari (24 jam) memilih '30m' (48 slot, jarak terdekat ke 48)
      const scale = resolveConcreteScale("kustom", "otomatis", start, end);
      assert.strictEqual(scale, "30m");
    });

    test("Rentang kustom 06/11 s/d 05/11 ditolak dengan pesan spesifik", () => {
      const res = timelineQuerySchema.safeParse({
        rentang: "kustom",
        dari: "2026-11-06",
        sampai: "2026-11-05",
      });
      assert.strictEqual(res.success, false);
      if (!res.success) {
        assert.strictEqual(res.error.errors[0]?.message, "Tanggal akhir harus sama dengan atau setelah tanggal awal.");
      }
    });

    test("Rentang kustom tanggal kosong ditolak dengan pesan spesifik", () => {
      const res = timelineQuerySchema.safeParse({
        rentang: "kustom",
        dari: "",
        sampai: "",
      });
      assert.strictEqual(res.success, false);
      if (!res.success) {
        assert.strictEqual(res.error.errors[0]?.message, "Pilih tanggal awal dan akhir.");
      }
    });

    test("Rentang kustom 401 hari ditolak dengan pesan batas 400 hari", () => {
      const res = timelineQuerySchema.safeParse({
        rentang: "kustom",
        dari: "2025-01-01",
        sampai: "2026-03-01", // 424 hari
      });
      assert.strictEqual(res.success, false);
      if (!res.success) {
        assert.strictEqual(res.error.errors[0]?.message, "Rentang maksimal 400 hari. Persempit pilihan tanggalnya.");
      }
    });

    test("Kombinasi tidak valid ditolak oleh VALID_RENTANG_SKALA", () => {
      assert.strictEqual(VALID_RENTANG_SKALA["24j"].includes("1b"), false);
      assert.strictEqual(VALID_RENTANG_SKALA["7h"].includes("1b"), false);
      assert.strictEqual(VALID_RENTANG_SKALA["1t"].includes("15m"), false);
    });
  });

  describe("4. Format Durasi & Uptime Cakupan Data", () => {
    test("formatDurationHuman memformat waktu dengan benar dalam bahasa Indonesia", () => {
      assert.strictEqual(formatDurationHuman(0), "0 detik");
      assert.strictEqual(formatDurationHuman(45), "45 detik");
      assert.strictEqual(formatDurationHuman(120), "2 menit");
      assert.strictEqual(formatDurationHuman(3600), "1 jam");
      assert.strictEqual(formatDurationHuman(3720), "1 jam 2 menit");
      assert.strictEqual(formatDurationHuman(86400 * 2), "2 hari");
    });
  });

  describe("5. End-to-End Database Overlap & Comprehensive Timeline Calculation", () => {
    let testDeviceId: string;

    test("Setup: Buat perangkat uji dan beberapa interval status history", async () => {
      const now = new Date();
      // Buat perangkat dibuat 2 hari lalu
      const [dev] = await db
        .insert(devices)
        .values({
          name: "Test-Timeline-Router",
          type: "mikrotik",
          ipAddress: "10.99.99.1",
          createdAt: new Date(now.getTime() - 48 * 3600 * 1000), // 2 hari lalu
        })
        .returning();

      testDeviceId = dev.id;

      // Masukkan riwayat status:
      // 1. Online dari 48 jam lalu s/d 10 jam lalu
      await db.insert(deviceStatusHistory).values({
        deviceId: testDeviceId,
        status: "online",
        startedAt: new Date(now.getTime() - 48 * 3600 * 1000),
        endedAt: new Date(now.getTime() - 10 * 3600 * 1000),
      });

      // 2. Offline dari 10 jam lalu s/d 8 jam lalu (gangguan 2 jam)
      await db.insert(deviceStatusHistory).values({
        deviceId: testDeviceId,
        status: "offline",
        startedAt: new Date(now.getTime() - 10 * 3600 * 1000),
        endedAt: new Date(now.getTime() - 8 * 3600 * 1000),
      });

      // 3. Online kembali dari 8 jam lalu s/d sekarang (ongoing, endedAt: null)
      await db.insert(deviceStatusHistory).values({
        deviceId: testDeviceId,
        status: "online",
        startedAt: new Date(now.getTime() - 8 * 3600 * 1000),
        endedAt: null,
      });

      assert.ok(testDeviceId);
    });

    test("Kalkulasi rentang 24j: menghasilkan 48 slot, menghitung downtime dan uptime", async () => {
      const res = await calculateComprehensiveTimeline(testDeviceId, "24j", "30m");
      assert.strictEqual(res.slots.length, 48);
      assert.strictEqual(res.rentang, "24j");
      assert.strictEqual(res.slot_terpilih_skala, "30m");

      // Periksa ringkasan
      assert.ok(res.ringkasan.total_downtime_detik >= 7100 && res.ringkasan.total_downtime_detik <= 7300); // ~2 jam offline
      assert.ok(res.ringkasan.uptime_persen !== null && res.ringkasan.uptime_persen < 100);
      assert.ok(res.ringkasan.gangguan_terlama_detik >= 7100);

      // Pastikan ada slot yang berstatus "offline" pada rentang 10 jam - 8 jam lalu
      const offlineSlots = res.slots.filter((s) => s.status === "offline");
      assert.ok(offlineSlots.length > 0);
      assert.ok(offlineSlots[0].gangguan.length > 0);
      assert.strictEqual(offlineSlots[0].gangguan[0].status, "offline");
    });

    test("Kalkulasi rentang 7h untuk perangkat baru (2 hari data): menampilkan keterangan cakupan", async () => {
      const res = await calculateComprehensiveTimeline(testDeviceId, "7h", "4j");
      assert.strictEqual(res.slots.length, 42);

      // Karena perangkat baru berusia 2 hari dari rentang 7 hari:
      assert.ok(res.ringkasan.cakupan_data_persen < 100);
      assert.ok(res.ringkasan.keterangan_cakupan?.includes("Berdasarkan"));
      assert.ok(res.ringkasan.keterangan_cakupan?.includes("7 hari"));

      // Slot sebelum perangkat dibuat harus berstatus "unknown"
      const unknownSlots = res.slots.filter((s) => s.status === "unknown");
      assert.ok(unknownSlots.length > 0);
    });

    test("Kalkulasi rentang kustom 1 hari menghasilkan slot sesuai skala 1j", async () => {
      // Ambil 1 hari yang sudah lewat: 1 hari lalu
      const oneDayAgo = new Date(Date.now() - 24 * 3600 * 1000);
      const dateStr = oneDayAgo.toISOString().slice(0, 10);
      const res = await calculateComprehensiveTimeline(testDeviceId, "kustom", "1j", dateStr, dateStr);
      assert.strictEqual(res.rentang, "kustom");
      assert.strictEqual(res.slot_terpilih_skala, "1j");
      assert.strictEqual(res.slots.length, 24);
    });

    test("Rentang tanpa data sama sekali menghasilkan uptime_persen null dan keterangan cakupan", async () => {
      // Rentang 30 hari lalu sampai 20 hari lalu (sebelum perangkat dibuat 2 hari lalu)
      const res = await calculateComprehensiveTimeline(
        testDeviceId,
        "kustom",
        "1h",
        "2026-01-01",
        "2026-01-15"
      );
      assert.strictEqual(res.ringkasan.uptime_persen, null);
      assert.strictEqual(res.ringkasan.cakupan_data_persen, 0);
      assert.ok(res.ringkasan.keterangan_cakupan?.includes("Belum ada rekaman"));
      // Seluruh slot harus unknown
      for (const slot of res.slots) {
        assert.strictEqual(slot.status, "unknown");
      }
    });

    test("Cleanup: Hapus perangkat uji", async () => {
      if (testDeviceId) {
        await db.delete(devices).where(eq(devices.id, testDeviceId));
      }
    });
  });

  describe("6. Pemilih Skala Otomatis & Validasi Skala Terpusat (perbaiki_skala_otomatis.md)", () => {
    test("04/11 s/d 05/11 pada pukul 20.00 WIB (44 jam): Otomatis -> 1 jam (44 slot), tanpa error", () => {
      const start = parseWibDateInput("2026-11-04", false);
      const end = new Date("2026-11-05T20:00:00.000+07:00");
      const scale = resolveConcreteScale("kustom", "otomatis", start, end);
      assert.strictEqual(scale, "1j");
      const slots = calculateSlotCount(start, end, scale);
      assert.strictEqual(slots, 44);
      const validScales = getValidScalesForRange("kustom", start, end);
      assert.deepStrictEqual(validScales, ["30m", "1j"]);
    });

    test("05/11 s/d 05/11 (satu hari): Otomatis -> 30 menit (48 slot) atau 15 menit sesuai aturan terdekat ke 48", () => {
      // 1 hari penuh (24 jam)
      const startFull = parseWibDateInput("2026-11-05", false);
      const endFull = parseWibDateInput("2026-11-05", true);
      const scaleFull = resolveConcreteScale("kustom", "otomatis", startFull, endFull);
      assert.strictEqual(scaleFull, "30m");
      assert.strictEqual(calculateSlotCount(startFull, endFull, scaleFull), 48);

      // Setengah hari (12 jam, misal dipotong ke jam 12:00 siang WIB)
      const endHalf = new Date("2026-11-05T12:00:00.000+07:00");
      const scaleHalf = resolveConcreteScale("kustom", "otomatis", startFull, endHalf);
      assert.strictEqual(scaleHalf, "15m");
      assert.strictEqual(calculateSlotCount(startFull, endHalf, scaleHalf), 48);
    });

    test("Rentang 2 jam: Otomatis -> 15 menit, boleh kurang dari 12 slot, tanpa error", () => {
      const now = new Date("2026-11-05T15:00:00.000+07:00");
      const start = new Date(now.getTime() - 2 * 3600 * 1000);
      const scale = resolveConcreteScale("kustom", "otomatis", start, now);
      assert.strictEqual(scale, "15m");
      const slotCount = calculateSlotCount(start, now, scale);
      assert.strictEqual(slotCount, 8);
      assert.ok(slotCount < 12);
      const validScales = getValidScalesForRange("kustom", start, now);
      assert.deepStrictEqual(validScales, ["15m"]);
    });

    test("Rentang 400 hari: Otomatis memilih skala valid (minggu), tidak error", () => {
      const now = new Date("2026-11-05T12:00:00.000+07:00");
      const start = new Date(now.getTime() - 400 * 24 * 3600 * 1000);
      const scale = resolveConcreteScale("kustom", "otomatis", start, now);
      assert.strictEqual(scale, "1m");
      const slotCount = calculateSlotCount(start, now, scale);
      assert.ok(slotCount >= 12 && slotCount <= 96);
      assert.strictEqual(slotCount, 58);
    });

    test("Jam sekarang berbeda-beda (00.30, 12.00, 23.59): jumlah slot Otomatis selalu valid", () => {
      const start = parseWibDateInput("2026-11-05", false);

      // Pukul 00:30 WIB (30 menit berjalan): skala 15m, 2 slot
      const time0030 = new Date("2026-11-05T00:30:00.000+07:00");
      const scale0030 = resolveConcreteScale("kustom", "otomatis", start, time0030);
      assert.strictEqual(scale0030, "15m");
      assert.strictEqual(calculateSlotCount(start, time0030, scale0030), 2);

      // Pukul 12:00 WIB (12 jam berjalan): skala 15m, 48 slot
      const time1200 = new Date("2026-11-05T12:00:00.000+07:00");
      const scale1200 = resolveConcreteScale("kustom", "otomatis", start, time1200);
      assert.strictEqual(scale1200, "15m");
      assert.strictEqual(calculateSlotCount(start, time1200, scale1200), 48);

      // Pukul 23:59 WIB (hampir 24 jam): skala 30m, 48 slot
      const time2359 = new Date("2026-11-05T23:59:00.000+07:00");
      const scale2359 = resolveConcreteScale("kustom", "otomatis", start, time2359);
      assert.strictEqual(scale2359, "30m");
      assert.strictEqual(calculateSlotCount(start, time2359, scale2359), 48);
    });

    test("Skala manual yang tidak valid ditolak dengan pesan yang menyebut pilihan valid", () => {
      const start = parseWibDateInput("2026-11-04", false);
      const end = new Date("2026-11-05T20:00:00.000+07:00"); // 44 jam

      const validScales = getValidScalesForRange("kustom", start, end);
      assert.deepStrictEqual(validScales, ["30m", "1j"]);

      // Uji jika skala 15m dipilih (menghasilkan 176 slot)
      const slotCount15m = calculateSlotCount(start, end, "15m");
      assert.strictEqual(slotCount15m, 176);
      const limitText = slotCount15m > 96 ? "maks 96" : "min 12";
      const validChoices = formatScaleChoices(validScales);
      const errorMsg = `Skala ${SCALE_LABEL_MAP["15m"]} menghasilkan ${slotCount15m} slot (${limitText}). Pilih ${validChoices}.`;
      assert.strictEqual(errorMsg, "Skala 15 menit menghasilkan 176 slot (maks 96). Pilih 30 menit atau 1 jam.");

      // Uji jika skala 4j dipilih (menghasilkan 11 slot)
      const slotCount4j = calculateSlotCount(start, end, "4j");
      assert.strictEqual(slotCount4j, 11);
      const errorMsg4j = `Skala ${SCALE_LABEL_MAP["4j"]} menghasilkan ${slotCount4j} slot (${slotCount4j > 96 ? "maks 96" : "min 12"}). Pilih ${validChoices}.`;
      assert.strictEqual(errorMsg4j, "Skala 4 jam menghasilkan 11 slot (min 12). Pilih 30 menit atau 1 jam.");
    });
  });

  describe("7. Unit Test Status Slot Ping Server & Pengiriman Log (Langkah 3)", () => {
    const slotStart = new Date("2026-11-05T08:00:00.000+07:00");
    const slotEnd = new Date("2026-11-05T08:30:00.000+07:00");
    const now = new Date("2026-11-05T09:00:00.000+07:00");
    const devCreatedAt = new Date("2026-11-01T00:00:00.000+07:00");

    test("Ping: Belum Ada Data jika ping dinonaktifkan atau perangkat nonaktif", () => {
      const resDisabled = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: false,
        isDeviceActive: true,
        checkCount: 60,
        failCount: 0,
        maxConsecutiveRtoSeconds: 0,
        avgLatencyMs: 15,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resDisabled.status, "unknown");

      const resInactive = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: false,
        checkCount: 60,
        failCount: 0,
        maxConsecutiveRtoSeconds: 0,
        avgLatencyMs: 15,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resInactive.status, "unknown");
    });

    test("Ping: Belum Ada Data jika slot sebelum perangkat dibuat atau cek = 0", () => {
      const futureCreated = new Date("2026-11-06T00:00:00.000+07:00");
      const resBeforeCreated = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: futureCreated,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 60,
        failCount: 0,
        maxConsecutiveRtoSeconds: 0,
        avgLatencyMs: 15,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resBeforeCreated.status, "unknown");

      const resZeroChecks = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 0,
        failCount: 0,
        maxConsecutiveRtoSeconds: 0,
        avgLatencyMs: null,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resZeroChecks.status, "unknown");
    });

    test("Ping: Up jika semua cek sukses (failCount = 0)", () => {
      const res = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 60,
        failCount: 0,
        maxConsecutiveRtoSeconds: 0,
        avgLatencyMs: 12,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "up");
      assert.strictEqual(res.persen_sukses, 100);
      assert.strictEqual(res.rtt_rata_ms, 12);
    });

    test("Ping: Sebagian jika ada gagal tapi di bawah ambang Down", () => {
      const res = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 60,
        failCount: 1,
        maxConsecutiveRtoSeconds: 30, // < 90 detik (3 * 30s)
        avgLatencyMs: 25,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "sebagian");
      assert.ok((res.persen_sukses || 0) < 100);
    });

    test("Ping: Down pada skala <= 1 jam jika gagal berturut-turut >= ambang RTO (3 * 30s)", () => {
      const res = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 60,
        failCount: 3,
        maxConsecutiveRtoSeconds: 90, // 3 * 30s
        avgLatencyMs: 20,
        pingFailureThreshold: 3,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "down");
    });

    test("Ping: Down pada skala 4-6 jam jika cek gagal >= 10%", () => {
      const res = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 480,
        failCount: 50, // > 10%
        maxConsecutiveRtoSeconds: 60,
        avgLatencyMs: 30,
        pingFailureThreshold: 3,
        slotDurationSeconds: 14400, // 4 jam
        now,
      });
      assert.strictEqual(res.status, "down");
    });

    test("Ping: Down pada skala >= 1 hari jika cek gagal >= 5%", () => {
      const res = evaluatePingSlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        pingEnabled: true,
        isDeviceActive: true,
        checkCount: 2880,
        failCount: 150, // > 5%
        maxConsecutiveRtoSeconds: 60,
        avgLatencyMs: 25,
        pingFailureThreshold: 3,
        slotDurationSeconds: 86400, // 1 hari
        now,
      });
      assert.strictEqual(res.status, "down");
    });

    test("Log: Belum Ada Data jika perangkat nonaktif atau belum pernah mengirim log", () => {
      const resInactive = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: false,
        hasDeviceSentLogsEver: true,
        receivedCount: 0,
        maxGapSeconds: 0,
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resInactive.status, "unknown");

      const resNeverSent = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: false,
        receivedCount: 0,
        maxGapSeconds: 0,
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(resNeverSent.status, "unknown");
    });

    test("Log: Mengirim jika slot punya log dan tidak ada celah diam melebihi ambang", () => {
      const res = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: true,
        receivedCount: 42,
        maxGapSeconds: 120, // 2 menit < ambang 10 menit
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "mengirim");
      assert.strictEqual(res.jumlah_log, 42);
    });

    test("Log: Sebagian jika ada log tetapi ada celah tanpa log >= offline_after_minutes", () => {
      const res = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: true,
        receivedCount: 15,
        maxGapSeconds: 900, // 15 menit >= ambang 10 menit (600s)
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "sebagian");
    });

    test("Log: Tidak Mengirim jika 0 log pada perangkat aktif yang sudah pernah mengirim", () => {
      const res = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: true,
        receivedCount: 0,
        maxGapSeconds: 1800,
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
      });
      assert.strictEqual(res.status, "tidak_mengirim");
      assert.strictEqual(res.jumlah_log, 0);
    });

    test("Log: Slot sedang berjalan tidak langsung merah jika belum melewati ambang offline", () => {
      const activeSlotStart = new Date("2026-11-05T08:55:00.000+07:00");
      const activeSlotEnd = new Date("2026-11-05T09:25:00.000+07:00");
      const currentNow = new Date("2026-11-05T09:00:00.000+07:00"); // 5 menit berjalan (< 10 menit)

      const res = evaluateLogDeliverySlotStatus({
        slotStart: activeSlotStart,
        slotEnd: activeSlotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: true,
        receivedCount: 0,
        maxGapSeconds: 0,
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now: currentNow,
      });
      // Karena baru 5 menit lewat (ambang 10 menit), belum merah!
      assert.strictEqual(res.status, "mengirim");
    });

    test("Slot parsial pertama/terakhir ditandai sebagian_slot", () => {
      const res = evaluateLogDeliverySlotStatus({
        slotStart,
        slotEnd,
        deviceCreatedAt: devCreatedAt,
        isDeviceActive: true,
        hasDeviceSentLogsEver: true,
        receivedCount: 10,
        maxGapSeconds: 0,
        offlineAfterMinutes: 10,
        slotDurationSeconds: 1800,
        now,
        sebagianSlot: true,
      });
      assert.strictEqual(res.sebagian_slot, true);
    });
  });
});

