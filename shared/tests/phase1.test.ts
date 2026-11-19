import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, queryClient } from "../src/db";
import { redis } from "../src/redis";
import { users, settings, devices, logEvents } from "../src/schema";
import { hash, verify } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { runRetentionCleanup } from "../src/cleaner";

describe("Phase 1: Foundation & Database Tests", () => {
  before(async () => {
    // Ensure DB and Redis are reachable
    await queryClient`SELECT 1`;
    const ping = await redis.ping();
    assert.equal(ping, "PONG");
  });

  after(async () => {
    await queryClient.end();
    redis.disconnect();
  });

  it("should have seeded admin user with argon2id hash", async () => {
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, "admin"));

    assert.ok(adminUser, "Admin user must exist");
    assert.equal(adminUser.role, "admin");
    // Verify argon2id hash (matches initial or changed password)
    const matchesInitial = await verify(adminUser.passwordHash, "JagaLogAdmin123!");
    const matchesChanged = await verify(adminUser.passwordHash, "JagaLogBaru2026!");
    assert.equal(matchesInitial || matchesChanged, true, "Admin password hash must match initial or changed password");
  });

  it("should have seeded initial system settings", async () => {
    const allSettings = await db.select().from(settings);
    const keys = allSettings.map((s) => s.key);

    assert.ok(keys.includes("log_retention_days"));
    assert.ok(keys.includes("ip_allowlist"));
    assert.ok(keys.includes("detection_thresholds"));
    assert.ok(keys.includes("ai_analysis_hourly_limit"));
  });

  it("should enforce unique constraint on device ip_address", async () => {
    const testIp = "192.168.99.100";
    // Clean up any test device first
    await db.delete(devices).where(eq(devices.ipAddress, testIp));

    // Insert first device
    const [d1] = await db
      .insert(devices)
      .values({
        name: "Test Router 1",
        type: "mikrotik",
        ipAddress: testIp,
      })
      .returning();

    assert.ok(d1.id);

    // Attempt insert duplicate IP should throw
    await assert.rejects(async () => {
      await db.insert(devices).values({
        name: "Test Router 2",
        type: "mikrotik",
        ipAddress: testIp,
      });
    });

    // Cleanup
    await db.delete(devices).where(eq(devices.id, d1.id));
  });

  it("should support log retention cleanup logic", async () => {
    const result = await runRetentionCleanup();
    assert.equal(typeof result.deletedCount, "number");
    assert.ok(result.cutoffDate instanceof Date);
  });
});
