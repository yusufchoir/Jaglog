import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { logFilters } from "@shared/schema";
import { eq } from "drizzle-orm";
import { publishFilterInvalidate } from "@shared/log-filter";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat mengubah filter log." },
        { status: 403 }
      );
    }

    const filterId = params.id;
    const body = await request.json();
    const { name, matchType, pattern, action, isActive, description } = body;

    const [existing] = await db
      .select()
      .from(logFilters)
      .where(eq(logFilters.id, filterId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Aturan filter tidak ditemukan." }, { status: 404 });
    }

    const updates: any = { updatedAt: new Date() };
    if (name !== undefined) updates.name = name.trim();
    if (matchType !== undefined) updates.matchType = matchType;
    if (pattern !== undefined) updates.pattern = pattern.trim();
    if (action !== undefined) updates.action = action;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);
    if (description !== undefined) updates.description = description;

    const [updated] = await db
      .update(logFilters)
      .set(updates)
      .where(eq(logFilters.id, filterId))
      .returning();

    console.log(
      `[AUDIT] [${new Date().toISOString()}] Admin '${session.user.username}' updated filter '${updated.name}' (${updated.id})`
    );

    await publishFilterInvalidate();

    return NextResponse.json({
      message: "Aturan filter log berhasil diperbarui.",
      filter: updated,
    });
  } catch (err: any) {
    console.error("PUT /api/filters/[id] Error:", err);
    return NextResponse.json({ error: "Gagal memperbarui aturan filter log." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat mengubah status filter log." },
        { status: 403 }
      );
    }

    const filterId = params.id;
    const body = await request.json();
    const { isActive } = body;

    const [existing] = await db
      .select()
      .from(logFilters)
      .where(eq(logFilters.id, filterId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Aturan filter tidak ditemukan." }, { status: 404 });
    }

    const newActive = isActive !== undefined ? Boolean(isActive) : !existing.isActive;

    const [updated] = await db
      .update(logFilters)
      .set({ isActive: newActive, updatedAt: new Date() })
      .where(eq(logFilters.id, filterId))
      .returning();

    console.log(
      `[AUDIT] [${new Date().toISOString()}] Admin '${session.user.username}' toggled filter '${updated.name}' (${updated.id}) to ${newActive ? "aktif" : "nonaktif"}`
    );

    await publishFilterInvalidate();

    return NextResponse.json({
      message: `Filter berhasil di${newActive ? "aktifkan" : "nonaktifkan"}.`,
      filter: updated,
    });
  } catch (err: any) {
    console.error("PATCH /api/filters/[id] Error:", err);
    return NextResponse.json({ error: "Gagal mengubah status filter log." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json({ error: "Sesi tidak ditemukan atau telah berakhir." }, { status: 401 });
    }

    if (session.user.role !== "admin") {
      return NextResponse.json(
        { error: "Hanya akun dengan peran 'admin' yang dapat menghapus filter log." },
        { status: 403 }
      );
    }

    const filterId = params.id;
    const [existing] = await db
      .select()
      .from(logFilters)
      .where(eq(logFilters.id, filterId))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "Aturan filter tidak ditemukan." }, { status: 404 });
    }

    await db.delete(logFilters).where(eq(logFilters.id, filterId));

    console.log(
      `[AUDIT] [${new Date().toISOString()}] Admin '${session.user.username}' deleted filter '${existing.name}' (${existing.id})`
    );

    await publishFilterInvalidate();

    return NextResponse.json({
      message: "Aturan filter log berhasil dihapus.",
    });
  } catch (err: any) {
    console.error("DELETE /api/filters/[id] Error:", err);
    return NextResponse.json({ error: "Gagal menghapus aturan filter log." }, { status: 500 });
  }
}
