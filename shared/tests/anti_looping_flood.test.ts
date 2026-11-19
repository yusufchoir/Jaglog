import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../src/db";
import { devices, logFilters, logEvents } from "../src/schema";
import { eq, sql, and } from "drizzle-orm";
import {
  matchFilters,
  normalizeMessage,
  invalidateFilterCache,
} from "../src/log-filter";
import {
  getPatternHash,
  checkAndTrackDedupe,
  registerDedupeParent,
  flushDedupeCountsToDb,
  setTemporaryFloodProtection,
  isFloodProtected,
} from "../src/dedupe";
import { detectLogFlood } from "../src/detection/rules";

describe("Anti-Looping & Flood Protection Tests", () => {
  let testDeviceId: string;

  before(async () => {
    // 1. Buat perangkat uji khusus
    const [dev] = await db
      .insert(devices)
      .values({
        name: "Test-Anti-Looping-MikroTik",
        type: "mikrotik",
        ipAddress: "192.168.88.1",
        location: "Lab Test",
        isActive: true,
      })
      .returning();
    testDeviceId = dev.id;
  });

  after(async () => {
    // Bersihkan data uji
    if (testDeviceId) {
      await db.delete(devices).where(eq(devices.id, testDeviceId));
    }
    setTimeout(() => process.exit(0), 100);
  });

  test("1. Proteksi ReDoS pada Pola Regex & Normalisasi", () => {
    const dangerousPattern = "([a-zA-Z0-9]+)+$";
    const re = /\([^)]*(\+|\*)\)[+*]/i;
    assert.equal(re.test(dangerousPattern), true);

    const rawMsg = "Download from 10.20.30.40:8080 by 00:1A:2B:3C:4D:5E with 12345 bytes FINISHED";
    const norm = normalizeMessage(rawMsg);
    assert.ok(norm.includes("<IP>"));
    assert.ok(norm.includes("<MAC>"));
    assert.ok(norm.includes("<N>"));
  });

  test("2. Uji Aksi Filter: discard, lower_severity, merge", async () => {
    await db.insert(logFilters).values([
      {
        deviceId: testDeviceId,
        name: "Test Discard Filter",
        matchType: "contains",
        pattern: "DROP_THIS_MESSAGE",
        action: "discard",
        isActive: true,
      },
      {
        deviceId: testDeviceId,
        name: "Test Lower Severity Filter",
        matchType: "contains",
        pattern: "LOWER_THIS_MESSAGE",
        action: "lower_severity",
        isActive: true,
      },
      {
        deviceId: testDeviceId,
        name: "Test Merge Filter",
        matchType: "contains",
        pattern: "MERGE_THIS_MESSAGE",
        action: "merge",
        isActive: true,
      },
    ]);

    invalidateFilterCache();

    const resDiscard = await matchFilters("Pesan ini DROP_THIS_MESSAGE segera", testDeviceId);
    assert.equal(resDiscard.matched, true);
    if (resDiscard.matched) {
      assert.equal(resDiscard.action, "discard");
    }

    const resLower = await matchFilters("Pesan ini LOWER_THIS_MESSAGE sekarang", testDeviceId);
    assert.equal(resLower.matched, true);
    if (resLower.matched) {
      assert.equal(resLower.action, "lower_severity");
    }

    const resMerge = await matchFilters("Pesan ini MERGE_THIS_MESSAGE berulang", testDeviceId);
    assert.equal(resMerge.matched, true);
    if (resMerge.matched) {
      assert.equal(resMerge.action, "merge");
    }

    await db.delete(logFilters).where(eq(logFilters.deviceId, testDeviceId));
    invalidateFilterCache();
  });

  test("3. Simulasi 5.000 Pesan Identik + 50 Pesan Unik", async () => {
    const floodMessage = "Download from jagalog.maudynetwork.id FINISHED";
    const patternHash = getPatternHash(floodMessage);

    await setTemporaryFloodProtection(testDeviceId, patternHash, 120);
    const isProt = await isFloodProtected(testDeviceId, patternHash);
    assert.equal(isProt, true);

    const [parent] = await db
      .insert(logEvents)
      .values({
        deviceId: testDeviceId,
        eventTime: new Date(),
        severity: 6,
        category: "system",
        message: floodMessage,
        raw: floodMessage,
        repeatCount: 1,
        firstEventTime: new Date(),
      })
      .returning();

    await registerDedupeParent(testDeviceId, patternHash, parent.id);

    let duplicateCount = 0;
    for (let i = 0; i < 4999; i++) {
      const check = await checkAndTrackDedupe(testDeviceId, patternHash);
      if (check.isDuplicate && check.parentLogId === parent.id) {
        duplicateCount++;
      }
    }
    assert.equal(duplicateCount, 4999);

    await flushDedupeCountsToDb([
      { logId: parent.id, additionalCount: duplicateCount, lastEventTime: new Date() },
    ]);

    const uniqueLogs = Array.from({ length: 50 }).map((_, idx) => ({
      deviceId: testDeviceId,
      eventTime: new Date(),
      severity: 6,
      category: "system" as any,
      message: `Pesan unik user login #${idx + 1}`,
      raw: `Pesan unik user login #${idx + 1}`,
      repeatCount: 1,
    }));
    await db.insert(logEvents).values(uniqueLogs);

    // Verifikasi Database:
    // 1. Pesan identik banjir: tepat 1 baris dengan repeat_count = 5000 (< 100 baris)
    const [identicRow] = await db
      .select()
      .from(logEvents)
      .where(and(eq(logEvents.deviceId, testDeviceId), eq(logEvents.id, parent.id)));

    assert.ok(identicRow);
    assert.equal(identicRow.repeatCount, 5000);

    // 2. Pesan unik lain: seluruh 50 baris tersimpan
    const uniqueSaved = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, testDeviceId),
          sql`${logEvents.message} LIKE 'Pesan unik user login %'`
        )
      );
    assert.equal(uniqueSaved[0]?.count, 50);
  });

  test("4. Deteksi Banjir Otomatis (log_flood rule & insiden)", async () => {
    const matches = await detectLogFlood();
    const testMatch = matches.find((m) => m.deviceId === testDeviceId);

    assert.ok(testMatch);
    assert.equal(testMatch?.ruleKey, "log_flood");
    assert.equal(testMatch?.severity, "medium");
    const details = testMatch?.evidence[0]?.details as Record<string, any> | undefined;
    assert.ok(details?.recommendation?.includes("JagaLog"));
    assert.ok(details?.suggestedFilter);
    assert.equal(details?.suggestedFilter?.action, "discard");
  });

  test("5. Pembersihan Bertahap Batch (Cleanup) Log Banjir", async () => {
    const [beforeCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, testDeviceId),
          sql`${logEvents.message} ILIKE '%Download from%'`
        )
      );
    assert.ok(beforeCount.count > 0);

    await db.execute(sql`
      WITH to_del AS (
        SELECT id FROM log_events
        WHERE device_id = ${testDeviceId}
          AND message ILIKE '%Download from%'
        LIMIT 5000
      )
      DELETE FROM log_events WHERE id IN (SELECT id FROM to_del);
    `);

    const [afterCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(logEvents)
      .where(
        and(
          eq(logEvents.deviceId, testDeviceId),
          sql`${logEvents.message} ILIKE '%Download from%'`
        )
      );
    assert.equal(afterCount.count, 0);
  });

  test("6. Log Penting (Warning/Error) Tidak Boleh Terbuang oleh Filter Bawaan", async () => {
    const criticalMessages = [
      "system,error,critical login failure for user admin",
      "firewall,warning drop invalid connection from 185.220.101.5",
      "system,error disk space low on volume1",
    ];

    for (const msg of criticalMessages) {
      const match = await matchFilters(msg, testDeviceId);
      assert.equal(match.matched, false);
    }
  });
});
