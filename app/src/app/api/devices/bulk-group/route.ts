import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { bulkDeviceGroupSchema } from "@shared/groups";
import { setDeviceGroup } from "@shared/armada";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat mengubah penugasan grup perangkat." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = bulkDeviceGroupSchema.safeParse(body);

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]?.message || "Data permintaan massal tidak valid.";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { deviceIds, groupId } = parseResult.data;
    const clientId = (body as any).clientId;

    const result = await setDeviceGroup({
      deviceIds,
      groupId: groupId || null,
      clientId,
    });

    const targetGroupName = result.targetGroup ? result.targetGroup.nama : "Tanpa Grup";

    return NextResponse.json({
      success: true,
      count: result.updatedDevices.length,
      message: `${result.updatedDevices.length} perangkat berhasil dipindahkan ke '${targetGroupName}'.`,
      devices: result.updatedDevices,
    });
  } catch (error: any) {
    console.error("POST /api/devices/bulk-group error:", error);
    return NextResponse.json(
      { error: error?.message || "Gagal memproses penugasan grup massal." },
      { status: 500 }
    );
  }
}
