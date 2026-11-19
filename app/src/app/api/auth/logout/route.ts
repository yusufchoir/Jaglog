import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@shared/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const isHttps =
      request.headers.get("x-forwarded-proto") === "https" ||
      request.url.startsWith("https:");

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("jagalog_session")?.value;

    if (sessionToken) {
      try {
        await destroySession(sessionToken);
      } catch (err) {
        console.warn("[Logout] Gagal destroySession di Redis:", err);
      }
    }

    const response = NextResponse.json({
      success: true,
      message: "Berhasil keluar dari sesi.",
    });

    // PENTING: Gunakan secure: isHttps agar cookie dapat terhapus di akses HTTP (IP lokal 192.168.x) maupun HTTPS produksi!
    response.cookies.set("jagalog_session", "", {
      httpOnly: true,
      secure: isHttps,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    const response = NextResponse.json(
      { error: "Gagal memproses keluar sesi." },
      { status: 500 }
    );
    response.cookies.set("jagalog_session", "", {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });
    return response;
  }
}

export async function GET(request: Request) {
  const isHttps =
    request.headers.get("x-forwarded-proto") === "https" ||
    request.url.startsWith("https:");

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("jagalog_session")?.value;

  if (sessionToken) {
    try {
      await destroySession(sessionToken);
    } catch {}
  }

  const response = NextResponse.redirect(new URL("/login", request.url));
  response.cookies.set("jagalog_session", "", {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
