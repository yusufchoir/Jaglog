import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { notificationChannels, notificationLogs } from "@shared/schema";
import { encryptConfig } from "@shared/notifications/crypto";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createChannelSchema = z.object({
  type: z.enum(["telegram", "email"], {
    errorMap: () => ({ message: "Tipe saluran harus 'telegram' atau 'email'." }),
  }),
  name: z.string().trim().min(2, "Nama saluran minimal 2 karakter.").max(100),
  config: z.record(z.any()),
  events: z.array(z.string()).optional(),
});

// 1. GET /api/notifications: Daftar saluran notifikasi & log pengiriman
export async function GET() {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah berakhir." },
        { status: 401 }
      );
    }

    const channels = await db
      .select({
        id: notificationChannels.id,
        type: notificationChannels.type,
        name: notificationChannels.name,
        isActive: notificationChannels.isActive,
        events: notificationChannels.events,
        createdAt: notificationChannels.createdAt,
      })
      .from(notificationChannels)
      .orderBy(desc(notificationChannels.createdAt));

    const logs = await db
      .select()
      .from(notificationLogs)
      .orderBy(desc(notificationLogs.sentAt))
      .limit(30);

    return NextResponse.json({ channels, logs });
  } catch (error) {
    console.error("GET /api/notifications error:", error);
    return NextResponse.json(
      { error: "Gagal memuat saluran notifikasi." },
      { status: 500 }
    );
  }
}

// 2. POST /api/notifications: Buat saluran baru (Admin only)
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
        { error: "Hanya peran Admin yang dapat menambahkan saluran notifikasi." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parseResult = createChannelSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.errors[0]?.message || "Format data saluran tidak valid." },
        { status: 400 }
      );
    }

    const { type, name, config, events } = parseResult.data;

    // Validasi konfigurasi per jenis
    if (type === "telegram") {
      if (!config.botToken || !config.chatId) {
        return NextResponse.json(
          { error: "Telegram memerlukan 'botToken' dan 'chatId'." },
          { status: 400 }
        );
      }
    } else if (type === "email") {
      if (!config.host || !config.port || !config.from || !config.to) {
        return NextResponse.json(
          { error: "Email memerlukan 'host', 'port', 'from', dan 'to'." },
          { status: 400 }
        );
      }
    }

    // Enkripsi rahasia konfigurasi
    const encryptedConfig = encryptConfig(config);

    const [newChannel] = await db
      .insert(notificationChannels)
      .values({
        type,
        name,
        config: encryptedConfig,
        events: events || ["ping_rto", "ping_recovered", "device_offline", "device_recovered", "flapping_detected"],
        isActive: true,
      })
      .returning({
        id: notificationChannels.id,
        type: notificationChannels.type,
        name: notificationChannels.name,
        isActive: notificationChannels.isActive,
        events: notificationChannels.events,
        createdAt: notificationChannels.createdAt,
      });

    return NextResponse.json(
      {
        success: true,
        message: `Saluran notifikasi '${newChannel.name}' berhasil ditambahkan.`,
        channel: newChannel,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST /api/notifications error:", error);
    return NextResponse.json(
      { error: "Gagal menyimpan saluran notifikasi." },
      { status: 500 }
    );
  }
}

// 3. PATCH /api/notifications: Aktifkan/nonaktifkan saluran (Admin only)
export async function PATCH(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
    }

    const { id, isActive, events } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "ID saluran wajib diisi." }, { status: 400 });
    }

    const updateData: Record<string, any> = {};
    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }
    if (Array.isArray(events)) {
      updateData.events = events;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada data yang diperbarui." }, { status: 400 });
    }

    const [updated] = await db
      .update(notificationChannels)
      .set(updateData)
      .where(eq(notificationChannels.id, id))
      .returning({
        id: notificationChannels.id,
        name: notificationChannels.name,
        isActive: notificationChannels.isActive,
        events: notificationChannels.events,
      });

    if (!updated) {
      return NextResponse.json({ error: "Saluran tidak ditemukan." }, { status: 404 });
    }

    return NextResponse.json({ success: true, channel: updated });
  } catch (error) {
    console.error("PATCH /api/notifications error:", error);
    return NextResponse.json({ error: "Gagal memperbarui status saluran." }, { status: 500 });
  }
}

// 4. DELETE /api/notifications: Hapus saluran (Admin only)
export async function DELETE(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Akses ditolak." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID saluran wajib diberikan." }, { status: 400 });
    }

    await db.delete(notificationChannels).where(eq(notificationChannels.id, id));

    return NextResponse.json({ success: true, message: "Saluran berhasil dihapus." });
  } catch (error) {
    console.error("DELETE /api/notifications error:", error);
    return NextResponse.json({ error: "Gagal menghapus saluran." }, { status: 500 });
  }
}
