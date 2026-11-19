import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import {
  createDeviceSchema,
  generateIngestToken,
  hashIngestToken,
  verifyIngestToken,
  isDeviceOnline,
} from "../src/devices";
import { db, queryClient } from "../src/db";
import { devices } from "../src/schema";
import { eq } from "drizzle-orm";

describe("Phase 3: Devices Management & Ingest Token Tests", () => {
  const testPrefix = "test_p3_" + Date.now();
  let createdDeviceIds: string[] = [];

  after(async () => {
    // Bersihkan perangkat uji coba
    for (const id of createdDeviceIds) {
      await db.delete(devices).where(eq(devices.id, id));
    }
    await queryClient.end();
  });

  test("1. Zod Validation for Device Creation", () => {
    // Valid input
    const valid = createDeviceSchema.safeParse({
      name: "MikroTik Core Router",
      type: "mikrotik",
      ipAddress: "192.168.1.1",
      location: "Gedung Cyber Lt. 3",
      notes: "Router BGP",
    });
    assert.strictEqual(valid.success, true);

    // Valid without IP (token based)
    const validNoIp = createDeviceSchema.safeParse({
      name: "Windows Server AD",
      type: "windows",
      ipAddress: "",
    });
    assert.strictEqual(validNoIp.success, true);
    assert.strictEqual(validNoIp.data?.ipAddress, null);

    // Invalid: Name too short
    const shortName = createDeviceSchema.safeParse({
      name: "A",
      type: "linux",
    });
    assert.strictEqual(shortName.success, false);
    assert.ok(shortName.error?.errors[0]?.message.includes("minimal 2 karakter"));

    // Invalid: Bad IP format
    const badIp = createDeviceSchema.safeParse({
      name: "Linux Web",
      type: "linux",
      ipAddress: "999.999.999.999",
    });
    assert.strictEqual(badIp.success, false);
    assert.ok(badIp.error?.errors[0]?.message.includes("tidak valid"));

    // Invalid: Bad Type enum
    const badType = createDeviceSchema.safeParse({
      name: "Unknown Device",
      type: "invalid_type",
    });
    assert.strictEqual(badType.success, false);
  });

  test("2. Ingest Token generation, SHA-256 hashing and timing-safe verification", () => {
    const rawToken = generateIngestToken();
    assert.strictEqual(rawToken.length, 64, "32 bytes hex should be 64 characters");

    const tokenHash = hashIngestToken(rawToken);
    assert.strictEqual(tokenHash.length, 64, "SHA-256 hash hex should be 64 characters");

    // Verification match
    const isValid = verifyIngestToken(rawToken, tokenHash);
    assert.strictEqual(isValid, true, "Valid raw token should match stored hash");

    // Verification mismatch
    const isMismatch = verifyIngestToken("wrong_token_value", tokenHash);
    assert.strictEqual(isMismatch, false, "Invalid raw token should fail match");
  });

  test("3. Device online status calculation (<10 minutes)", () => {
    // Seen 2 minutes ago -> Online
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    assert.strictEqual(isDeviceOnline(twoMinutesAgo), true);

    // Seen 15 minutes ago -> Offline
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    assert.strictEqual(isDeviceOnline(fifteenMinutesAgo), false);

    // Never seen -> Offline
    assert.strictEqual(isDeviceOnline(null), false);
    assert.strictEqual(isDeviceOnline(undefined), false);
  });

  test("4. CRUD Operations: Create 3 devices (MikroTik, Windows, Linux), update, and deactivate", async () => {
    // 1. Tambah MikroTik
    const mikrotikToken = generateIngestToken();
    const [mikrotik] = await db
      .insert(devices)
      .values({
        name: `${testPrefix}_MikroTik_CCR`,
        type: "mikrotik",
        ipAddress: `10.200.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
        location: "Rack Server 1",
        ingestTokenHash: hashIngestToken(mikrotikToken),
        isActive: true,
      })
      .returning();
    createdDeviceIds.push(mikrotik.id);
    assert.ok(mikrotik.id);
    assert.strictEqual(mikrotik.type, "mikrotik");

    // 2. Tambah Windows
    const windowsToken = generateIngestToken();
    const [windows] = await db
      .insert(devices)
      .values({
        name: `${testPrefix}_Win_Server`,
        type: "windows",
        ipAddress: null, // token based
        location: "Virtual Machine",
        ingestTokenHash: hashIngestToken(windowsToken),
        isActive: true,
      })
      .returning();
    createdDeviceIds.push(windows.id);
    assert.ok(windows.id);
    assert.strictEqual(windows.type, "windows");

    // 3. Tambah Linux
    const linuxToken = generateIngestToken();
    const [linux] = await db
      .insert(devices)
      .values({
        name: `${testPrefix}_Linux_Bastion`,
        type: "linux",
        ipAddress: `10.201.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}`,
        location: "Cloud DMZ",
        ingestTokenHash: hashIngestToken(linuxToken),
        isActive: true,
      })
      .returning();
    createdDeviceIds.push(linux.id);
    assert.ok(linux.id);
    assert.strictEqual(linux.type, "linux");

    // 4. Ubah salah satu perangkat (Linux: update nama & lokasi)
    const [updatedLinux] = await db
      .update(devices)
      .set({
        name: `${testPrefix}_Linux_Bastion_Prod`,
        location: "Cloud DMZ AWS",
      })
      .where(eq(devices.id, linux.id))
      .returning();
    assert.strictEqual(updatedLinux.name, `${testPrefix}_Linux_Bastion_Prod`);
    assert.strictEqual(updatedLinux.location, "Cloud DMZ AWS");

    // 5. Nonaktifkan salah satu perangkat (MikroTik)
    const [deactivatedMikrotik] = await db
      .update(devices)
      .set({ isActive: false })
      .where(eq(devices.id, mikrotik.id))
      .returning();
    assert.strictEqual(deactivatedMikrotik.isActive, false, "Device should be marked inactive");

    // 6. Regenerate Token (Windows): Hash baru harus tersimpan
    const newWindowsToken = generateIngestToken();
    const newWindowsHash = hashIngestToken(newWindowsToken);
    await db
      .update(devices)
      .set({ ingestTokenHash: newWindowsHash })
      .where(eq(devices.id, windows.id));

    const [refetchedWindows] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, windows.id));
    assert.strictEqual(refetchedWindows.ingestTokenHash, newWindowsHash);
    assert.strictEqual(verifyIngestToken(newWindowsToken, refetchedWindows.ingestTokenHash!), true);
    assert.strictEqual(verifyIngestToken(windowsToken, refetchedWindows.ingestTokenHash!), false);
  });
});
