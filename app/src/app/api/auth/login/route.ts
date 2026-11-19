import { NextResponse } from "next/server";
import {
  authenticateUser,
  checkRateLimit,
  recordFailedLogin,
  resetLoginAttempts,
  createSession,
  SESSION_TTL_SECONDS,
} from "@shared/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username dan password wajib diisi." },
        { status: 400 }
      );
    }

    // Ambil IP address pengirim
    const forwardedFor = request.headers.get("x-forwarded-for");
    const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";

    // 1. Cek Rate Limit (5 gagal per 15 menit)
    const rateLimit = await checkRateLimit(ip, username);
    if (!rateLimit.allowed) {
      const waitMinutes = Math.ceil(rateLimit.retryAfterSeconds / 60);
      return NextResponse.json(
        {
          error: `Terlalu banyak percobaan login gagal. Akun dibatasi sementara demi keamanan. Silakan coba lagi dalam ${waitMinutes} menit.`,
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        { status: 429 }
      );
    }

    // 2. Autentikasi Pengguna
    const authResult = await authenticateUser(username, password);

    if (!authResult.success) {
      if (authResult.reason === "db_error") {
        return NextResponse.json(
          {
            error: "Koneksi database belum siap atau gagal terhubung. Silakan periksa status database PostgreSQL di Coolify.",
            detail: authResult.message,
          },
          { status: 503 }
        );
      }

      const failedAttempts = await recordFailedLogin(ip, username);
      const remaining = Math.max(0, 5 - failedAttempts);

      let errorMessage = "Username atau password salah.";
      if (authResult.reason === "inactive") {
        errorMessage = "Akun Anda telah dinonaktifkan. Hubungi administrator.";
      } else if (remaining > 0) {
        errorMessage += ` Sisa percobaan: ${remaining} kali sebelum akun dibatasi sementara.`;
      } else {
        errorMessage = "Batas percobaan gagal terlampaui. Akun dibatasi selama 15 menit.";
      }

      return NextResponse.json(
        { error: errorMessage, remainingAttempts: remaining },
        { status: 401 }
      );
    }


    // 3. Reset rate limit counter setelah login berhasil
    await resetLoginAttempts(ip, username);

    // 4. Buat sesi di Redis
    const sessionToken = await createSession({
      userId: authResult.user.id,
      username: authResult.user.username,
      role: authResult.user.role,
      mustChangePassword: authResult.user.mustChangePassword,
      createdAt: Date.now(),
    });

    // 5. Tentukan tujuan redirect
    const redirectTo = authResult.user.mustChangePassword
      ? "/ganti-password"
      : "/";

    const response = NextResponse.json({
      success: true,
      message: "Login berhasil.",
      user: {
        username: authResult.user.username,
        role: authResult.user.role,
        mustChangePassword: authResult.user.mustChangePassword,
      },
      redirectTo,
    });

    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.url.startsWith("https:");

    // Pasang cookie httpOnly, secure di production HTTPS, sameSite=lax, 12 jam
    response.cookies.set("jagalog_session", sessionToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Terjadi kesalahan pada server saat memproses login." },
      { status: 500 }
    );
  }
}
