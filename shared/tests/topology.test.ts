import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { db, queryClient } from "../src/db";
import {
  devices,
  deviceGroups,
  topologyMaps,
  topologyNodes,
  topologyLinks,
} from "../src/schema";
import { eq } from "drizzle-orm";

describe("Topology & Peta Jaringan Backend Tests", () => {
  let testMapId: string;
  let testGroupId: string;
  let testDeviceId: string;
  let testNode1Id: string;
  let testNode2Id: string;

  before(async () => {
    // 1. Buat peta uji
    const [map] = await db
      .insert(topologyMaps)
      .values({
        nama: "Test Map JagaLog",
        isDefault: false,
      })
      .returning({ id: topologyMaps.id });
    testMapId = map.id;

    // 2. Buat grup uji di master device_groups
    const [group] = await db
      .insert(deviceGroups)
      .values({
        nama: "Test Group Cabang",
        warnaGaris: "biru",
      })
      .returning({ id: deviceGroups.id });
    testGroupId = group.id;

    // 3. Buat perangkat uji terhubung ke grup master
    const [dev] = await db
      .insert(devices)
      .values({
        name: "Router-Test-Peta",
        type: "mikrotik",
        ipAddress: "10.199.1.1",
        isActive: true,
        status: "online",
        groupId: testGroupId,
      })
      .returning({ id: devices.id });
    testDeviceId = dev.id;

    // 4. Buat node fisik & virtual
    const [node1] = await db
      .insert(topologyNodes)
      .values({
        mapId: testMapId,
        deviceId: testDeviceId,
        x: 100,
        y: 100,
      })
      .returning({ id: topologyNodes.id });
    testNode1Id = node1.id;

    const [node2] = await db
      .insert(topologyNodes)
      .values({
        mapId: testMapId,
        tipeVirtual: "internet",
        label: "Internet Gateway",
        x: 100,
        y: -50,
      })
      .returning({ id: topologyNodes.id });
    testNode2Id = node2.id;
  });

  after(async () => {
    // Cleanup
    if (testMapId) {
      await db.delete(topologyMaps).where(eq(topologyMaps.id, testMapId));
    }
    if (testDeviceId) {
      await db.delete(devices).where(eq(devices.id, testDeviceId));
    }
    if (testGroupId) {
      await db.delete(deviceGroups).where(eq(deviceGroups.id, testGroupId));
    }
  });

  test("1. Peta, grup master, dan node berhasil dibuat dengan relasi yang benar", async () => {
    const map = await db
      .select()
      .from(topologyMaps)
      .where(eq(topologyMaps.id, testMapId))
      .limit(1);

    assert.ok(map.length > 0, "Peta harus ditemukan");
    assert.strictEqual(map[0].nama, "Test Map JagaLog");

    const groups = await db
      .select()
      .from(deviceGroups)
      .where(eq(deviceGroups.id, testGroupId));
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].nama, "Test Group Cabang");

    const nodes = await db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.mapId, testMapId));
    assert.strictEqual(nodes.length, 2);
  });

  test("2. Link antar node berhasil dibuat", async () => {
    const [link] = await db
      .insert(topologyLinks)
      .values({
        mapId: testMapId,
        sourceNodeId: testNode2Id,
        targetNodeId: testNode1Id,
        tipe: "kabel",
        label: "1 Gbps Uplink",
      })
      .returning();

    assert.ok(link.id, "Link harus memiliki id");
    assert.strictEqual(link.sourceNodeId, testNode2Id);
    assert.strictEqual(link.targetNodeId, testNode1Id);
    assert.strictEqual(link.label, "1 Gbps Uplink");
  });

  test("3. Self-link (source = target) dilarang oleh database constraint", async () => {
    await assert.rejects(
      async () => {
        await db.insert(topologyLinks).values({
          mapId: testMapId,
          sourceNodeId: testNode1Id,
          targetNodeId: testNode1Id,
        });
      },
      (err: Error) => {
        return (
          err.message.includes("check") ||
          err.message.includes("topology_links_no_self_link")
        );
      },
      "Database constraint topology_links_no_self_link harus menolak self-link"
    );
  });

  test("4. Duplicate link pada arah yang sama dilarang oleh unique index", async () => {
    await assert.rejects(
      async () => {
        await db.insert(topologyLinks).values({
          mapId: testMapId,
          sourceNodeId: testNode2Id,
          targetNodeId: testNode1Id,
        });
      },
      (err: Error) => {
        return (
          err.message.includes("unique") ||
          err.message.includes("uq_topology_links_source_target")
        );
      },
      "Unique index uq_topology_links_source_target harus menolak duplikasi link"
    );
  });

  test("5. Cascade delete: menghapus peta otomatis membersihkan grup, node, dan link", async () => {
    const [tmpMap] = await db
      .insert(topologyMaps)
      .values({ nama: "Temporary Map For Cascade" })
      .returning();

    const [n1] = await db
      .insert(topologyNodes)
      .values({
        mapId: tmpMap.id,
        tipeVirtual: "lainnya",
        label: "A",
        x: 0,
        y: 0,
      })
      .returning();

    const [n2] = await db
      .insert(topologyNodes)
      .values({
        mapId: tmpMap.id,
        tipeVirtual: "lainnya",
        label: "B",
        x: 10,
        y: 10,
      })
      .returning();

    await db.insert(topologyLinks).values({
      mapId: tmpMap.id,
      sourceNodeId: n1.id,
      targetNodeId: n2.id,
    });

    // Hapus map
    await db.delete(topologyMaps).where(eq(topologyMaps.id, tmpMap.id));

    // Verifikasi node & link bersih
    const nodes = await db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.mapId, tmpMap.id));
    assert.strictEqual(nodes.length, 0, "Semua node harus terhapus cascade");

    const links = await db
      .select()
      .from(topologyLinks)
      .where(eq(topologyLinks.mapId, tmpMap.id));
    assert.strictEqual(links.length, 0, "Semua link harus terhapus cascade");
  });

  test("6. Relasi devices.group_id terhubung dengan master device_groups (single source of truth)", async () => {
    // Buat master device group
    const [devGrp] = await db
      .insert(deviceGroups)
      .values({
        nama: "Area Master Test",
        warnaGaris: "merah",
      })
      .returning();

    // Buat perangkat yang terhubung ke master device group
    const [testDev] = await db
      .insert(devices)
      .values({
        name: "Dev-Relasi-Test",
        type: "mikrotik",
        ipAddress: "10.199.2.2",
        groupId: devGrp.id,
      })
      .returning();

    assert.strictEqual(testDev.groupId, devGrp.id);

    // Hapus master device group -> onDelete set null
    await db.delete(deviceGroups).where(eq(deviceGroups.id, devGrp.id));

    const [checkDev] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, testDev.id));

    assert.ok(checkDev, "devices tidak boleh ikut terhapus");
    assert.strictEqual(checkDev.groupId, null, "devices.group_id harus menjadi null saat master dihapus");

    // Bersihkan
    await db.delete(devices).where(eq(devices.id, testDev.id));
  });

  test("7. Pergeseran posisi node dan grup last-write-wins tanpa penolakan versi", async () => {
    const newX = 350;
    const newY = 420;

    // Admin 1 simpan posisi
    await db
      .update(topologyNodes)
      .set({ x: newX, y: newY, updatedAt: new Date() })
      .where(eq(topologyNodes.id, testNode1Id));

    // Admin 2 simpan posisi lain segera setelahnya
    const newerX = 360;
    const newerY = 430;
    await db
      .update(topologyNodes)
      .set({ x: newerX, y: newerY, updatedAt: new Date() })
      .where(eq(topologyNodes.id, testNode1Id));

    const [updatedNode] = await db
      .select()
      .from(topologyNodes)
      .where(eq(topologyNodes.id, testNode1Id));

    assert.strictEqual(updatedNode.x, newerX);
    assert.strictEqual(updatedNode.y, newerY);
  });
});
