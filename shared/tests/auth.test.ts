import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import {
  hash,
  verify,
  createSession,
  getSession,
  destroySession,
  updateSessionData,
  checkRateLimit,
  recordFailedLogin,
  resetLoginAttempts,
  authenticateUser,
  MAX_LOGIN_ATTEMPTS,
} from "../src/auth";
import { redis } from "../src/redis";
import { queryClient } from "../src/db";

describe("Phase 2: Authentication, Session & Security Tests", () => {
  const testIp = "192.168.100.55";
  const testUsername = "secops_tester";

  before(async () => {
    // Reset rate limit key for test
    await resetLoginAttempts(testIp, testUsername);
  });

  after(async () => {
    await resetLoginAttempts(testIp, testUsername);
    await redis.quit();
    await queryClient.end();
  });

  test("1. Argon2id password hashing and verification", async () => {
    const rawPassword = "SuperSecurePassword123!";
    const passwordHash = await hash(rawPassword);

    assert.ok(passwordHash.startsWith("$argon2id$"), "Hash should use argon2id algorithm");

    const isMatch = await verify(passwordHash, rawPassword);
    assert.strictEqual(isMatch, true, "Valid password should verify successfully");

    const isWrongMatch = await verify(passwordHash, "WrongPassword");
    assert.strictEqual(isWrongMatch, false, "Invalid password should fail verification");
  });

  test("2. Redis session lifecycle (create, read, update, destroy)", async () => {
    const sessionPayload = {
      userId: "11111111-2222-3333-4444-555555555555",
      username: "admin_test",
      role: "admin" as const,
      mustChangePassword: true,
      createdAt: Date.now(),
    };

    const token = await createSession(sessionPayload);
    assert.ok(token && token.length >= 32, "Session token must be secure string");

    const fetched = await getSession(token);
    assert.ok(fetched, "Session should be found in Redis");
    assert.strictEqual(fetched?.username, "admin_test");
    assert.strictEqual(fetched?.role, "admin");
    assert.strictEqual(fetched?.mustChangePassword, true);

    // Update session (e.g. after password change)
    await updateSessionData(token, { mustChangePassword: false });
    const updated = await getSession(token);
    assert.strictEqual(updated?.mustChangePassword, false, "Session update should reflect in Redis");

    // Destroy session
    await destroySession(token);
    const deleted = await getSession(token);
    assert.strictEqual(deleted, null, "Session should be null after destruction");
  });

  test("3. Login rate limiting: 5 failed attempts allowed, 6th is blocked", async () => {
    await resetLoginAttempts(testIp, testUsername);

    // Initial state: 5 remaining
    const initialCheck = await checkRateLimit(testIp, testUsername);
    assert.strictEqual(initialCheck.allowed, true);
    assert.strictEqual(initialCheck.remainingAttempts, MAX_LOGIN_ATTEMPTS);

    // Record 5 failed attempts
    for (let i = 1; i <= 5; i++) {
      const attempts = await recordFailedLogin(testIp, testUsername);
      assert.strictEqual(attempts, i);
    }

    // 6th attempt: should be blocked
    const blockedCheck = await checkRateLimit(testIp, testUsername);
    assert.strictEqual(blockedCheck.allowed, false, "Rate limit must block further attempts after 5 failures");
    assert.strictEqual(blockedCheck.remainingAttempts, 0);
    assert.ok(blockedCheck.retryAfterSeconds > 0, "Must provide retry-after countdown in seconds");

    // Reset attempts (e.g. after admin reset or successful login)
    await resetLoginAttempts(testIp, testUsername);
    const resetCheck = await checkRateLimit(testIp, testUsername);
    assert.strictEqual(resetCheck.allowed, true, "Attempts should be reset to allowed");
    assert.strictEqual(resetCheck.remainingAttempts, MAX_LOGIN_ATTEMPTS);
  });

  test("4. User authentication with seeded admin account", async () => {
    const adminUser = process.env.ADMIN_USERNAME || "admin";
    const adminPass = process.env.ADMIN_PASSWORD || "JagaLogAdmin123!";

    let result = await authenticateUser(adminUser, "JagaLogBaru2026!");
    if (!result.success) {
      result = await authenticateUser(adminUser, adminPass);
    }
    assert.strictEqual(result.success, true, "Seeded admin should authenticate successfully");
    if (result.success) {
      assert.strictEqual(result.user.username, adminUser);
      assert.strictEqual(result.user.role, "admin");
    }

    const badResult = await authenticateUser(adminUser, "WrongPasswordHere");
    assert.strictEqual(badResult.success, false);
    if (!badResult.success) {
      assert.strictEqual(badResult.reason, "wrong_password");
    }
  });
});
