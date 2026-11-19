import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { userMapViewStates } from "@shared/schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateTampilanSchema = z.object({
  grupTerlipat: z.array(z.string().uuid()).max(200),
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

    const mapId = params.id;
    const body = await request.json();
    const parsed = updateTampilanSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Format data tampilan tidak valid: " + (parsed.error.errors[0]?.message || "") },
        { status: 400 }
      );
    }

    const { grupTerlipat } = parsed.data;
    const now = new Date();

    // Simpan preferensi tampilan per pengguna per peta (Upsert)
    // Preferensi tampilan TIDAK menaikkan versi peta dan TIDAK memicu SSE
    await db
      .insert(userMapViewStates)
      .values({
        userId: session.user.userId,
        mapId: mapId,
        collapsedGroupIds: grupTerlipat,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [userMapViewStates.userId, userMapViewStates.mapId],
        set: {
          collapsedGroupIds: grupTerlipat,
          updatedAt: now,
        },
      });

    return NextResponse.json({
      success: true,
      message: "Preferensi tampilan berhasil disimpan.",
      tampilan: {
        grup_terlipat: grupTerlipat,
      },
    });
  } catch (err: any) {
    console.error("PUT /api/peta/[id]/tampilan Error:", err);
    return NextResponse.json(
      { error: "Gagal menyimpan preferensi tampilan peta." },
      { status: 500 }
    );
  }
}
