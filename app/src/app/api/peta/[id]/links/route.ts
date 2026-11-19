import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyLinks, topologyNodes } from "@shared/schema";
import { eq, and, or } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createLinkSchema = z.object({
  sourceNodeId: z.string().uuid("Node asal tidak valid."),
  targetNodeId: z.string().uuid("Node tujuan tidak valid."),
  label: z.string().max(100).optional(),
  tipe: z.enum(["kabel", "wireless", "vpn", "lainnya"]).default("kabel"),
});

export async function POST(
  request: Request,
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menghubungkan node." },
        { status: 403 }
      );
    }

    const mapId = params.id;
    const body = await request.json();
    const parsed = createLinkSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Data link tidak valid." },
        { status: 400 }
      );
    }

    const { sourceNodeId, targetNodeId, label, tipe } = parsed.data;

    // 1. Larang link ke diri sendiri
    if (sourceNodeId === targetNodeId) {
      return NextResponse.json(
        { error: "Gagal menghubungkan: Node tidak dapat dihubungkan ke dirinya sendiri." },
        { status: 400 }
      );
    }

    // 2. Pastikan kedua node ada pada peta ini
    const [sourceNode] = await db
      .select({ id: topologyNodes.id })
      .from(topologyNodes)
      .where(and(eq(topologyNodes.id, sourceNodeId), eq(topologyNodes.mapId, mapId)))
      .limit(1);

    const [targetNode] = await db
      .select({ id: topologyNodes.id })
      .from(topologyNodes)
      .where(and(eq(topologyNodes.id, targetNodeId), eq(topologyNodes.mapId, mapId)))
      .limit(1);

    if (!sourceNode || !targetNode) {
      return NextResponse.json(
        { error: "Node asal atau tujuan tidak ditemukan pada peta ini." },
        { status: 404 }
      );
    }

    // 3. Larang link duplikat (bolak-balik dianggap duplikat)
    const [existingLink] = await db
      .select()
      .from(topologyLinks)
      .where(
        and(
          eq(topologyLinks.mapId, mapId),
          or(
            and(
              eq(topologyLinks.sourceNodeId, sourceNodeId),
              eq(topologyLinks.targetNodeId, targetNodeId)
            ),
            and(
              eq(topologyLinks.sourceNodeId, targetNodeId),
              eq(topologyLinks.targetNodeId, sourceNodeId)
            )
          )
        )
      )
      .limit(1);

    if (existingLink) {
      return NextResponse.json(
        { error: "Gagal menghubungkan: Hubungan antar kedua node ini sudah ada." },
        { status: 409 }
      );
    }

    // 4. Masukkan link baru
    const [newLink] = await db
      .insert(topologyLinks)
      .values({
        mapId,
        sourceNodeId,
        targetNodeId,
        label: label?.trim() || null,
        tipe,
      })
      .returning();

    // Hapus cache peta & broadcast update
    await redis.del(`cache:peta:${mapId}`);
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "link_dibuat", link_id: newLink.id },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Hubungan antar node berhasil dibuat.",
      link: newLink,
    });
  } catch (err: any) {
    console.error("POST /api/peta/[id]/links Error:", err);
    return NextResponse.json(
      { error: "Gagal membuat hubungan antar node." },
      { status: 500 }
    );
  }
}
