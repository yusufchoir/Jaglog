import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyNodes, devices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";
import { z } from "zod";

export const dynamic = "force-dynamic";

const layoutUpdateSchema = z.object({
  clientId: z.string().optional(),
  version: z.number().optional(),
  nodes: z
    .array(
      z.object({
        id: z.string().uuid(),
        x: z.number(),
        y: z.number(),
        terkunci: z.boolean().optional(),
        groupId: z.string().uuid().nullable().optional(),
      })
    )
    .optional(),
  groups: z
    .array(
      z.object({
        id: z.string().uuid(),
        x: z.number(),
        y: z.number(),
        lebar: z.number().optional(),
        tinggi: z.number().optional(),
      })
    )
    .optional(),
});

export async function PUT(
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat mengubah tata letak peta." },
        { status: 403 }
      );
    }

    const mapId = params.id;
    const body = await request.json();
    const parsed = layoutUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Format data tata letak tidak valid: " + parsed.error.errors[0]?.message },
        { status: 400 }
      );
    }

    const { nodes, groups, clientId } = parsed.data;
    const now = new Date();

    // 1. Update posisi node dalam transaksi atomik
    let anyGroupChanged = false;
    if (nodes && nodes.length > 0) {
      await db.transaction(async (tx) => {
        for (const n of nodes) {
          const updateValues: Record<string, any> = {
            x: Math.round(n.x * 10) / 10,
            y: Math.round(n.y * 10) / 10,
            updatedAt: now,
          };
          if (n.terkunci !== undefined) updateValues.terkunci = n.terkunci;

          const [updatedNode] = await tx
            .update(topologyNodes)
            .set(updateValues)
            .where(eq(topologyNodes.id, n.id))
            .returning({ id: topologyNodes.id, deviceId: topologyNodes.deviceId });

          // Sinkronkan devices.groupId jika n.groupId dikirim (misal hasil konfirmasi drag antar grup)
          if (n.groupId !== undefined && updatedNode?.deviceId) {
            await tx
              .update(devices)
              .set({ groupId: n.groupId || null })
              .where(eq(devices.id, updatedNode.deviceId));
            anyGroupChanged = true;
          }
        }
      });
    }

    // 2. Update versi baru di Redis
    const newVersion = Date.now();
    const lastVersionKey = `peta:${mapId}:version`;
    await redis.set(lastVersionKey, newVersion.toString(), "EX", 86400);

    // Hapus cache ringkasan peta
    await redis.del(`cache:peta:${mapId}`);

    if (anyGroupChanged) {
      await redis.del("jagalog:fleet_summary");
      await redis.del("jagalog:groups_summary");
      publishChange({
        tipe: "grup.berubah",
        perangkat_id: null,
        clientId,
        data_ringkas: {
          aksi: "seret_peta",
          nodes: nodes?.filter((n) => n.groupId !== undefined),
        },
      }).catch(() => {});
    }

    // Siarkan pembaruan tata letak lewat SSE ke admin/viewer lain (membawa clientId pengirim)
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      versi: newVersion,
      clientId,
      data_ringkas: {
        id_peta: mapId,
        node_diubah: nodes?.map((n) => ({ id: n.id, x: n.x, y: n.y, groupId: n.groupId })) || [],
        grup_diubah: groups?.map((g) => ({ id: g.id, x: g.x, y: g.y, lebar: g.lebar, tinggi: g.tinggi })) || [],
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: "Tata letak peta berhasil disimpan.",
      versi: newVersion,
    });
  } catch (err: any) {
    console.error("PUT /api/peta/[id]/layout Error:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan perubahan tata letak peta." },
      { status: 500 }
    );
  }
}
