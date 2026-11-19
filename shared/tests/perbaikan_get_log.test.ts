import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert";
import {
  recordIngestRejection,
  recordDevicePacketAccepted,
  getDeviceIngestDiagnostics,
  getGlobalIngestRejections24h,
  getUnknownSourcesList,
  removeUnknownSourceIp,
  MAX_UNKNOWN_SOURCES,
} from "../src/ingest-diagnostics";
import { parseSyslogMessage, processRawSyslog, flushSyslogBatch } from "../../collector/src/syslog";
import { parseLog } from "../src/parsers/index";
import { db, queryClient } from "../src/db";
import { devices, logEvents } from "../src/schema";
import { eq, and, ilike } from "drizzle-orm";
import { redis } from "../src/redis";
import { getIngestQueue } from "../src/queue";
import { createSession, destroySession } from "../src/auth";

const BASE_URL = "http://localhost:3000";

describe("Perbaikan Get Log - Ingest Diagnostics, E2E Scenarios, Flood Capping, & RouterOS v7 Parser", () => {
  const createdDeviceIds: string[] = [];
  let adminSessionToken = "";

  beforeEach(async () => {
    await redis.del("ingest:unknown_sources");
    const keys = await redis.keys("ingest:reject:*");
    if (keys.length > 0) await redis.del(...keys);
    const pktKeys = await redis.keys("ingest:last_pkt:test-dev-*");
    if (pktKeys.length > 0) await redis.del(...pktKeys);
  });

  after(async () => {
    for (const id of createdDeviceIds) {
      await db.delete(logEvents).where(eq(logEvents.deviceId, id)).catch(() => {});
      await db.delete(devices).where(eq(devices.id, id)).catch(() => {});
      await redis.del(`ingest:last_pkt:${id}`).catch(() => {});
      const devRejKeys = await redis.keys(`ingest:reject:dev:${id}:*`);
      if (devRejKeys.length > 0) await redis.del(...devRejKeys).catch(() => {});
    }
    await redis.del("cache:devices:catalog").catch(() => {});
    await redis.del("ingest:unknown_sources").catch(() => {});
    if (adminSessionToken) {
      await destroySession(adminSessionToken).catch(() => {});
    }
    await getIngestQueue().close().catch(() => {});
    await redis.quit().catch(() => {});
    await queryClient.end().catch(() => {});
  });

  test("1. Menghitung penolakan per alasan (nonaktif, ip_tidak_terdaftar, token_salah, rate_limit, ukuran, tidak_terbaca) per perangkat & global", async () => {
    const devId = "test-dev-181";

    await recordIngestRejection({
      reason: "nonaktif",
      deviceId: devId,
      sourceIp: "103.18.133.181",
      transport: "syslog",
    });
    await recordIngestRejection({
      reason: "nonaktif",
      deviceId: devId,
      sourceIp: "103.18.133.181",
      transport: "syslog",
    });
    await recordIngestRejection({
      reason: "rate_limit",
      deviceId: devId,
      sourceIp: "103.18.133.181",
      transport: "syslog",
    });
    await recordIngestRejection({
      reason: "token_salah",
      sourceIp: "10.0.0.50",
      transport: "http",
    });
    await recordIngestRejection({
      reason: "ukuran",
      deviceId: devId,
      sourceIp: "103.18.133.181",
      transport: "syslog",
    });
    await recordIngestRejection({
      reason: "tidak_terbaca",
      deviceId: devId,
      sourceIp: "103.18.133.181",
      transport: "syslog",
    });

    const devDiag = await getDeviceIngestDiagnostics(devId);
    assert.strictEqual(devDiag.rejections24h.nonaktif, 2);
    assert.strictEqual(devDiag.rejections24h.rate_limit, 1);
    assert.strictEqual(devDiag.rejections24h.ukuran, 1);
    assert.strictEqual(devDiag.rejections24h.tidak_terbaca, 1);
    assert.strictEqual(devDiag.totalRejected24h, 5);
    assert.ok(devDiag.lastPacket);
    assert.strictEqual(devDiag.lastPacket?.accepted, false);
    assert.strictEqual(devDiag.lastPacket?.sourceIp, "103.18.133.181");
    assert.strictEqual(devDiag.lastPacket?.reason, "tidak_terbaca");

    await recordDevicePacketAccepted(devId, "103.18.133.181", "syslog");
    const devDiagAfter = await getDeviceIngestDiagnostics(devId);
    assert.strictEqual(devDiagAfter.lastPacket?.accepted, true);
    assert.strictEqual(devDiagAfter.lastPacket?.sourceIp, "103.18.133.181");

    const globalRej = await getGlobalIngestRejections24h();
    assert.ok(globalRej.nonaktif >= 2);
    assert.ok(globalRej.token_salah >= 1);
  });

  test("2. Skenario Langkah 3 #1 & #4: Kirim syslog dari IP terdaftar ke perangkat Nonaktif -> ditolak dengan alasan 'nonaktif', tidak ada badge UP Online / ping; setelah Aktifkan -> log masuk", async () => {
    // Buat sesi admin untuk panggil endpoint API
    adminSessionToken = await createSession({
      userId: "00000000-0000-0000-0000-000000000001",
      username: "admin_test_getlog",
      role: "admin",
    });
    const cookieHeader = { Cookie: `jagalog_session=${adminSessionToken}`, "Content-Type": "application/json" };

    const testIp = "103.18.133.251";
    const [dev] = await db
      .insert(devices)
      .values({
        name: "TEST_MIKROTIK_NONAKTIF_181",
        type: "mikrotik",
        ipAddress: testIp,
        isActive: false,
        status: "online", // Sengaja diset 'online' di DB untuk memverifikasi API tetap mengembalikan status nonaktif / tidak UP Online
        pingEnabled: true,
      })
      .returning();
    createdDeviceIds.push(dev.id);
    await redis.del("cache:devices:catalog");

    // 1. Pastikan GET /api/devices/[id]/stats melaporkan isActive: false, isOnline: false, status: 'unknown', dan ipAddress: testIp
    const statsRes1 = await fetch(`${BASE_URL}/api/devices/${dev.id}/stats`, { headers: cookieHeader });
    assert.strictEqual(statsRes1.status, 200);
    const statsJson1 = await statsRes1.json();
    assert.strictEqual(statsJson1.device.isActive, false);
    assert.strictEqual(statsJson1.device.isOnline, false);
    assert.strictEqual(statsJson1.device.status, "unknown");
    assert.strictEqual(statsJson1.device.ipAddress, testIp);

    // 2. Pastikan POST /api/devices/[id]/ping ditolak (400) karena perangkat nonaktif
    const pingRes = await fetch(`${BASE_URL}/api/devices/${dev.id}/ping`, {
      method: "POST",
      headers: cookieHeader,
    });
    assert.strictEqual(pingRes.status, 400);
    const pingJson = await pingRes.json();
    assert.ok(pingJson.error.includes("Nonaktif"));

    // 3. Kirim syslog dari IP terdaftar ke perangkat nonaktif -> ditolak
    const accepted1 = await processRawSyslog(
      "<134>Nov 14 23:20:00 TEST_MIKROTIK_NONAKTIF_181 system,info,account user admin logged in from 10.10.10.1 via winbox",
      testIp
    );
    assert.strictEqual(accepted1, false);

    // Periksa diagnostik pada GET /api/devices/[id]/logs
    const logsRes1 = await fetch(`${BASE_URL}/api/devices/${dev.id}/logs`, { headers: cookieHeader });
    const logsJson1 = await logsRes1.json();
    assert.strictEqual(logsJson1.logs.length, 0);
    assert.strictEqual(logsJson1.ingestDiagnostics.rejections24h.nonaktif, 1);
    assert.strictEqual(logsJson1.ingestDiagnostics.lastPacket.accepted, false);
    assert.strictEqual(logsJson1.ingestDiagnostics.lastPacket.reason, "nonaktif");
    assert.strictEqual(logsJson1.ingestDiagnostics.lastPacket.sourceIp, testIp);

    // 4. Aktifkan perangkat via PATCH /api/devices/[id]
    const patchRes = await fetch(`${BASE_URL}/api/devices/${dev.id}`, {
      method: "PATCH",
      headers: cookieHeader,
      body: JSON.stringify({ isActive: true }),
    });
    assert.strictEqual(patchRes.status, 200);

    // Tunggu in-memory cache (500ms) kadaluarsa agar katalog segar
    await new Promise((r) => setTimeout(r, 600));

    // 5. Kirim syslog lagi -> diterima!
    const uniqueMarker = `LOG_MASuk_SETELAH_AKTIF_${Date.now()}`;
    const accepted2 = await processRawSyslog(
      `<134>Nov 14 23:21:00 TEST_MIKROTIK_NONAKTIF_181 system,info ${uniqueMarker}`,
      testIp
    );
    assert.strictEqual(accepted2, true);
    await flushSyslogBatch();

    // Tunggu BullMQ worker memproses ke PostgreSQL
    let storedLogs: any[] = [];
    for (let retry = 0; retry < 20; retry++) {
      storedLogs = await db
        .select()
        .from(logEvents)
        .where(and(eq(logEvents.deviceId, dev.id), ilike(logEvents.message, `%${uniqueMarker}%`)));
      if (storedLogs.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.strictEqual(storedLogs.length, 1);
    assert.deepStrictEqual((storedLogs[0].parsed as any)?.topics, ["system", "info"]);
  });

  test("3. Skenario Langkah 3 #2: Kirim dari IP tidak terdaftar -> muncul di 'Sumber tidak dikenal' (tanpa auto-register); daftarkan lewat API -> log berikutnya masuk", async () => {
    const cookieHeader = { Cookie: `jagalog_session=${adminSessionToken}`, "Content-Type": "application/json" };
    const unknownIp = "198.51.100.222";

    // Kirim 3 paket dari IP tidak terdaftar
    for (let i = 0; i < 3; i++) {
      const ok = await processRawSyslog(
        `<134>Nov 14 23:25:00 ROUTER_BARU system,info paket uji ke-${i + 1}`,
        unknownIp
      );
      assert.strictEqual(ok, false);
    }

    // Pastikan TIDAK ADA perangkat yang terdaftar otomatis di database
    const autoCheck = await db.select().from(devices).where(eq(devices.ipAddress, unknownIp));
    assert.strictEqual(autoCheck.length, 0);

    // Pastikan muncul di daftar Sumber Tidak Dikenal dengan hitungan 3
    const listBefore = await getUnknownSourcesList();
    const entry = listBefore.find((e) => e.ip === unknownIp);
    assert.ok(entry, "IP tidak terdaftar harus muncul di Sumber Tidak Dikenal");
    assert.strictEqual(entry?.count, 3);
    assert.deepStrictEqual(Object.keys(entry!).sort(), ["count", "firstSeen", "ip", "lastSeen"]);

    // Daftarkan sebagai perangkat baru melalui POST /api/devices (seperti tombol 'Daftarkan sebagai perangkat')
    const createRes = await fetch(`${BASE_URL}/api/devices`, {
      method: "POST",
      headers: cookieHeader,
      body: JSON.stringify({
        name: "ROUTER_CABANG_222",
        type: "mikrotik",
        ipAddress: unknownIp,
        pingEnabled: false,
      }),
    });
    assert.strictEqual(createRes.status, 201);
    const createJson = await createRes.json();
    createdDeviceIds.push(createJson.device.id);

    // Pastikan IP tersebut otomatis dihapus dari daftar Sumber Tidak Dikenal
    const listAfterRegister = await getUnknownSourcesList();
    assert.strictEqual(listAfterRegister.find((e) => e.ip === unknownIp), undefined);

    // Tunggu in-memory cache 500ms
    await new Promise((r) => setTimeout(r, 600));

    // Kirim syslog berikutnya dari IP tersebut -> diterima dan masuk ke database
    const marker = `LOG_DARI_IP_BARU_${Date.now()}`;
    const okNext = await processRawSyslog(
      `<134>Nov 14 23:26:00 ROUTER_CABANG_222 firewall,info ${marker}`,
      unknownIp
    );
    assert.strictEqual(okNext, true);
    await flushSyslogBatch();

    let foundLogs: any[] = [];
    for (let retry = 0; retry < 20; retry++) {
      foundLogs = await db
        .select()
        .from(logEvents)
        .where(and(eq(logEvents.deviceId, createJson.device.id), ilike(logEvents.message, `%${marker}%`)));
      if (foundLogs.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.strictEqual(foundLogs.length, 1);
  });

  test("4. Skenario Langkah 3 #3: Banjir 10.000 paket dari 500 IP acak -> daftar sumber tidak dikenal tetap <= 100 entri, memori Redis stabil, ingest perangkat lain tidak terganggu", async () => {
    const TOTAL_PACKETS = 10000;
    const UNIQUE_IPS = 500;
    const randomIps = Array.from({ length: UNIQUE_IPS }, (_, idx) => {
      const a = 198;
      const b = 18;
      const c = Math.floor(idx / 250);
      const d = (idx % 250) + 1;
      return `${a}.${b}.${c}.${d}`;
    });

    const infoBefore = await redis.info("memory");
    const memBefore = parseInt(infoBefore.match(/used_memory:(\d+)/)?.[1] || "0", 10);

    // Kirim 10.000 paket melalui processRawSyslog (menguji jalur penuh collector + cache + Redis Lua cap)
    const BATCH_SIZE = 250;
    for (let i = 0; i < TOTAL_PACKETS; i += BATCH_SIZE) {
      const promises: Promise<boolean>[] = [];
      for (let j = 0; j < BATCH_SIZE && i + j < TOTAL_PACKETS; j++) {
        const ip = randomIps[(i + j) % UNIQUE_IPS];
        promises.push(processRawSyslog(`<134>Nov 14 23:30:00 SPOOF_${j} system,info flood packet ${i + j}`, ip));
      }
      await Promise.all(promises);
    }

    const unknownList = await getUnknownSourcesList();
    assert.ok(unknownList.length <= MAX_UNKNOWN_SOURCES, `Expected <= 100 entries, got ${unknownList.length}`);
    assert.strictEqual(unknownList.length, 100);

    const hashLen = await redis.hlen("ingest:unknown_sources");
    const ttl = await redis.ttl("ingest:unknown_sources");
    assert.ok(hashLen <= 100);
    assert.ok(ttl > 0 && ttl <= 86400);

    // Pastikan tidak ada pencemaran key per-IP 'device:ip:198.18.*' di Redis
    const pollutedKeys = await redis.keys("device:ip:198.18.*");
    assert.strictEqual(pollutedKeys.length, 0);

    const infoAfter = await redis.info("memory");
    const memAfter = parseInt(infoAfter.match(/used_memory:(\d+)/)?.[1] || "0", 10);
    assert.ok(memAfter - memBefore < 2 * 1024 * 1024, `Redis memory delta too large: ${memAfter - memBefore} bytes`);

    // Pastikan ingest perangkat terdaftar yang sah tidak terganggu oleh banjir
    const legitDevId = createdDeviceIds[createdDeviceIds.length - 1];
    const [legitDev] = await db.select().from(devices).where(eq(devices.id, legitDevId));
    assert.ok(legitDev && legitDev.ipAddress);
    const floodMarker = `LOG_SAH_SAAT_BANJIR_${Date.now()}`;
    const legitAccepted = await processRawSyslog(
      `<134>Nov 14 23:31:00 ${legitDev.name} system,info ${floodMarker}`,
      legitDev.ipAddress!
    );
    assert.strictEqual(legitAccepted, true);
    await flushSyslogBatch();
    let legitStored: any[] = [];
    for (let retry = 0; retry < 20; retry++) {
      legitStored = await db
        .select()
        .from(logEvents)
        .where(and(eq(logEvents.deviceId, legitDev.id), ilike(logEvents.message, `%${floodMarker}%`)));
      if (legitStored.length > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.strictEqual(legitStored.length, 1);
  });

  test("5. Parser MikroTik RouterOS v7 mengurai format default dan syslog beserta parsed.topics & severity", () => {
    const rawSyslogV7 = "<134>Nov 14 23:10:00 SERVER181 system,info,account user admin logged in from 103.18.133.10 via winbox";
    const env1 = parseSyslogMessage(rawSyslogV7);
    const norm1 = parseLog(env1.message, rawSyslogV7, "mikrotik", env1.severity);
    assert.strictEqual(norm1.category, "auth");
    assert.strictEqual(norm1.severity, 6);
    assert.deepStrictEqual(norm1.parsed.topics, ["system", "info", "account"]);
    assert.strictEqual(norm1.parsed.actor, "admin");
    assert.strictEqual(norm1.parsed.src_ip, "103.18.133.10");

    const rawDefaultV7 = "<131>Nov 14 23:11:00 SERVER181 system,error,critical: login failure for user root from 185.220.101.7 via ssh";
    const env2 = parseSyslogMessage(rawDefaultV7);
    const norm2 = parseLog(env2.message, rawDefaultV7, "mikrotik", env2.severity);
    assert.strictEqual(norm2.category, "auth");
    assert.strictEqual(norm2.severity, 4);
    assert.deepStrictEqual(norm2.parsed.topics, ["system", "error", "critical"]);
    assert.strictEqual(norm2.parsed.actor, "root");
    assert.strictEqual(norm2.parsed.src_ip, "185.220.101.7");
    assert.strictEqual(norm2.parsed.outcome, "failure");
  });
});
