import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { topologyNodes, devices } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";
import { z } from "zod";

export const dynamic = "force-dynamic";

const addNodeSchema = z.object({
  deviceId: z.string().uuid().optional(),
  tipeVirtual: z.enum(["internet", "isp", "cloud", "switch_tak_terpantau", "lainnya"]).optional(),
  label: z.string().max(150).optional(),
  x: z.number().default(200),
  y: z.number().default(200),
  groupId: z.string().uuid().nullable().optional(),
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menambahkan node ke peta." },
        { status: 403 }
      );
    }

    const mapId = params.id;
    const body = await request.json();
    const parsed = addNodeSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Data node tidak valid." },
        { status: 400 }
      );
    }

    const { deviceId, tipeVirtual, label, x, y, groupId } = parsed.data;

    // Kasus 1: Menempatkan perangkat fisik ke kanvas
    if (deviceId) {
      // Pastikan perangkat valid
      const [dev] = await db
        .select()
        .from(devices)
        .where(eq(devices.id, deviceId))
        .limit(1);

      if (!dev) {
        return NextResponse.json(
          { error: "Perangkat jaringan tidak ditemukan." },
          { status: 404 }
        );
      }

      // Pastikan belum pernah ada di peta ini (1 perangkat = 1 node per peta)
      const [existingNode] = await db
        .select()
        .from(topologyNodes)
        .where(and(eq(topologyNodes.mapId, mapId), eq(topologyNodes.deviceId, deviceId)))
        .limit(1);

      if (existingNode) {
        return NextResponse.json(
          { error: "Perangkat ini sudah ditempatkan di dalam peta." },
          { status: 409 }
        );
      }

      if (groupId && dev.groupId !== groupId) {
        await db.update(devices).set({ groupId }).where(eq(devices.id, deviceId));
      }

      const [newNode] = await db
        .insert(topologyNodes)
        .values({
          mapId,
          deviceId,
          tipeVirtual: null,
          label: null,
          x: Math.round(x),
          y: Math.round(y),
          terkunci: false,
        })
        .returning();

      await redis.del(`cache:peta:${mapId}`);
      publishChange({
        tipe: "peta.berubah",
        perangkat_id: deviceId,
        data_ringkas: { id_peta: mapId, aksi: "node_ditambahkan", node_id: newNode.id },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        message: `Perangkat '${dev.name}' berhasil ditempatkan di peta.`,
        node: newNode,
      });
    }

    // Kasus 2: Menambahkan node virtual (Internet, ISP, Cloud, dll)
    if (!tipeVirtual) {
      return NextResponse.json(
        { error: "Pilih tipe virtual (internet, isp, cloud, switch_tak_terpantau, lainnya)." },
        { status: 400 }
      );
    }

    const defaultLabelMap: Record<string, string> = {
      internet: "Internet Gateway",
      isp: "Koneksi ISP / WAN",
      cloud: "Layanan Cloud",
      switch_tak_terpantau: "Switch Unmanaged",
      lainnya: "Node Eksternal",
    };

    const finalLabel = label?.trim() || defaultLabelMap[tipeVirtual] || "Node Virtual";

    const [newVirtualNode] = await db
      .insert(topologyNodes)
      .values({
        mapId,
        deviceId: null,
        tipeVirtual,
        label: finalLabel,
        x: Math.round(x),
        y: Math.round(y),
        terkunci: false,
      })
      .returning();

    await redis.del(`cache:peta:${mapId}`);
    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "node_virtual_dibuat", node_id: newVirtualNode.id },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      message: `Node virtual '${finalLabel}' berhasil ditambahkan ke peta.`,
      node: newVirtualNode,
    });
  } catch (err: any) {
    console.error("POST /api/peta/[id]/nodes Error:", err);
    return NextResponse.json(
      { error: "Gagal menambahkan node ke peta." },
      { status: 500 }
    );
  }
}
