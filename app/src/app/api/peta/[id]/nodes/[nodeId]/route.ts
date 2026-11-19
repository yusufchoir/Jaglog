import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyNodes, topologyLinks } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string; nodeId: string } }
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghapus node dari peta." },
        { status: 403 }
      );
    }

    const { id: mapId, nodeId } = params;

    // Hapus semua link yang terhubung ke node ini
    await db
      .delete(topologyLinks)
      .where(
        and(
          eq(topologyLinks.mapId, mapId),
          or(
            eq(topologyLinks.sourceNodeId, nodeId),
            eq(topologyLinks.targetNodeId, nodeId)
          )
        )
      );

    // Hapus node dari peta
    const [deletedNode] = await db
      .delete(topologyNodes)
      .where(and(eq(topologyNodes.id, nodeId), eq(topologyNodes.mapId, mapId)))
      .returning();

    if (!deletedNode) {
      return NextResponse.json(
        { error: "Node tidak ditemukan pada peta ini." },
        { status: 404 }
      );
    }

    await redis.del(`cache:peta:${mapId}`);
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: deletedNode.deviceId || null,
      data_ringkas: { id_peta: mapId, aksi: "node_dihapus", node_id: nodeId },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Node berhasil dihapus dari peta.",
    });
  } catch (err: any) {
    console.error("DELETE /api/peta/[id]/nodes/[nodeId] Error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus node dari peta." },
      { status: 500 }
    );
  }
}
