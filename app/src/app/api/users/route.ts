import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/session";
import { db } from "@shared/db";
import { users } from "@shared/schema";
import { eq, desc } from "drizzle-orm";
import { hash } from "@shared/auth";

export const dynamic = "force-dynamic";

// 1. GET /api/users (Daftar semua pengguna - Admin only)
export async function GET() {
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat melihat daftar pengguna." },
        { status: 403 }
      );
    }

    const userList = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    return NextResponse.json({ users: userList });
  } catch (error) {
    console.error("Fetch users error:", error);
    return NextResponse.json(
      { error: "Gagal mengambil daftar pengguna." },
      { status: 500 }
    );
  }
}

// 2. POST /api/users (Tambah pengguna baru - Admin only)
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
        { error: "Akses ditolak: Hanya peran Admin yang dapat menambahkan pengguna baru." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { username, password, role } = body;

    // Validasi
    if (!username || username.trim().length < 3) {
      return NextResponse.json(
        { error: "Username minimal 3 karakter." },
        { status: 400 }
      );
    }

    if (!password || password.length < 8) {
      return NextResponse.json(
        { error: "Password awal minimal 8 karakter." },
        { status: 400 }
      );
    }

    if (role !== "admin" && role !== "viewer") {
      return NextResponse.json(
        { error: "Role harus 'admin' atau 'viewer'." },
        { status: 400 }
      );
    }

    // Cek username duplikat
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.username, username.trim().toLowerCase()))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `Username '${username}' sudah digunakan oleh pengguna lain.` },
        { status: 409 }
      );
    }

    const passwordHash = await hash(password);

    const [newUser] = await db
      .insert(users)
      .values({
        username: username.trim().toLowerCase(),
        passwordHash,
        role,
        isActive: true,
        mustChangePassword: true, // Wajib ganti saat login pertama
      })
      .returning({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
      });

    return NextResponse.json(
      {
        success: true,
        message: `Pengguna '${newUser.username}' berhasil dibuat.`,
        user: newUser,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create user error:", error);
    return NextResponse.json(
      { error: "Gagal membuat pengguna baru." },
      { status: 500 }
    );
  }
}
