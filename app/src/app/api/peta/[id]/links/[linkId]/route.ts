import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyLinks } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; linkId: string } }
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghapus hubungan node." },
        { status: 403 }
      );
    }

    const { id: mapId, linkId } = params;

    const [deleted] = await db
      .delete(topologyLinks)
      .where(and(eq(topologyLinks.id, linkId), eq(topologyLinks.mapId, mapId)))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "Link hubungan tidak ditemukan pada peta ini." },
        { status: 404 }
      );
    }

    // Hapus cache peta & broadcast update
    await redis.del(`cache:peta:${mapId}`);
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "link_dihapus", link_id: linkId },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Hubungan antar node berhasil dihapus.",
    });
  } catch (err: any) {
    console.error("DELETE /api/peta/[id]/links/[linkId] Error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus hubungan node." },
      { status: 500 }
    );
  }
}
