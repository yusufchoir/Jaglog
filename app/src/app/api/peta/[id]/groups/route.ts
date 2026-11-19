import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { deviceGroups } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { redis } from "@shared/redis";
import { publishChange } from "@shared/events/publisher";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createGroupSchema = z.object({
  nama: z.string().min(1, "Nama grup wajib diisi.").max(100),
  deviceGroupId: z.string().uuid("ID grup perangkat tidak valid.").optional().nullable(),
  warnaGaris: z.enum(["biru", "merah", "abu"]).default("biru"),
  x: z.number().default(100),
  y: z.number().default(100),
  lebar: z.number().min(100).default(320),
  tinggi: z.number().min(80).default(220),
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menambahkan grup lokasi." },
        { status: 403 }
      );
    }

    const mapId = params.id;
    const body = await request.json();
    const parsed = createGroupSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message || "Data grup tidak valid." },
        { status: 400 }
      );
    }

    const { nama, deviceGroupId, warnaGaris, x, y, lebar, tinggi } = parsed.data;

    // 1. Cek duplikasi nama pada device_groups (SATU sumber kebenaran)
    const [existing] = await db
      .select({ id: deviceGroups.id, nama: deviceGroups.nama })
      .from(deviceGroups)
      .where(sql`lower(trim(${deviceGroups.nama})) = lower(trim(${nama}))`)
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: "Nama grup sudah dipakai." },
        { status: 409 }
      );
    }

    // 2. Buat grup master di device_groups
    const [newDeviceGroup] = await db
      .insert(deviceGroups)
      .values({
        nama: nama.trim(),
        warnaGaris,
        urutan: 0,
      })
      .returning();

    await redis.del(`cache:peta:${mapId}`);
    await redis.del("jagalog:groups_summary");
    await redis.del("jagalog:fleet_summary");

    publishChange({
      tipe: "grup.berubah",
      perangkat_id: null,
      data_ringkas: { aksi: "dibuat", groupId: newDeviceGroup.id, nama: newDeviceGroup.nama },
    }).catch(() => { });

    publishChange({
      tipe: "peta.berubah",
      perangkat_id: null,
      data_ringkas: { id_peta: mapId, aksi: "grup_dibuat", grup_id: newDeviceGroup.id },
    }).catch(() => { });

    return NextResponse.json({
      success: true,
      message: "Grup lokasi berhasil dibuat.",
      group: newDeviceGroup,
    });
  } catch (err: any) {
    console.error("POST /api/peta/[id]/groups Error:", err);
    return NextResponse.json(
      { error: "Gagal membuat grup pengelompokan." },
      { status: 500 }
    );
  }
}
