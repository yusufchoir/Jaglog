import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { deviceGroups, devices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; groupId: string } }
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghapus grup lokasi." },
        { status: 403 }
      );
    }

    const { id: mapId, groupId } = params;

    // Lepas relasi pada devices (perangkat TIDAK PERNAH terhapus)
    await db.transaction(async (tx) => {
      await tx
        .update(devices)
        .set({ groupId: null })
        .where(eq(devices.groupId, groupId));

      await tx.delete(deviceGroups).where(eq(deviceGroups.id, groupId));
    });

    await redis.del(`cache:peta:${mapId}`);
    await redis.del("jagalog:groups_summary");
    await redis.del("jagalog:fleet_summary");

    publishChange({
      tipe: "grup.berubah",
      perangkat_id: null,
      data_ringkas: { aksi: "dihapus", groupId },
    }).catch(() => { });

    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "grup_dihapus", grup_id: groupId },
    }).catch(() => { });

    return NextResponse.json({
      success: true,
      message: "Grup berhasil dihapus dan anggotanya dilepas.",
    });
  } catch (err: any) {
    console.error("DELETE /api/peta/[id]/groups/[groupId] Error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus grup lokasi." },
      { status: 500 }
    );
  }
}
