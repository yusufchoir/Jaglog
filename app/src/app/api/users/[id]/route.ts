import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hash, invalidateUserRoleCache } from "@shared/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat mengubah pengguna." },
        { status: 403 }
      );
    }

    const { id: targetUserId } = await params;
    const body = await request.json();
    const { isActive, role, newPassword } = body;

    const [targetUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json(
        { error: "Pengguna tidak ditemukan." },
        { status: 404 }
      );
    }

    // Proteksi: Admin tidak boleh menonaktifkan akunnya sendiri
    if (isActive === false && targetUser.id === session.user.userId) {
      return NextResponse.json(
        { error: "Anda tidak dapat menonaktifkan akun Anda sendiri." },
        { status: 400 }
      );
    }

    // Proteksi: Admin tidak boleh mencabut peran admin dari akunnya sendiri
    if (role === "viewer" && targetUser.id === session.user.userId) {
      return NextResponse.json(
        { error: "Anda tidak dapat menurunkan role akun Anda sendiri menjadi viewer." },
        { status: 400 }
      );
    }

    const updateData: Partial<typeof targetUser> = {};

    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }

    if (role && (role === "admin" || role === "viewer")) {
      updateData.role = role;
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: "Password baru minimal 8 karakter." },
          { status: 400 }
        );
      }
      updateData.passwordHash = await hash(newPassword);
      updateData.mustChangePassword = true;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "Tidak ada data yang diubah." },
        { status: 400 }
      );
    }

    await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, targetUserId));

    // Invalidasi cache peran di Redis agar perubahan langsung aktif
    await invalidateUserRoleCache(targetUserId);

    return NextResponse.json({
      success: true,
      message: `Data pengguna '${targetUser.username}' berhasil diperbarui.`,
    });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json(
      { error: "Gagal memperbarui pengguna." },
      { status: 500 }
    );
  }
}
