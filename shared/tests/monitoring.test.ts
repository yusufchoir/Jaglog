import { test, describe, after } from "node:test";
import assert from "node:assert";
import {
  calculateDeviceStatus,
  isDeviceOnline,
  createDeviceSchema,
} from "../src/devices";
import { encryptConfig, decryptConfig } from "../src/notifications/crypto";
import {
  calculateDeviceUptime,
  getDeviceStatusTimeline,
} from "../src/monitoring/worker";
import { queryClient } from "../src/db";
import { redis } from "../src/redis";

describe("Device Monitoring & Notification Alerting Tests", () => {
  after(async () => {
    try {
      await redis.quit();
    } catch {}
    try {
      await queryClient.end();
    } catch {}
    setTimeout(() => process.exit(0), 100);
  });

  describe("1. Device Status Calculation Matrix", () => {
    test("Device with no log and no ping returns 'unknown'", () => {
      const status = calculateDeviceStatus({
        lastSeenAt: null,
        offlineAfterMinutes: 10,
        pingEnabled: false,
        lastPingAt: null,
        lastPingOk: null,
      });
      assert.strictEqual(status, "unknown");
    });

    test("Device with no log but pingEnabled=true and successful ping returns 'online'", () => {
      const status = calculateDeviceStatus({
        lastSeenAt: null,
        offlineAfterMinutes: 10,
        pingEnabled: true,
        lastPingAt: new Date(),
        lastPingOk: true,
      });
      assert.strictEqual(status, "online");
    });

    test("Device with no log but pingEnabled=true and failed ping returns 'offline'", () => {
      const status = calculateDeviceStatus({
        lastSeenAt: null,
        offlineAfterMinutes: 10,
        pingEnabled: true,
        lastPingAt: new Date(),
        lastPingOk: false,
      });
      assert.strictEqual(status, "offline");
    });

    test("Device with log within threshold returns 'online'", () => {
      const now = new Date();
      const status = calculateDeviceStatus({
        lastSeenAt: new Date(now.getTime() - 2 * 60 * 1000), // 2 minutes ago
        offlineAfterMinutes: 10,
        pingEnabled: false,
        lastPingAt: null,
        lastPingOk: null,
      });
      assert.strictEqual(status, "online");
    });

    test("Device with expired log and pingEnabled=true with successful ping returns 'log_stopped'", () => {
      const now = new Date();
      const status = calculateDeviceStatus({
        lastSeenAt: new Date(now.getTime() - 15 * 60 * 1000), // 15 minutes ago (> 10m)
        offlineAfterMinutes: 10,
        pingEnabled: true,
        lastPingAt: new Date(now.getTime() - 30 * 1000), // ping 30s ago
        lastPingOk: true,
      });
      assert.strictEqual(status, "log_stopped");
    });

    test("Device with expired log and pingEnabled=true with failed ping returns 'offline'", () => {
      const now = new Date();
      const status = calculateDeviceStatus({
        lastSeenAt: new Date(now.getTime() - 15 * 60 * 1000), // 15 minutes ago (> 10m)
        offlineAfterMinutes: 10,
        pingEnabled: true,
        lastPingAt: new Date(now.getTime() - 30 * 1000),
        lastPingOk: false,
      });
      assert.strictEqual(status, "offline");
    });

    test("Device with expired log and pingEnabled=false returns 'offline'", () => {
      const now = new Date();
      const status = calculateDeviceStatus({
        lastSeenAt: new Date(now.getTime() - 15 * 60 * 1000),
        offlineAfterMinutes: 10,
        pingEnabled: false,
        lastPingAt: null,
        lastPingOk: null,
      });
      assert.strictEqual(status, "offline");
    });

    test("isDeviceOnline helper returns true only when within offlineAfterMinutes threshold", () => {
      const now = new Date();
      assert.strictEqual(
        isDeviceOnline(new Date(now.getTime() - 3 * 60 * 1000), 10),
        true
      );
      assert.strictEqual(
        isDeviceOnline(new Date(now.getTime() - 12 * 60 * 1000), 10),
        false
      );
      assert.strictEqual(isDeviceOnline(null, 10), false);
    });

    test("createDeviceSchema validates offlineAfterMinutes and pingEnabled fields", () => {
      const valid = createDeviceSchema.safeParse({
        name: "Router Core NOC",
        type: "mikrotik",
        ipAddress: "10.0.0.1",
        offlineAfterMinutes: 15,
        pingEnabled: true,
      });
      assert.strictEqual(valid.success, true);
      assert.strictEqual(valid.data?.offlineAfterMinutes, 15);
      assert.strictEqual(valid.data?.pingEnabled, true);

      // Default values
      const defaultCheck = createDeviceSchema.safeParse({
        name: "Switch Kantor",
        type: "switch",
      });
      assert.strictEqual(defaultCheck.success, true);
      assert.strictEqual(defaultCheck.data?.offlineAfterMinutes, 10);
      assert.strictEqual(defaultCheck.data?.pingEnabled, false);
    });
  });

  describe("2. AES-256-GCM Notification Credential Encryption", () => {
    test("Encrypts and decrypts Telegram configuration accurately", () => {
      const config = {
        botToken: "7123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_123456",
        chatId: "-1001928374650",
      };

      const encrypted = encryptConfig(config);
      assert.notStrictEqual(encrypted, JSON.stringify(config));
      assert.ok(encrypted.includes(":"), "Encrypted string contains IV and authTag delimiter");

      const decrypted = decryptConfig<typeof config>(encrypted);
      assert.deepStrictEqual(decrypted, config);
    });

    test("Encrypts and decrypts Email SMTP configuration accurately", () => {
      const emailConfig = {
        host: "smtp.mailgun.org",
        port: 587,
        auth: {
          user: "postmaster@jagalog.local",
          pass: "secret_password_123!@#",
        },
        from: "alerts@jagalog.local",
        to: "noc-alerts@perusahaan.co.id",
      };

      const encrypted = encryptConfig(emailConfig);
      const decrypted = decryptConfig<typeof emailConfig>(encrypted);
      assert.deepStrictEqual(decrypted, emailConfig);
    });

    test("Decryption fails on tampered ciphertext", () => {
      const config = { key: "secret_value" };
      const encrypted = encryptConfig(config);
      const parts = encrypted.split(":");
      parts[2] = parts[2].slice(0, -4) + "ffff"; // tamper ciphertext

      assert.throws(() => {
        decryptConfig(parts.join(":"));
      });
    });
  });

  describe("3. Uptime and 7-day Timeline Calculations", () => {
    test("calculateDeviceUptime returns 100% when no offline incidents", async () => {
      const dummyId = crypto.randomUUID();
      const uptime = await calculateDeviceUptime(dummyId);
      assert.ok(typeof uptime.uptime24h === "number");
      assert.ok(typeof uptime.uptime7d === "number");
      assert.strictEqual(uptime.uptime24h, 100);
      assert.strictEqual(uptime.uptime7d, 100);
    });

    test("getDeviceStatusTimeline returns exactly 42 slots covering 7 days", async () => {
      const dummyId = crypto.randomUUID();
      const timeline = await getDeviceStatusTimeline(dummyId);
      assert.strictEqual(timeline.length, 42);
      for (const slot of timeline) {
        assert.ok(slot.start);
        assert.ok(slot.end);
        assert.ok(["online", "log_stopped", "offline", "unknown"].includes(slot.status));
      }
    });
  });
});
