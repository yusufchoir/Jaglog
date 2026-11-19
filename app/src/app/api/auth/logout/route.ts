import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { destroySession } from "@shared/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get("jagalog_session")?.value;

    if (sessionToken) {
      await destroySession(sessionToken);
    }

    const response = NextResponse.json({
      success: true,
      message: "Berhasil keluar dari sesi.",
    });

    response.cookies.set("jagalog_session", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json(
      { error: "Gagal memproses keluar sesi." },
      { status: 500 }
    );
  }
}
