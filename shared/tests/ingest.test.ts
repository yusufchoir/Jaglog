import { test, describe, after } from "node:test";
import assert from "node:assert";
import { parseSyslogMessage } from "../../collector/src/syslog";
import { checkDeviceIngestRateLimit } from "../../collector/src/cache";
import { redis } from "../src/redis";

describe("Phase 4: Syslog Parser, Framing & Ingest Rate Limit Tests", () => {
  after(async () => {
    await redis.quit();
  });

  test("1. Parsing RFC 3164 (BSD Syslog format)", () => {
    // Facility 1 (user), Severity 5 (notice) -> (1*8) + 5 = 13
    const rawBsd = "<13>Nov  2 17:00:15 mikrotik-router system: user admin logged in from 192.168.1.50 via ssh";
    const parsed = parseSyslogMessage(rawBsd);

    assert.strictEqual(parsed.facility, 1);
    assert.strictEqual(parsed.severity, 5);
    assert.strictEqual(parsed.sourceApp, "system");
    assert.strictEqual(parsed.message, "user admin logged in from 192.168.1.50 via ssh");
    assert.ok(parsed.timestamp instanceof Date);
  });

  test("2. Parsing RFC 5424 (IETF Syslog format)", () => {
    // Facility 4 (auth), Severity 3 (error) -> (4*8) + 3 = 35
    const rawRfc5424 = "<35>1 2026-11-02T17:05:00.000Z myhost sshd 1234 ID47 - Failed password for invalid user root";
    const parsed = parseSyslogMessage(rawRfc5424);

    assert.strictEqual(parsed.facility, 4);
    assert.strictEqual(parsed.severity, 3);
    assert.strictEqual(parsed.sourceApp, "sshd");
    assert.strictEqual(parsed.message, "Failed password for invalid user root");
    assert.strictEqual(parsed.timestamp.toISOString(), "2026-11-02T17:05:00.000Z");
  });

  test("3. Fallback for raw non-standard syslog message", () => {
    const rawPlain = "Just a raw message without priority tags";
    const parsed = parseSyslogMessage(rawPlain);

    assert.strictEqual(parsed.severity, 6, "Default severity should be 6 (info)");
    assert.strictEqual(parsed.facility, 1, "Default facility should be 1 (user)");
    assert.strictEqual(parsed.message, rawPlain);
  });

  test("4. Rate limiting per device (2000 messages/second)", async () => {
    const testDeviceId = "dev-rate-limit-test-" + Date.now();

    // 2000 pesan pertama harus diizinkan
    const firstCheck = await checkDeviceIngestRateLimit(testDeviceId, 5);
    assert.strictEqual(firstCheck, true);

    for (let i = 2; i <= 5; i++) {
      await checkDeviceIngestRateLimit(testDeviceId, 5);
    }

    // Pesan ke-6 dalam detik yang sama harus diblokir
    const sixthCheck = await checkDeviceIngestRateLimit(testDeviceId, 5);
    assert.strictEqual(sixthCheck, false, "Rate limit should block messages exceeding threshold");
  });
});
