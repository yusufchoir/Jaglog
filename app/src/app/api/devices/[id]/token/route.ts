import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { devices } from "@shared/schema";
import { generateIngestToken, hashIngestToken } from "@shared/devices";
import { eq } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir. Silakan login kembali." },
        { status: 401 }
      );
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Akses ditolak: Hanya peran Admin yang dapat membuat ulang token perangkat." },
        { status: 403 }
      );
    }

    const { id: deviceId } = await params;

    const [device] = await db
      .select({ id: devices.id, name: devices.name, ingestTokenHash: devices.ingestTokenHash })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    if (!device) {
      return NextResponse.json(
        { error: "Perangkat tidak ditemukan." },
        { status: 404 }
      );
    }

    // Buat token 32-byte acak baru & hash SHA-256
    const newRawToken = generateIngestToken();
    const newHash = hashIngestToken(newRawToken);

    await db
      .update(devices)
      .set({ ingestTokenHash: newHash })
      .where(eq(devices.id, deviceId));

    // Segera invalidasi cache token lama & stats di Redis agar collector langsung menolak token lama
    try {
      if (device.ingestTokenHash) {
        await redis.del(`device:token:${device.ingestTokenHash}`);
      }
      await redis.del(`cache:device:stats:${deviceId}`);
    } catch (cacheErr) {
      console.warn("Failed to invalidate token cache:", cacheErr);
    }

    publishChange({
      tipe: "perangkat.diubah",
      perangkat_id: deviceId,
    }).catch(() => {});

    // Catat ke server audit log (siapa, kapan, perangkat mana) tanpa menyimpan token mentah
    console.log(
      `[AUDIT] [${new Date().toISOString()}] User '${session.user.username}' (${session.user.role}) regenerated ingest token for device '${device.name}' (ID: ${device.id})`
    );

    return NextResponse.json({
      success: true,
      message: `Token ingest baru untuk '${device.name}' berhasil dibuat.`,
      ingestToken: newRawToken,
    });
  } catch (error) {
    console.error("POST /api/devices/[id]/token error:", error);
    return NextResponse.json(
      { error: "Gagal membuat ulang token perangkat." },
      { status: 500 }
    );
  }
}
