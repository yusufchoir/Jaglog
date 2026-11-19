import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db, queryClient } from "../src/db";
import { redis } from "../src/redis";
import { devices, logEvents, incidents } from "../src/schema";
import { eq, inArray } from "drizzle-orm";
import {
  recordIncident,
  getDetectionThresholds,
  getIpAllowlist,
  detectBruteForceLogin,
  detectPasswordSpray,
  detectSuccessAfterFailures,
  detectPortScan,
  detectNewAdminAccount,
  detectLogCleared,
  runDetectionEngine,
  RuleMatch,
} from "../src/detection";

describe("Phase 6: Attack Detection Rule Engine Tests", () => {
  let testDeviceId: string;
  const testAttackIp = "198.51.100.99";
  const whitelistedIp = "127.0.0.1";

  before(async () => {
    // 1. Buat dummy device untuk pengujian
    const [dev] = await db
      .insert(devices)
      .values({
        name: "Test Detection Firewall",
        type: "firewall",
        ipAddress: "192.0.2.1",
        isActive: true,
      })
      .returning({ id: devices.id });

    testDeviceId = dev.id;
  });

  after(async () => {
    // Bersihkan data uji coba
    if (testDeviceId) {
      await db.delete(incidents).where(eq(incidents.deviceId, testDeviceId));
      await db.delete(logEvents).where(eq(logEvents.deviceId, testDeviceId));
      await db.delete(devices).where(eq(devices.id, testDeviceId));
    }
    await queryClient.end();
    redis.disconnect();
  });

  test("1. Settings & Allowlist Retrieval with Redis caching", async () => {
    const thresholds = await getDetectionThresholds();
    assert.ok(thresholds.brute_force_login);
    assert.strictEqual(thresholds.brute_force_login.max_failures, 10);
    assert.strictEqual(thresholds.port_scan.min_ports, 20);

    const allowlist = await getIpAllowlist();
    assert.ok(allowlist.has("127.0.0.1"));
  });

  test("2. Smart Incident Recording & Deduplication (Single Open Incident per entity)", async () => {
    const match1: RuleMatch = {
      ruleKey: "brute_force_login",
      deviceId: testDeviceId,
      severity: "high",
      title: `Percobaan Brute Force Login dari IP ${testAttackIp}`,
      mainEntity: testAttackIp,
      firstSeen: new Date(),
      lastSeen: new Date(),
      count: 10,
      evidence: [
        {
          eventId: "ev-1",
          timestamp: new Date().toISOString(),
          message: "Failed password for admin",
          src_ip: testAttackIp,
        },
      ],
    };

    // Panggilan pertama: Harus membuat insiden baru
    const res1 = await recordIncident(match1);
    assert.strictEqual(res1.isNew, true);
    assert.ok(res1.id);

    // Panggilan kedua untuk entity yang sama: Harus UPDATE insiden yang ada (Deduplikasi)
    const match2: RuleMatch = {
      ...match1,
      count: 5,
      evidence: [
        {
          eventId: "ev-2",
          timestamp: new Date().toISOString(),
          message: "Failed password for root",
          src_ip: testAttackIp,
        },
      ],
    };

    const res2 = await recordIncident(match2);
    assert.strictEqual(res2.isNew, false, "Harus mengupdate insiden yang ada, bukan duplikat");
    assert.strictEqual(res2.id, res1.id);

    // Verifikasi di database: Total insiden tetap 1 dan count menjadi 15
    const [inc] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, res1.id));

    assert.strictEqual(inc.count, 15);
    assert.strictEqual(inc.status, "open");
    assert.strictEqual((inc.evidence as any[]).length, 2);
  });

  test("3. Brute Force Login Detection & IP Allowlist check", async () => {
    const thresholds = await getDetectionThresholds();
    const allowlist = await getIpAllowlist();

    const now = new Date();

    // Suntik 11 log login gagal dari testAttackIp
    const attackLogs = Array.from({ length: 11 }, (_, i) => ({
      deviceId: testDeviceId,
      receivedAt: now,
      eventTime: new Date(now.getTime() - i * 5000),
      severity: 4,
      facility: 1,
      sourceApp: "sshd",
      category: "auth" as const,
      message: `Failed password for user admin from ${testAttackIp} port ${50000 + i} ssh2`,
      raw: `Failed password for user admin from ${testAttackIp}`,
      parsed: {
        action: "login",
        outcome: "failure",
        actor: "admin",
        src_ip: testAttackIp,
      },
    }));

    // Suntik juga 15 log login gagal dari IP di allowlist (127.0.0.1)
    const allowlistLogs = Array.from({ length: 15 }, (_, i) => ({
      deviceId: testDeviceId,
      receivedAt: now,
      eventTime: new Date(now.getTime() - i * 5000),
      severity: 4,
      facility: 1,
      sourceApp: "sshd",
      category: "auth" as const,
      message: `Failed password for user test from ${whitelistedIp}`,
      raw: `Failed password for user test from ${whitelistedIp}`,
      parsed: {
        action: "login",
        outcome: "failure",
        actor: "test",
        src_ip: whitelistedIp,
      },
    }));

    await db.insert(logEvents).values([...attackLogs, ...allowlistLogs]);

    const matches = await detectBruteForceLogin(thresholds, allowlist);

    // Harus mendeteksi testAttackIp, tetapi MENGABAIKAN 127.0.0.1
    const matchAttack = matches.find((m) => m.mainEntity === testAttackIp);
    const matchAllowlist = matches.find((m) => m.mainEntity === whitelistedIp);

    assert.ok(matchAttack, "Harus mendeteksi brute force dari attack IP");
    assert.strictEqual(matchAttack.severity, "high");
    assert.ok(matchAttack.count >= 11);
    assert.strictEqual(matchAllowlist, undefined, "IP allowlist TIDAK boleh memicu insiden");
  });

  test("4. Port Scan Detection (>= 20 port disentuh dalam 1 menit)", async () => {
    const thresholds = await getDetectionThresholds();
    const allowlist = await getIpAllowlist();
    const portScanIp = "198.51.100.77";

    const now = new Date();
    const scanLogs = Array.from({ length: 25 }, (_, i) => ({
      deviceId: testDeviceId,
      receivedAt: now,
      eventTime: new Date(now.getTime() - i * 1000),
      severity: 4,
      facility: 1,
      sourceApp: "ufw",
      category: "firewall" as const,
      message: `[UFW BLOCK] SRC=${portScanIp} DST=10.0.0.1 SPT=44321 DPT=${1000 + i}`,
      raw: `[UFW BLOCK] SRC=${portScanIp} DST=10.0.0.1 SPT=44321 DPT=${1000 + i}`,
      parsed: {
        action: "drop",
        outcome: "failure",
        src_ip: portScanIp,
        dst_ip: "10.0.0.1",
        dst_port: 1000 + i,
      },
    }));

    await db.insert(logEvents).values(scanLogs);

    const matches = await detectPortScan(thresholds, allowlist);
    const scanMatch = matches.find((m) => m.mainEntity === portScanIp);

    assert.ok(scanMatch, "Harus mendeteksi port scan");
    assert.strictEqual(scanMatch.ruleKey, "port_scan");
    assert.ok(scanMatch.count >= 25);
  });

  test("5. New Admin Account & Log Cleared Detections", async () => {
    const thresholds = await getDetectionThresholds();
    const allowlist = await getIpAllowlist();
    const now = new Date();

    // 1. Akun admin baru (EventID 4732 ke Administrators)
    const adminEvent = {
      deviceId: testDeviceId,
      receivedAt: now,
      eventTime: now,
      severity: 3,
      facility: 1,
      sourceApp: "windows",
      category: "config" as const,
      message: "A member was added to a security-enabled local group: Administrators",
      raw: '{"EventID": 4732, "TargetGroupName": "Administrators", "MemberName": "shadow_admin"}',
      parsed: {
        eventId: 4732,
        action: "group_member_add",
        group_name: "Administrators",
        member_name: "shadow_admin",
        outcome: "success",
      },
    };

    // 2. Log Cleared (EventID 1102)
    const logClearedEvent = {
      deviceId: testDeviceId,
      receivedAt: now,
      eventTime: now,
      severity: 2,
      facility: 1,
      sourceApp: "windows",
      category: "system" as const,
      message: "The audit log was cleared",
      raw: '{"EventID": 1102}',
      parsed: {
        eventId: 1102,
        action: "log_cleared",
        outcome: "success",
      },
    };

    await db.insert(logEvents).values([adminEvent, logClearedEvent]);

    const adminMatches = await detectNewAdminAccount(thresholds, allowlist);
    assert.ok(adminMatches.length > 0);
    assert.strictEqual(adminMatches[0].ruleKey, "new_admin_account");
    assert.strictEqual(adminMatches[0].mainEntity, "shadow_admin");

    const clearMatches = await detectLogCleared(thresholds, allowlist);
    assert.ok(clearMatches.length > 0);
    assert.strictEqual(clearMatches[0].ruleKey, "log_cleared");
    assert.strictEqual(clearMatches[0].severity, "critical");
  });

  test("6. End-to-End runDetectionEngine Orchestration", async () => {
    const result = await runDetectionEngine();
    assert.ok(result.matchesCount > 0, "Harus menemukan match serangan");
    assert.ok(result.durationMs >= 0);
    assert.ok(typeof result.newIncidentsCount === "number");
    assert.ok(typeof result.updatedIncidentsCount === "number");
  });
});
