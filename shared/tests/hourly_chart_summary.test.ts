import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generate24HourBucketsWib,
  computeChartSummary,
  HourlyBucketData,
} from "../src/monitoring/chart_summary";

describe("Verifikasi Aturan Grafik & Ringkasan Volume Log (Langkah 3 - Bagian A)", () => {
  it("1. generate24HourBucketsWib menghasilkan tepat 24 jam dengan batas jam 00 WIB dan jam terakhir parsial", () => {
    const buckets = generate24HourBucketsWib(new Date());
    assert.equal(buckets.length, 24, "Harus tepat 24 jam");

    // Jam terakhir (i = 23) adalah jam berjalan (parsial)
    const lastBucket = buckets[buckets.length - 1];
    assert.equal(lastBucket.isPartial, true, "Jam berjalan harus bertanda isPartial = true");

    // Format WIB
    assert.match(lastBucket.labelWib, /^\d{2}\.00$/, "Label WIB harus berformat HH.00");
    assert.match(lastBucket.rentangWib, /^\d{2}\.00-\d{2}\.00 WIB$/, "Rentang WIB harus berformat HH.00-HH.00 WIB");
  });

  it("2. computeChartSummary menghitung rata-rata HANYA dari jam penuh (jam parsial diabaikan)", () => {
    // 23 jam penuh masing-masing 100 log, 1 jam parsial 10 log
    const mockBuckets: HourlyBucketData[] = [];
    for (let i = 0; i < 24; i++) {
      const isPartial = i === 23;
      mockBuckets.push({
        mulai: new Date().toISOString(),
        selesai: new Date().toISOString(),
        hour: `${i}:00`,
        fullTime: `2026-11-13 ${i}:00`,
        labelWib: `${i}.00`,
        rentangWib: `${i}.00-${i + 1}.00 WIB`,
        tanggalWib: "13 Nov",
        gantiHari: i === 0,
        jumlah_log: isPartial ? 10 : 100,
        count: isPartial ? 10 : 100,
        jumlah_per_severity: { critical: 0, error: 0, warning: 0, notice: 0, info: 100, debug: 0 },
        jumlah_perangkat_aktif: 1,
        parsial: isPartial,
        menitBerjalan: isPartial ? 15 : 60,
        top_perangkat: [{ id: "dev-1", name: "Router Core", count: 100 }],
      });
    }

    const summary = computeChartSummary(mockBuckets, 2300);
    assert.equal(summary.total_24j, 2310, "Total 24 jam mencakup seluruh 24 jam");
    assert.equal(summary.rata_rata_per_jam, 100, "Rata-rata harus 100 log/jam (hanya dari 23 jam penuh, BUKAN 2310/24)");
    assert.equal(summary.terendah_jam_penuh.count, 100, "Terendah jam penuh harus 100, bukan 10 jam parsial");
  });

  it("3. Penjelasan otomatis: Skenario Lonjakan (> 2x rata-rata)", () => {
    const mockBuckets: HourlyBucketData[] = [];
    for (let i = 0; i < 24; i++) {
      const isSpike = i === 14;
      mockBuckets.push({
        mulai: new Date().toISOString(),
        selesai: new Date().toISOString(),
        hour: `${i}:00`,
        fullTime: `2026-11-13 ${i}:00`,
        labelWib: `${String(i).padStart(2, "0")}.00`,
        rentangWib: `${String(i).padStart(2, "0")}.00-${String(i + 1).padStart(2, "0")}.00 WIB`,
        tanggalWib: "13 Nov",
        gantiHari: i === 0,
        jumlah_log: isSpike ? 3450 : 1000,
        count: isSpike ? 3450 : 1000,
        jumlah_per_severity: { critical: 0, error: 0, warning: 0, notice: 0, info: 1000, debug: 0 },
        jumlah_perangkat_aktif: 1,
        parsial: i === 23,
        menitBerjalan: 60,
        top_perangkat: [{ id: "dev-mikrotik", name: "Main Mikrotik", count: isSpike ? 3450 : 1000 }],
      });
    }

    const summary = computeChartSummary(mockBuckets, 24000);
    assert.match(
      summary.penjelasan_otomatis,
      /Ada lonjakan 3,1x pada pukul 14\.00 dari Main Mikrotik\. Periksa Event Log\./,
      "Harus menghasilkan kalimat lonjakan spesifik"
    );
  });

  it("4. Penjelasan otomatis: Skenario Jam Kosong di Tengah Hari", () => {
    const mockBuckets: HourlyBucketData[] = [];
    for (let i = 0; i < 24; i++) {
      const isZero = i >= 3 && i <= 5;
      mockBuckets.push({
        mulai: new Date().toISOString(),
        selesai: new Date().toISOString(),
        hour: `${i}:00`,
        fullTime: `2026-11-13 ${i}:00`,
        labelWib: `${String(i).padStart(2, "0")}.00`,
        rentangWib: `${String(i).padStart(2, "0")}.00-${String(i + 1).padStart(2, "0")}.00 WIB`,
        tanggalWib: "13 Nov",
        gantiHari: i === 0,
        jumlah_log: isZero ? 0 : 500,
        count: isZero ? 0 : 500,
        jumlah_per_severity: { critical: 0, error: 0, warning: 0, notice: 0, info: 500, debug: 0 },
        jumlah_perangkat_aktif: 1,
        parsial: i === 23,
        menitBerjalan: 60,
        top_perangkat: [{ id: "dev-1", name: "Server Linux", count: 500 }],
      });
    }

    const summary = computeChartSummary(mockBuckets, 10000);
    assert.match(
      summary.penjelasan_otomatis,
      /Tidak ada log pada pukul 03\.00-06\.00\./,
      "Harus menghasilkan keterangan jam tanpa log"
    );
  });

  it("5. Penjelasan otomatis: Skenario Volume Stabil", () => {
    const mockBuckets: HourlyBucketData[] = [];
    for (let i = 0; i < 24; i++) {
      const isPeak = i === 1;
      mockBuckets.push({
        mulai: new Date().toISOString(),
        selesai: new Date().toISOString(),
        hour: `${i}:00`,
        fullTime: `2026-11-13 ${i}:00`,
        labelWib: `${String(i).padStart(2, "0")}.00`,
        rentangWib: `${String(i).padStart(2, "0")}.00-${String(i + 1).padStart(2, "0")}.00 WIB`,
        tanggalWib: "13 Nov",
        gantiHari: i === 0,
        jumlah_log: isPeak ? 14193 : 12480,
        count: isPeak ? 14193 : 12480,
        jumlah_per_severity: { critical: 0, error: 0, warning: 0, notice: 0, info: 12480, debug: 0 },
        jumlah_perangkat_aktif: 5,
        parsial: i === 23,
        menitBerjalan: 60,
        top_perangkat: [{ id: "dev-1", name: "Server Linux", count: 5000 }],
      });
    }

    const summary = computeChartSummary(mockBuckets, 300000);
    assert.match(
      summary.penjelasan_otomatis,
      /Volume stabil, tertinggi pukul 01\.00 \(14\.193 log\)\./,
      "Harus menghasilkan kalimat volume stabil"
    );
  });

  it("6. Penjelasan otomatis: Skenario Tanpa Data Sama Sekali", () => {
    const mockBuckets: HourlyBucketData[] = [];
    for (let i = 0; i < 24; i++) {
      mockBuckets.push({
        mulai: new Date().toISOString(),
        selesai: new Date().toISOString(),
        hour: `${i}:00`,
        fullTime: `2026-11-13 ${i}:00`,
        labelWib: `${String(i).padStart(2, "0")}.00`,
        rentangWib: `${String(i).padStart(2, "0")}.00-${String(i + 1).padStart(2, "0")}.00 WIB`,
        tanggalWib: "13 Nov",
        gantiHari: i === 0,
        jumlah_log: 0,
        count: 0,
        jumlah_per_severity: { critical: 0, error: 0, warning: 0, notice: 0, info: 0, debug: 0 },
        jumlah_perangkat_aktif: 0,
        parsial: i === 23,
        menitBerjalan: 60,
        top_perangkat: [],
      });
    }

    const summary = computeChartSummary(mockBuckets, 0);
    assert.equal(summary.penjelasan_otomatis, "Belum ada log pada 24 jam terakhir.");
  });
});
