import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE_NAME = "jagalog_session";

// Daftar path publik yang tidak memerlukan autentikasi
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/health",
  "/api/ingest",
  "/api/client-error",
  "/manifest.webmanifest",
  "/manifest.json",
  "/sw.js",
  "/offline",
  "/icons/",
  "/favicon.ico",
  "/apple-touch-icon.png",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Lewati static assets Next.js, service worker, manifest, dan icons publik
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/static") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/apple-touch-icon.png"
  ) {
    const res = NextResponse.next();
    if (pathname === "/sw.js") {
      res.headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
      res.headers.set("Service-Worker-Allowed", "/");
    }
    return res;
  }

  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  // 1. Jika belum login dan mengakses halaman yang dilindungi
  if (!sessionToken && !isPublicPath) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Sesi tidak valid atau telah berakhir. Silakan login kembali." },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Buat respons dengan Header Keamanan Lengkap
  const response = NextResponse.next();

  response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self';"
  );
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
