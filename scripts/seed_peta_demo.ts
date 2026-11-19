/**
 * Script Seed Demo Peta Topologi Jaringan JagaLog
 * Dijalankan dengan: npm run seed:peta-demo
 * Data demo ditandai dengan is_demo = true agar aman dan mudah dibersihkan.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
dotenv.config();

import {
  topologyMaps,
  deviceGroups,
  topologyNodes,
  topologyLinks,
  devices,
} from "../shared/src/schema";
import { eq, sql } from "drizzle-orm";
import { hashIngestToken, generateIngestToken } from "../shared/src/devices";

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/jagalog";
const client = postgres(connectionString, { max: 1 });
const db = drizzle(client);

async function runDemoSeed() {
  console.log("=== Memulai Seed Data Demo Topologi Jaringan JagaLog ===");

  try {
    // 1. Bersihkan data demo lama jika ada
    console.log("1. Membersihkan data demo lama...");
    await db.delete(topologyLinks).where(eq(topologyLinks.isDemo, true));
    await db.delete(topologyNodes).where(eq(topologyNodes.isDemo, true));
    await db.delete(topologyMaps).where(eq(topologyMaps.isDemo, true));

    // Bersihkan perangkat demo lama
    await db.delete(devices).where(sql`${devices.notes} LIKE '%[DEMO]%'`);

    // 2. Buat Peta Demo
    console.log("2. Membuat Peta Topologi Demo...");
    const [demoMap] = await db
      .insert(topologyMaps)
      .values({
        nama: "Peta Jaringan Multi-Cabang (Demo)",
        isDefault: false,
        isDemo: true,
      })
      .returning();

    // 3. Buat atau dapatkan Grup Cabang di master device_groups
    console.log("3. Menyiapkan Grup Master...");
    let [groupPusat] = await db
      .select()
      .from(deviceGroups)
      .where(sql`lower(trim(${deviceGroups.nama})) = lower('Kantor Pusat — Data Center')`);
    if (!groupPusat) {
      [groupPusat] = await db
        .insert(deviceGroups)
        .values({
          nama: "Kantor Pusat — Data Center",
          warnaGaris: "biru",
          urutan: 1,
        })
        .returning();
    }

    let [groupCabang] = await db
      .select()
      .from(deviceGroups)
      .where(sql`lower(trim(${deviceGroups.nama})) = lower('Kantor Cabang Barat — Operasional')`);
    if (!groupCabang) {
      [groupCabang] = await db
        .insert(deviceGroups)
        .values({
          nama: "Kantor Cabang Barat — Operasional",
          warnaGaris: "merah",
          urutan: 2,
        })
        .returning();
    }

    // 4. Buat Perangkat Fisik Demo
    console.log("4. Membuat Perangkat Jaringan Demo...");
    const dummyTokenHash = hashIngestToken(generateIngestToken());
    const now = new Date();

    const [devRouter] = await db
      .insert(devices)
      .values({
        name: "Router Core CCR2004",
        type: "mikrotik",
        ipAddress: "10.250.1.1",
        location: "Kantor Pusat — Data Center",
        groupId: groupPusat.id,
        notes: "[DEMO] Router gateway utama kantor pusat",
        ingestTokenHash: dummyTokenHash,
        status: "online",
        statusChangedAt: new Date(now.getTime() - 4 * 3600 * 1000),
        lastSeenAt: now,
        lastPingOk: true,
        lastPingRtt: 3,
        pingEnabled: true,
      })
      .returning();

    const [devSwitchPusat] = await db
      .insert(devices)
      .values({
        name: "Switch Distribusi DC-1",
        type: "switch",
        ipAddress: "10.250.1.2",
        location: "Kantor Pusat — Data Center",
        groupId: groupPusat.id,
        notes: "[DEMO] Switch core server rack 1",
        ingestTokenHash: dummyTokenHash,
        status: "online",
        statusChangedAt: new Date(now.getTime() - 24 * 3600 * 1000),
        lastSeenAt: now,
        lastPingOk: true,
        lastPingRtt: 1,
        pingEnabled: true,
      })
      .returning();

    const [devServerLinux] = await db
      .insert(devices)
      .values({
        name: "Server DB PostgreSQL Linux",
        type: "linux",
        ipAddress: "10.250.1.10",
        location: "Kantor Pusat — Data Center",
        groupId: groupPusat.id,
        notes: "[DEMO] Server database produksi",
        ingestTokenHash: dummyTokenHash,
        status: "online",
        statusChangedAt: new Date(now.getTime() - 48 * 3600 * 1000),
        lastSeenAt: now,
        lastPingOk: true,
        lastPingRtt: 2,
        pingEnabled: true,
      })
      .returning();

    const [devServerWindows] = await db
      .insert(devices)
      .values({
        name: "Server App Windows ActiveDirectory",
        type: "windows",
        ipAddress: "10.250.1.15",
        location: "Kantor Pusat — Data Center",
        groupId: groupPusat.id,
        notes: "[DEMO] Domain controller AD",
        ingestTokenHash: dummyTokenHash,
        status: "log_stopped",
        statusChangedAt: new Date(now.getTime() - 35 * 60 * 1000),
        lastSeenAt: new Date(now.getTime() - 35 * 60 * 1000),
        lastPingOk: true,
        lastPingRtt: 4,
        pingEnabled: true,
      })
      .returning();

    const [devSwitchCabang] = await db
      .insert(devices)
      .values({
        name: "Switch Akses Cabang-Lt1",
        type: "switch",
        ipAddress: "10.10.1.2",
        location: "Kantor Cabang Barat — Operasional",
        groupId: groupCabang.id,
        notes: "[DEMO] Switch akses user cabang",
        ingestTokenHash: dummyTokenHash,
        status: "online",
        statusChangedAt: new Date(now.getTime() - 12 * 3600 * 1000),
        lastSeenAt: now,
        lastPingOk: true,
        lastPingRtt: 18,
        pingEnabled: true,
      })
      .returning();

    const [devCctv] = await db
      .insert(devices)
      .values({
        name: "CCTV NVR Gateway",
        type: "linux",
        ipAddress: "10.10.1.50",
        location: "Kantor Cabang Barat — Operasional",
        groupId: groupCabang.id,
        notes: "[DEMO] Perekam kamera pos keamanan",
        ingestTokenHash: dummyTokenHash,
        status: "offline",
        statusChangedAt: new Date(now.getTime() - 18 * 60 * 1000),
        lastSeenAt: new Date(now.getTime() - 18 * 60 * 1000),
        lastPingOk: false,
        lastPingRtt: null,
        pingEnabled: true,
      })
      .returning();

    // 5. Buat Nodes di Kanvas Topologi
    console.log("5. Menempatkan Nodes di Kanvas...");

    // Virtual Node 1: Internet
    const [nodeInternet] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        tipeVirtual: "internet",
        label: "Internet Gateway Global",
        x: 480,
        y: 40,
        isDemo: true,
      })
      .returning();

    // Virtual Node 2: ISP
    const [nodeIsp] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        tipeVirtual: "isp",
        label: "ISP Telkom Metro-E 500M",
        x: 480,
        y: 150,
        isDemo: true,
      })
      .returning();

    // Node Router Core (Pusat)
    const [nodeRouter] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devRouter.id,
        x: 230,
        y: 330,
        isDemo: true,
      })
      .returning();

    // Node Switch Pusat
    const [nodeSwitchPusat] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devSwitchPusat.id,
        x: 230,
        y: 450,
        isDemo: true,
      })
      .returning();

    // Node Server Linux
    const [nodeServerLinux] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devServerLinux.id,
        x: 90,
        y: 530,
        isDemo: true,
      })
      .returning();

    // Node Server Windows
    const [nodeServerWindows] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devServerWindows.id,
        x: 380,
        y: 530,
        isDemo: true,
      })
      .returning();

    // Node Switch Cabang
    const [nodeSwitchCabang] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devSwitchCabang.id,
        x: 750,
        y: 360,
        isDemo: true,
      })
      .returning();

    // Node CCTV Cabang
    const [nodeCctv] = await db
      .insert(topologyNodes)
      .values({
        mapId: demoMap.id,
        deviceId: devCctv.id,
        x: 880,
        y: 480,
        isDemo: true,
      })
      .returning();

    // 6. Buat Links Penghubung Antar Node
    console.log("6. Menghubungkan Links Antar Node...");
    await db.insert(topologyLinks).values([
      {
        mapId: demoMap.id,
        sourceNodeId: nodeInternet.id,
        targetNodeId: nodeIsp.id,
        label: "BGP Peering",
        tipe: "kabel",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeIsp.id,
        targetNodeId: nodeRouter.id,
        label: "Fiber 500M",
        tipe: "kabel",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeRouter.id,
        targetNodeId: nodeSwitchPusat.id,
        label: "Trunk 10G",
        tipe: "kabel",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeSwitchPusat.id,
        targetNodeId: nodeServerLinux.id,
        label: "VLAN 100",
        tipe: "kabel",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeSwitchPusat.id,
        targetNodeId: nodeServerWindows.id,
        label: "VLAN 200",
        tipe: "kabel",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeRouter.id,
        targetNodeId: nodeSwitchCabang.id,
        label: "IPSec VPN 100M",
        tipe: "vpn",
        isDemo: true,
      },
      {
        mapId: demoMap.id,
        sourceNodeId: nodeSwitchCabang.id,
        targetNodeId: nodeCctv.id,
        label: "PoE GbE",
        tipe: "kabel",
        isDemo: true,
      },
    ]);

    console.log("=== Seed Demo Topologi Selesai Sukses! ===");
    console.log(`Peta demo ID: ${demoMap.id} ("${demoMap.nama}")`);
  } catch (err) {
    console.error("Gagal melakukan seed peta demo:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runDemoSeed();
