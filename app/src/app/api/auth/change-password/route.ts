import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hash, updateSessionData } from "@shared/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return NextResponse.json(
        { error: "Sesi tidak ditemukan atau telah kedaluwarsa. Silakan login kembali." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { newPassword, confirmPassword } = body;

    if (!newPassword || newPassword.length < 8) {
      return NextResponse.json(
        { error: "Password baru minimal terdiri dari 8 karakter." },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "Konfirmasi password baru tidak cocok." },
        { status: 400 }
      );
    }

    // Hash password baru dengan argon2id
    const passwordHash = await hash(newPassword);

    // Update di database
    await db
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: false,
      })
      .where(eq(users.id, session.user.userId));

    // Update data di sesi Redis
    await updateSessionData(session.token, { mustChangePassword: false });

    return NextResponse.json({
      success: true,
      message: "Password berhasil diperbarui.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan saat memperbarui password." },
      { status: 500 }
    );
  }
}
