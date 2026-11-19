import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBsdSyslogTime,
  resolveEventTime,
  formatClockSkewDescription,
} from "../src/time.js";

test("Langkah 3: Unit Tests Perbaikan Tampilan Log & Jam Event", async (t) => {
  await t.test("1. BSD Syslog Time Parser dengan Berbagai Timezone Perangkat", () => {
    // Log: "Nov  5 15:30:00" dengan timezone Asia/Jakarta (UTC+7)
    const parsedWib = parseBsdSyslogTime("Nov  5 15:30:00", "Asia/Jakarta", 2026);
    assert.ok(parsedWib);
    assert.strictEqual(parsedWib.toISOString(), "2026-11-05T08:30:00.000Z");

    // Log: "Nov  5 16:30:00" dengan timezone Asia/Makassar (WITA, UTC+8)
    const parsedWita = parseBsdSyslogTime("Nov  5 16:30:00", "Asia/Makassar", 2026);
    assert.ok(parsedWita);
    assert.strictEqual(parsedWita.toISOString(), "2026-11-05T08:30:00.000Z");

    // Log: "Nov  5 08:30:00" dengan timezone UTC (UTC+0)
    const parsedUtc = parseBsdSyslogTime("Nov  5 08:30:00", "UTC", 2026);
    assert.ok(parsedUtc);
    assert.strictEqual(parsedUtc.toISOString(), "2026-11-05T08:30:00.000Z");

    // Fallback jika timezone invalid tetap berjalan tanpa throw error
    const parsedFallback = parseBsdSyslogTime("Nov  5 15:30:00", "Invalid/Timezone", 2026);
    assert.ok(parsedFallback);
  });

  await t.test("2. Aturan Ambang Skew 5 Menit (resolveEventTime)", () => {
    const serverReceivedAt = new Date("2026-11-05T10:00:00.000Z");

    // Kasus 1: Selisih 2 menit (120 detik) -> Jam perangkat valid, tetap pakai jam perangkat, skew undefined
    const deviceTime2Min = new Date("2026-11-05T10:02:00.000Z");
    const res1 = resolveEventTime(deviceTime2Min, serverReceivedAt);
    assert.strictEqual(res1.eventTime.toISOString(), deviceTime2Min.toISOString());
    assert.strictEqual(res1.clockSkewSeconds, undefined);
    assert.strictEqual(res1.deviceTime, undefined);

    // Kasus 2: Selisih tepat 5 menit (300 detik) -> Masih dalam batas aman
    const deviceTime5Min = new Date("2026-11-05T09:55:00.000Z");
    const res2 = resolveEventTime(deviceTime5Min, serverReceivedAt);
    assert.strictEqual(res2.eventTime.toISOString(), deviceTime5Min.toISOString());
    assert.strictEqual(res2.clockSkewSeconds, undefined);

    // Kasus 3: Jam meleset 6 menit terlambat (-360 detik) -> Skew terdeteksi, fallback ke received_at
    const deviceTimeLate = new Date("2026-11-05T09:54:00.000Z");
    const res3 = resolveEventTime(deviceTimeLate, serverReceivedAt);
    assert.strictEqual(res3.eventTime.toISOString(), serverReceivedAt.toISOString());
    assert.strictEqual(res3.clockSkewSeconds, -360);
    assert.strictEqual(res3.deviceTime, deviceTimeLate.toISOString());

    // Kasus 4: Jam meleset 1 hari di masa depan (+86400 detik) -> Fallback ke received_at
    const deviceTimeFuture = new Date("2026-11-06T10:00:00.000Z");
    const res4 = resolveEventTime(deviceTimeFuture, serverReceivedAt);
    assert.strictEqual(res4.eventTime.toISOString(), serverReceivedAt.toISOString());
    assert.strictEqual(res4.clockSkewSeconds, 86400);

    // Kasus 5: Log tidak mencantumkan timestamp sama sekali (null)
    const res5 = resolveEventTime(null, serverReceivedAt);
    assert.strictEqual(res5.eventTime.toISOString(), serverReceivedAt.toISOString());
    assert.strictEqual(res5.clockSkewSeconds, undefined);
    assert.strictEqual(res5.deviceTime, undefined);
  });

  await t.test("3. Penjelasan Humanis Clock Skew (formatClockSkewDescription)", () => {
    // 360 detik lebih cepat (6 menit)
    assert.strictEqual(formatClockSkewDescription(360), "6 menit lebih cepat");

    // -3600 detik lebih lambat (1 jam)
    assert.strictEqual(formatClockSkewDescription(-3600), "1 jam lebih lambat");

    // 45 detik
    assert.strictEqual(formatClockSkewDescription(45), "45 detik lebih cepat");

    // -75 detik
    assert.strictEqual(formatClockSkewDescription(-75), "1 menit 15 detik lebih lambat");

    // 0 detik
    assert.strictEqual(formatClockSkewDescription(0), "0 detik");
  });

  await t.test("4. Keyset Cursor Parsing & Kompatibilitas Keyset Pagination", () => {
    const rawCursor = "2026-11-05T08:30:00.000Z|12345";
    const parts = rawCursor.split("|");
    assert.strictEqual(parts.length, 2);

    const cursorTime = new Date(parts[0]);
    const cursorId = Number(parts[1]);

    assert.ok(!isNaN(cursorTime.getTime()));
    assert.strictEqual(cursorId, 12345);
    assert.strictEqual(cursorTime.toISOString(), "2026-11-05T08:30:00.000Z");
  });
});
