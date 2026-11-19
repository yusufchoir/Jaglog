import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LiveUpdateProvider } from "@/components/LiveUpdateProvider";
import { SWRegistration } from "@/components/SWRegistration";
import { UserProvider } from "@/components/UserProvider";
import { AppShell } from "@/components/AppShell";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAFAF8",
};

export const metadata: Metadata = {
  title: "JagaLog – Pemantauan & Analisa Log Perangkat Jaringan",
  description: "Aplikasi Penerima & Analisa Log Perangkat Jaringan dengan AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "JagaLog",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icons/apple-touch-icon.png",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let currentUser = null;
  try {
    currentUser = await getCurrentUser();
  } catch (err) {
    console.warn("[RootLayout] Sesi pengguna belum aktif di server:", err);
  }

  return (
    <html lang="id">
      <body>
        <UserProvider initialUser={currentUser}>
          <LiveUpdateProvider>
            <AppShell>
              {children}
            </AppShell>
            <SWRegistration />
          </LiveUpdateProvider>
        </UserProvider>
      </body>
    </html>
  );
}
