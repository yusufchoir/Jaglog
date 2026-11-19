import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { sendTestNotification } from "@shared/notifications";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Akses ditolak: Hanya peran Admin yang dapat menguji notifikasi." }, { status: 403 });
    }

    const { channelId } = await request.json();
    if (!channelId) {
      return NextResponse.json({ error: "ID saluran notifikasi wajib diberikan." }, { status: 400 });
    }

    const result = await sendTestNotification(channelId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error: any) {
    console.error("POST /api/notifications/test error:", error);
    return NextResponse.json(
      { error: error.message || "Gagal melakukan pengujian pengiriman notifikasi." },
      { status: 500 }
    );
  }
}
