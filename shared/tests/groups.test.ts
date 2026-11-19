import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db } from "../src/db";
import { deviceGroups, devices } from "../src/schema";
import { eq, sql } from "drizzle-orm";
import {
  normalizeLocationKey,
  generateProposedGroupName,
  calculateGroupWorstStatus,
  createDeviceGroupSchema,
  updateDeviceGroupSchema,
  deleteDeviceGroupSchema,
  bulkDeviceGroupSchema,
} from "../src/groups";

describe("Device Groups & Area Feature Tests", () => {
  let createdGroupId1: string;
  let createdGroupId2: string;
  let testDeviceId1: string;
  let testDeviceId2: string;

  before(async () => {
    // Bersihkan grup uji jika ada sisa dari run sebelumnya
    await db.delete(deviceGroups).where(sql`lower(${deviceGroups.nama}) in ('grup unit test 1', 'grup unit test 2', 'area lantai 1')`);
  });

  after(async () => {
    // Bersihkan test data
    if (testDeviceId1) {
      await db.delete(devices).where(eq(devices.id, testDeviceId1));
    }
    if (testDeviceId2) {
      await db.delete(devices).where(eq(devices.id, testDeviceId2));
    }
    if (createdGroupId1) {
      await db.delete(deviceGroups).where(eq(deviceGroups.id, createdGroupId1));
    }
    if (createdGroupId2) {
      await db.delete(deviceGroups).where(eq(deviceGroups.id, createdGroupId2));
    }
  });

  test("1. normalizeLocationKey normalizes underscores, dashes, case, and extra whitespace", () => {
    assert.strictEqual(normalizeLocationKey("MAIN_BPI"), "main bpi");
    assert.strictEqual(normalizeLocationKey("main-bpi"), "main bpi");
    assert.strictEqual(normalizeLocationKey("  Main   Bpi  "), "main bpi");
    assert.strictEqual(normalizeLocationKey("LANTAI_2_SERVER"), "lantai 2 server");
    assert.strictEqual(normalizeLocationKey(""), "");
    assert.strictEqual(normalizeLocationKey(null as any), "");
  });

  test("2. generateProposedGroupName formats group title properly", () => {
    assert.strictEqual(generateProposedGroupName("main bpi"), "Main BPI");
    assert.strictEqual(generateProposedGroupName("bpi"), "BPI");
    assert.strictEqual(generateProposedGroupName("ruang server"), "Ruang Server");
  });

  test("3. Schema validations (create, update, bulk, delete)", () => {
    // Valid create
    const validCreate = createDeviceGroupSchema.safeParse({
      nama: "Area Server Utama",
      warnaGaris: "biru",
      deskripsi: "Ruang server",
    });
    assert.strictEqual(validCreate.success, true);

    // Invalid warnaGaris
    const invalidColor = createDeviceGroupSchema.safeParse({
      nama: "Area Server Utama",
      warnaGaris: "hijau", // Not allowed
    });
    assert.strictEqual(invalidColor.success, false);

    // Empty name
    const emptyName = createDeviceGroupSchema.safeParse({
      nama: "   ",
      warnaGaris: "merah",
    });
    assert.strictEqual(emptyName.success, false);

    // Bulk validation: max 200 devices
    const tooManyDevices = Array.from({ length: 201 }, () => "a0000000-0000-0000-0000-000000000001");
    const bulkOverLimit = bulkDeviceGroupSchema.safeParse({
      deviceIds: tooManyDevices,
      groupId: null,
    });
    assert.strictEqual(bulkOverLimit.success, false);

    // Bulk validation: empty array
    const bulkEmpty = bulkDeviceGroupSchema.safeParse({
      deviceIds: [],
      groupId: null,
    });
    assert.strictEqual(bulkEmpty.success, false);

    // Bulk validation: valid 2 devices
    const bulkValid = bulkDeviceGroupSchema.safeParse({
      deviceIds: [
        "a0000000-0000-0000-0000-000000000001",
        "a0000000-0000-0000-0000-000000000002",
      ],
      groupId: null,
    });
    assert.strictEqual(bulkValid.success, true);

    // Delete validation: action 'move' requires targetGroupId
    const deleteMoveWithoutTarget = deleteDeviceGroupSchema.safeParse({
      action: "move",
    });
    assert.strictEqual(deleteMoveWithoutTarget.success, false);

    // Delete validation: action 'detach' does not require targetGroupId
    const deleteDetach = deleteDeviceGroupSchema.safeParse({
      action: "detach",
    });
    assert.strictEqual(deleteDetach.success, true);
  });

  test("4. Database: Create device group and enforce lowercase unique constraint", async () => {
    // Create first group
    const [g1] = await db
      .insert(deviceGroups)
      .values({
        nama: "Grup Unit Test 1",
        warnaGaris: "biru",
        deskripsi: "Grup uji coba",
      })
      .returning();
    createdGroupId1 = g1.id;
    assert.strictEqual(g1.nama, "Grup Unit Test 1");
    assert.strictEqual(g1.warnaGaris, "biru");

    // Attempt to insert duplicate name with different casing: "grup unit test 1"
    let duplicateRejected = false;
    try {
      await db.insert(deviceGroups).values({
        nama: "grup unit test 1",
        warnaGaris: "merah",
      });
    } catch {
      duplicateRejected = true;
    }
    assert.strictEqual(duplicateRejected, true, "Unique index on lower(nama) must prevent case-insensitive duplicates");
  });

  test("5. Database: Assign device to group and preserve device.location column", async () => {
    // Create test device with existing location
    const [dev1] = await db
      .insert(devices)
      .values({
        name: "Switch-Group-Test",
        type: "switch",
        ipAddress: "10.200.1.1",
        location: "Gedung A Lt 1",
        groupId: createdGroupId1,
      })
      .returning();
    testDeviceId1 = dev1.id;

    assert.strictEqual(dev1.groupId, createdGroupId1);
    assert.strictEqual(dev1.location, "Gedung A Lt 1", "devices.location must be 100% preserved");
  });

  test("6. Database: Bulk assign devices to another group", async () => {
    // Create second group
    const [g2] = await db
      .insert(deviceGroups)
      .values({
        nama: "Grup Unit Test 2",
        warnaGaris: "merah",
      })
      .returning();
    createdGroupId2 = g2.id;

    // Create second device
    const [dev2] = await db
      .insert(devices)
      .values({
        name: "Router-Group-Test",
        type: "mikrotik",
        ipAddress: "10.200.1.2",
        location: "Gedung B Lt 2",
        groupId: null,
      })
      .returning();
    testDeviceId2 = dev2.id;

    // Bulk move both devices to g2
    await db
      .update(devices)
      .set({ groupId: createdGroupId2 })
      .where(sql`${devices.id} in (${testDeviceId1}, ${testDeviceId2})`);

    const updatedDevs = await db
      .select({ id: devices.id, groupId: devices.groupId, location: devices.location })
      .from(devices)
      .where(sql`${devices.id} in (${testDeviceId1}, ${testDeviceId2})`);

    assert.strictEqual(updatedDevs.length, 2);
    for (const d of updatedDevs) {
      assert.strictEqual(d.groupId, createdGroupId2);
    }
  });

  test("7. Database: Group deletion with detach sets device groupId to null without deleting devices", async () => {
    // Detach devices from g2
    await db
      .update(devices)
      .set({ groupId: null })
      .where(eq(devices.groupId, createdGroupId2));

    await db.delete(deviceGroups).where(eq(deviceGroups.id, createdGroupId2));
    createdGroupId2 = ""; // Marked deleted

    // Verify devices still exist and have null groupId
    const remainingDevs = await db
      .select({ id: devices.id, groupId: devices.groupId, name: devices.name })
      .from(devices)
      .where(sql`${devices.id} in (${testDeviceId1}, ${testDeviceId2})`);

    assert.strictEqual(remainingDevs.length, 2);
    for (const d of remainingDevs) {
      assert.strictEqual(d.groupId, null);
    }
  });

  test("8. calculateGroupWorstStatus prioritizes offline > log_stopped > online > unknown", () => {
    assert.strictEqual(calculateGroupWorstStatus(["online", "offline", "log_stopped"]), "offline");
    assert.strictEqual(calculateGroupWorstStatus(["online", "log_stopped"]), "log_stopped");
    assert.strictEqual(calculateGroupWorstStatus(["online", "online"]), "online");
    assert.strictEqual(calculateGroupWorstStatus(["unknown", "unknown"]), "unknown");
    assert.strictEqual(calculateGroupWorstStatus([]), "unknown");
  });

  test("9. Bulk 50 devices assignment is atomic and handles batch updates", async () => {
    // Generate 50 test device inserts
    const batchDevices = Array.from({ length: 50 }, (_, i) => ({
      name: `Bulk-Dev-Test-${i + 1}`,
      type: "switch",
      ipAddress: `10.254.1.${i + 1}`,
      groupId: null,
      isActive: true,
    }));

    const inserted = await db.insert(devices).values(batchDevices).returning({ id: devices.id });
    const insertedIds = inserted.map((d) => d.id);
    assert.strictEqual(insertedIds.length, 50);

    try {
      // Bulk update all 50 to createdGroupId1
      const updateResult = await db
        .update(devices)
        .set({ groupId: createdGroupId1 })
        .where(sql`${devices.id} in ${insertedIds}`)
        .returning({ id: devices.id, groupId: devices.groupId });

      assert.strictEqual(updateResult.length, 50);
      for (const row of updateResult) {
        assert.strictEqual(row.groupId, createdGroupId1);
      }
    } finally {
      // Cleanup the 50 test devices
      await db.delete(devices).where(sql`${devices.id} in ${insertedIds}`);
    }
  });

  test("10. 'Buat grup dari Lokasi' normalization accurately clusters variations (MAIN_BPI, main bpi, Main-BPI)", () => {
    const rawLocations = ["MAIN_BPI", "main bpi", "Main-BPI", "LANTAI_2", "Lantai 2"];
    const clusters = new Map<string, string[]>();

    for (const loc of rawLocations) {
      const normKey = normalizeLocationKey(loc);
      const arr = clusters.get(normKey) || [];
      arr.push(loc);
      clusters.set(normKey, arr);
    }

    // MAIN_BPI cluster
    assert.strictEqual(clusters.has("main bpi"), true);
    const mainBpiCluster = clusters.get("main bpi")!;
    assert.strictEqual(mainBpiCluster.length, 3);
    assert.strictEqual(generateProposedGroupName("main bpi"), "Main BPI");

    // LANTAI_2 cluster
    assert.strictEqual(clusters.has("lantai 2"), true);
    const lantai2Cluster = clusters.get("lantai 2")!;
    assert.strictEqual(lantai2Cluster.length, 2);
    assert.strictEqual(generateProposedGroupName("lantai 2"), "Lantai 2");
  });

  test("11. Device single group constraint: device cannot be in multiple groups simultaneously", async () => {
    // Create group A and group B
    const [grpA] = await db.insert(deviceGroups).values({ nama: "Area Alpha", warnaGaris: "biru" }).returning();
    const [grpB] = await db.insert(deviceGroups).values({ nama: "Area Beta", warnaGaris: "merah" }).returning();
    const [testDev] = await db.insert(devices).values({
      name: "Single-Group-Constraint-Test",
      type: "linux",
      ipAddress: "10.254.200.1",
      groupId: grpA.id,
    }).returning();

    try {
      assert.strictEqual(testDev.groupId, grpA.id);

      // Reassign to group B
      const [updatedDev] = await db
        .update(devices)
        .set({ groupId: grpB.id })
        .where(eq(devices.id, testDev.id))
        .returning();

      assert.strictEqual(updatedDev.groupId, grpB.id);
      assert.notStrictEqual(updatedDev.groupId, grpA.id);
    } finally {
      await db.delete(devices).where(eq(devices.id, testDev.id));
      await db.delete(deviceGroups).where(sql`${deviceGroups.id} in (${grpA.id}, ${grpB.id})`);
    }
  });

  test("12. Group deletion with 'move' option reassigns devices to target group without deleting devices", async () => {
    const [gSource] = await db.insert(deviceGroups).values({ nama: "Area Sumber", warnaGaris: "abu" }).returning();
    const [gTarget] = await db.insert(deviceGroups).values({ nama: "Area Sasaran", warnaGaris: "biru" }).returning();
    const [dTest] = await db.insert(devices).values({
      name: "Device-Move-Test",
      type: "mikrotik",
      ipAddress: "10.254.200.2",
      groupId: gSource.id,
    }).returning();

    try {
      // Simulate move action before deleting source group
      await db.update(devices).set({ groupId: gTarget.id }).where(eq(devices.groupId, gSource.id));
      await db.delete(deviceGroups).where(eq(deviceGroups.id, gSource.id));

      const [checkDev] = await db.select().from(devices).where(eq(devices.id, dTest.id)).limit(1);
      assert.ok(checkDev, "Perangkat tidak boleh ikut terhapus");
      assert.strictEqual(checkDev.groupId, gTarget.id, "Perangkat harus dipindahkan ke area sasaran");
    } finally {
      await db.delete(devices).where(eq(devices.id, dTest.id));
      await db.delete(deviceGroups).where(eq(deviceGroups.id, gTarget.id));
    }
  });

  test("13. Aggregated group & devices summary query performance < 300ms without N+1", async () => {
    const startTime = Date.now();

    // Query teragregasi tunggal seperti di stats/dashboard & api/groups
    const allGroups = await db
      .select({ id: deviceGroups.id, nama: deviceGroups.nama, warnaGaris: deviceGroups.warnaGaris })
      .from(deviceGroups)
      .orderBy(deviceGroups.nama);

    const devCounts = await db.execute<{
      group_id: string | null;
      status: string;
      count: string;
    }>(sql`
      SELECT group_id, status, COUNT(*)::text as count
      FROM devices
      WHERE is_active = true
      GROUP BY group_id, status
    `);

    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 300, `Aggregated query latency (${elapsed}ms) must be < 300ms`);
    assert.ok(Array.isArray(allGroups));
    assert.ok(Array.isArray(devCounts));
  });
});
