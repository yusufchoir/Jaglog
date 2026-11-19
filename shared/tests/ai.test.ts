import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db, queryClient } from "../src/db";
import { redis } from "../src/redis";
import { devices, incidents, logEvents, aiAnalyses } from "../src/schema";
import { eq } from "drizzle-orm";
import {
  maskSensitiveData,
  aiAnalysisOutputSchema,
  analyzeIncident,
  analyzeDeviceDaily,
  MockProvider,
} from "../src/ai";

describe("Phase 7: AI Security Analysis & Daily Summary Tests", () => {
  let testDeviceId: string;
  let testIncidentId: string;

  before(async () => {
    // Reset rate limit key in Redis untuk pengujian unit
    await redis.del("ratelimit:ai:calls:hourly");

    // 1. Buat perangkat uji
    const [dev] = await db
      .insert(devices)
      .values({
        name: "MikroTik-Lab-AI",
        type: "mikrotik",
        ipAddress: "192.168.1.1",
        isActive: true,
      })
      .returning({ id: devices.id });

    testDeviceId = dev.id;

    // 2. Buat insiden uji
    const [inc] = await db
      .insert(incidents)
      .values({
        deviceId: testDeviceId,
        ruleKey: "brute_force_login",
        severity: "high",
        title: "Percobaan Brute Force Login dari IP 203.0.113.195",
        firstSeen: new Date(Date.now() - 300000),
        lastSeen: new Date(),
        count: 14,
        status: "open",
        mainEntity: "203.0.113.195",
      })
      .returning({ id: incidents.id });

    testIncidentId = inc.id;

    // 3. Suntik sampel log
    await db.insert(logEvents).values([
      {
        deviceId: testDeviceId,
        receivedAt: new Date(),
        eventTime: new Date(),
        severity: 4,
        facility: 1,
        sourceApp: "ssh",
        category: "auth",
        message: "login failure for user admin from 203.0.113.195 via ssh password=secret123",
        raw: "login failure for user admin from 203.0.113.195 via ssh password=secret123",
        parsed: {
          action: "login",
          outcome: "failure",
          actor: "admin",
          src_ip: "203.0.113.195",
        },
      },
    ]);
  });

  after(async () => {
    if (testDeviceId) {
      await db.delete(aiAnalyses).where(eq(aiAnalyses.deviceId, testDeviceId));
      await db.delete(incidents).where(eq(incidents.deviceId, testDeviceId));
      await db.delete(logEvents).where(eq(logEvents.deviceId, testDeviceId));
      await db.delete(devices).where(eq(devices.id, testDeviceId));
    }
    await queryClient.end();
    redis.disconnect();
  });

  test("1. Sensitive Data Masking (Passwords, Tokens, Keys, Hashes)", () => {
    // A. Password masking
    const logWithPass = "user=admin password=SecretPassword123! from 1.2.3.4";
    const maskedPass = maskSensitiveData(logWithPass);
    assert.ok(!maskedPass.includes("SecretPassword123!"));
    assert.ok(maskedPass.includes("[MASKED_PASSWORD]"));

    // B. Bearer Token masking
    const logWithToken = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz123";
    const maskedToken = maskSensitiveData(logWithToken);
    assert.ok(!maskedToken.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"));
    assert.ok(maskedToken.includes("[MASKED_TOKEN]"));

    // C. API Key masking
    const logWithKey = "API request failed: api_key=sk_live_1234567890abcdef123456";
    const maskedKey = maskSensitiveData(logWithKey);
    assert.ok(!maskedKey.includes("sk_live_1234567890abcdef123456"));
    assert.ok(maskedKey.includes("[MASKED_API_KEY]"));

    // D. Hash masking (Argon2 / SHA256)
    const logWithArgon = "Stored hash: $argon2id$v=19$m=65536,t=3,p=4$abc...xyz";
    const maskedArgon = maskSensitiveData(logWithArgon);
    assert.ok(!maskedArgon.includes("$argon2id$"));
    assert.ok(maskedArgon.includes("[MASKED_ARGON2_HASH]"));

    // E. Preserve UUID & IP addresses (jangan dimasker)
    const logWithUuidIp = "Device 18462e43-008c-4b54-97e5-8aa8c4ef18da connected from 192.168.1.1";
    const preserved = maskSensitiveData(logWithUuidIp);
    assert.ok(preserved.includes("18462e43-008c-4b54-97e5-8aa8c4ef18da"));
    assert.ok(preserved.includes("192.168.1.1"));
  });

  test("2. Zod Schema Validation for AI Output", () => {
    const validOutput = {
      risk_level: "high",
      summary: "Terdeteksi percobaan login berulang dari IP eksternal. Pola menunjukkan serangan kamus brute force. Disarankan memblokir IP pada firewall.",
      suspected_attack: "SSH Brute Force",
      confidence: "tinggi",
      findings: [
        {
          title: "Brute Force Authentication",
          explanation: "Frekuensi kegagalan autentikasi tinggi dalam durasi 5 menit.",
          evidence_event_ids: ["ev-1", "ev-2"],
        },
      ],
      recommendations: [
        {
          priority: 1,
          action: "Blokir IP di Firewall",
          reason: "Mencegah serangan lebih lanjut",
          device_specific_command: "/ip firewall filter add chain=input src-address=203.0.113.195 action=drop",
        },
      ],
    };

    const parsed = aiAnalysisOutputSchema.safeParse(validOutput);
    assert.strictEqual(parsed.success, true);

    // Invalid risk_level
    const invalidRisk = { ...validOutput, risk_level: "extreme_danger" };
    assert.strictEqual(aiAnalysisOutputSchema.safeParse(invalidRisk).success, false);

    // Invalid priority (> 5)
    const invalidPriority = {
      ...validOutput,
      recommendations: [{ priority: 10, action: "test", reason: "test" }],
    };
    assert.strictEqual(aiAnalysisOutputSchema.safeParse(invalidPriority).success, false);
  });

  test("3. Mock AI Provider Conformance", async () => {
    const provider = new MockProvider();
    assert.strictEqual(provider.name, "mock");

    const raw = await provider.generateText("system prompt", "brute_force login from 203.0.113.195 on mikrotik");
    const json = JSON.parse(raw);
    const validated = aiAnalysisOutputSchema.safeParse(json);

    assert.strictEqual(validated.success, true);
    assert.ok(validated.data?.recommendations[0]?.device_specific_command?.includes("/ip firewall"));
  });

  test("4. Incident Analysis Persistence & Redis Caching", async () => {
    // Eksekusi analisa pada insiden uji
    const res = await analyzeIncident(testIncidentId, true);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.incidentId, testIncidentId);
    assert.ok(res.data.summary);
    assert.ok(res.data.riskLevel);
    assert.ok(Array.isArray(res.data.findings));
    assert.ok(Array.isArray(res.data.recommendations));

    // Verifikasi row tersimpan di PostgreSQL
    const [savedInDb] = await db
      .select()
      .from(aiAnalyses)
      .where(eq(aiAnalyses.incidentId, testIncidentId))
      .limit(1);

    assert.ok(savedInDb);
    assert.strictEqual(savedInDb.id, res.data.id);

    // Panggilan kedua tanpa 'force': Harus mengambil dari Redis cache
    const cachedRes = await analyzeIncident(testIncidentId, false);
    assert.strictEqual(cachedRes.success, true);
    assert.strictEqual(cachedRes.data.id, res.data.id);
  });

  test("5. Device Daily Summary Generation", async () => {
    const res = await analyzeDeviceDaily(testDeviceId);
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data.deviceId, testDeviceId);
    assert.ok(res.data.summary);
  });
});
