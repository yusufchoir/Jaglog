import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyNodes, devices } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat menjalankan penempatan otomatis." },
        { status: 403 }
      );
    }

    const mapId = params.id;

    // 1. Ambil node yang sudah ada di peta
    const existingNodes = await db
      .select({
        id: topologyNodes.id,
        deviceId: topologyNodes.deviceId,
        x: topologyNodes.x,
        y: topologyNodes.y,
      })
      .from(topologyNodes)
      .where(eq(topologyNodes.mapId, mapId));

    const placedDeviceIds = existingNodes
      .map((n) => n.deviceId)
      .filter((id): id is string => Boolean(id));

    // 2. Ambil perangkat aktif yang belum ditempatkan
    let unplacedDevices = [];
    if (placedDeviceIds.length > 0) {
      unplacedDevices = await db
        .select({
          id: devices.id,
          name: devices.name,
          type: devices.type,
          location: devices.location,
        })
        .from(devices)
        .where(
          and(
            eq(devices.isActive, true),
            sql`${devices.id} NOT IN ${placedDeviceIds}`
          )
        )
        .orderBy(devices.name);
    } else {
      unplacedDevices = await db
        .select({
          id: devices.id,
          name: devices.name,
          type: devices.type,
          location: devices.location,
        })
        .from(devices)
        .where(eq(devices.isActive, true))
        .orderBy(devices.name);
    }

    if (unplacedDevices.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Semua perangkat aktif sudah ditempatkan di peta.",
        placedCount: 0,
      });
    }

    // 3. Tentukan titik awal grid penempatan (di sebelah kanan atau bawah node yang sudah ada)
    let startX = 200;
    let startY = 200;
    if (existingNodes.length > 0) {
      const maxX = Math.max(...existingNodes.map((n) => n.x));
      const maxY = Math.max(...existingNodes.map((n) => n.y));
      startX = maxX + 280;
      startY = 100;
    }

    const COL_WIDTH = 240;
    const ROW_HEIGHT = 160;
    const COLS = 4;

    const insertedNodes = [];
    for (let i = 0; i < unplacedDevices.length; i++) {
      const dev = unplacedDevices[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = startX + col * COL_WIDTH;
      const y = startY + row * ROW_HEIGHT;

      const [node] = await db
        .insert(topologyNodes)
        .values({
          mapId,
          deviceId: dev.id,
          x,
          y,
          terkunci: false,
        })
        .returning();

      insertedNodes.push(node);
    }

    await redis.del(`cache:peta:${mapId}`);
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "tempatkan_otomatis", jumlah: insertedNodes.length },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `${insertedNodes.length} perangkat berhasil ditempatkan secara otomatis di peta.`,
      placedCount: insertedNodes.length,
    });
  } catch (err: any) {
    console.error("POST /api/peta/[id]/auto-place Error:", err);
    return NextResponse.json(
      { error: "Gagal menempatkan perangkat secara otomatis." },
      { status: 500 }
    );
  }
}
