"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { useCurrentUser, CurrentUser } from "@/components/UserProvider";

interface HeaderNavProps {
  currentUser?: {
    username: string;
    role: "admin" | "viewer";
    displayName?: string;
  };
}

export function HeaderNav({ currentUser: propUser }: HeaderNavProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { isReconnectingVisible } = useLiveUpdates();
  const { currentUser: contextUser, roleStatus, refreshUser } = useCurrentUser();

  const currentUser: CurrentUser | null = (propUser as any) || contextUser;
  const isAdmin = currentUser?.role === "admin";
  const isCheckingRole = roleStatus === "checking" && !currentUser;
  const isRoleError = roleStatus === "error" && !currentUser;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHE" });
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      }
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Gagal logout:", err);
      setIsLoggingOut(false);
    }
  };

  const getMobileTitle = (path: string) => {
    if (path === "/") return "Ringkasan";
    if (path.startsWith("/peta")) return "Peta Jaringan";
    if (path.startsWith("/perangkat/")) return "Detail Perangkat";
    if (path.startsWith("/perangkat")) return "Daftar Perangkat";
    if (path.startsWith("/grup/")) return "Detail Grup";
    if (path.startsWith("/grup")) return "Daftar Grup";
    if (path.startsWith("/insiden")) return "Insiden";
    if (path.startsWith("/pengguna")) return "Pengguna";
    if (path.startsWith("/pengaturan")) return "Pengaturan";
    return "JagaLog";
  };

  return (
    <>
      <header
        style={{
          backgroundColor: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-color)",
          position: "sticky",
          top: 0,
          zIndex: 50,
          paddingTop: "env(safe-area-inset-top, 0px)",
        }}
      >
        <div
          style={{
            height: "2px",
            backgroundColor: "var(--accent-blue)",
            width: "100%",
          }}
        />

        {/* TAMPILAN DESKTOP (>= 768px): 100% Identik Sesuai Desain Awal */}
        <div
          className="desktop-only"
          style={{
            width: "100%",
          }}
        >
          <div
            style={{
              maxWidth: "1200px",
              margin: "0 auto",
              padding: "0 24px",
              height: "56px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "32px" }}>
              <Link
                href="/"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  textDecoration: "none",
                }}
              >
                <div
                  style={{
                    width: "10px",
                    height: "10px",
                    backgroundColor: "var(--accent-blue)",
                    borderRadius: "2px",
                  }}
                />
                <span
                  style={{
                    fontSize: "17px",
                    fontWeight: 700,
                    letterSpacing: "-0.4px",
                    color: "var(--text-main)",
                  }}
                >
                  JagaLog
                </span>
              </Link>

              <nav style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Link
                  href="/"
                  prefetch={false}
                  style={{
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: pathname === "/" ? 600 : 500,
                    color: pathname === "/" ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: pathname === "/" ? "rgba(31, 95, 191, 0.08)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Ringkasan
                </Link>

                <Link
                  href="/perangkat"
                  prefetch={false}
                  style={{
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: pathname.startsWith("/perangkat") ? 600 : 500,
                    color: pathname.startsWith("/perangkat") ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: pathname.startsWith("/perangkat") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Perangkat
                </Link>

                <Link
                  href="/grup"
                  prefetch={false}
                  style={{
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: pathname.startsWith("/grup") ? 600 : 500,
                    color: pathname.startsWith("/grup") ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: pathname.startsWith("/grup") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Grup
                </Link>

                <Link
                  href="/peta"
                  prefetch={false}
                  style={{
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: pathname.startsWith("/peta") ? 600 : 500,
                    color: pathname.startsWith("/peta") ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: pathname.startsWith("/peta") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Peta
                </Link>

                <Link
                  href="/insiden"
                  prefetch={false}
                  style={{
                    padding: "6px 12px",
                    fontSize: "13px",
                    fontWeight: pathname.startsWith("/insiden") ? 600 : 500,
                    color: pathname.startsWith("/insiden") ? "var(--accent-blue)" : "var(--text-secondary)",
                    backgroundColor: pathname.startsWith("/insiden") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                    borderRadius: "var(--radius-sm)",
                    transition: "all 0.15s ease",
                  }}
                >
                  Insiden
                </Link>

                {isAdmin && (
                  <>
                    <Link
                      href="/pengguna"
                      prefetch={false}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        fontWeight: pathname.startsWith("/pengguna") ? 600 : 500,
                        color: pathname.startsWith("/pengguna") ? "var(--accent-blue)" : "var(--text-secondary)",
                        backgroundColor: pathname.startsWith("/pengguna") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                        borderRadius: "var(--radius-sm)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Pengguna
                    </Link>

                    <Link
                      href="/pengaturan"
                      prefetch={false}
                      style={{
                        padding: "6px 12px",
                        fontSize: "13px",
                        fontWeight: pathname.startsWith("/pengaturan") ? 600 : 500,
                        color: pathname.startsWith("/pengaturan") ? "var(--accent-blue)" : "var(--text-secondary)",
                        backgroundColor: pathname.startsWith("/pengaturan") ? "rgba(31, 95, 191, 0.08)" : "transparent",
                        borderRadius: "var(--radius-sm)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      Pengaturan
                    </Link>
                  </>
                )}
              </nav>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {mounted && isReconnectingVisible && (
                <div
                  title="Koneksi terputus sementara. Sedang mencoba menyambung ulang..."
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--warning, #D97706)",
                    backgroundColor: "rgba(217, 119, 6, 0.08)",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      backgroundColor: "var(--warning, #D97706)",
                      display: "inline-block",
                    }}
                  />
                  <span>Menyambung ulang...</span>
                </div>
              )}

              {/* Status Sesi & Peran Pengguna */}
              {isCheckingRole && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--text-secondary)",
                    backgroundColor: "rgba(0, 0, 0, 0.04)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      backgroundColor: "#9CA3AF",
                      display: "inline-block",
                    }}
                  />
                  <span>Memeriksa peran...</span>
                </div>
              )}

              {isRoleError && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    color: "var(--accent-red)",
                    backgroundColor: "rgba(200, 55, 45, 0.08)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                  }}
                >
                  <span>Tidak dapat memeriksa hak akses.</span>
                  <button
                    onClick={() => refreshUser()}
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      backgroundColor: "var(--accent-red)",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "3px",
                      cursor: "pointer",
                    }}
                  >
                    Muat ulang
                  </button>
                </div>
              )}

              {currentUser && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                    {currentUser.displayName || currentUser.username}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      backgroundColor: currentUser.role === "admin" ? "#FEF3C7" : "#EDF2F7",
                      color: currentUser.role === "admin" ? "#92400E" : "#4A5568",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {currentUser.role}
                  </span>
                </div>
              )}

              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                style={{
                  padding: "6px 12px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--text-secondary)",
                  backgroundColor: "transparent",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: isLoggingOut ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.color = "var(--accent-red)";
                  e.currentTarget.style.borderColor = "var(--accent-red)";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                  e.currentTarget.style.borderColor = "var(--border-color)";
                }}
              >
                {isLoggingOut ? "Keluar..." : "Keluar"}
              </button>
            </div>
          </div>
        </div>

        {/* TAMPILAN MOBILE (< 768px): Header Ringkas & Cepat */}
        <div
          className="mobile-flex"
          style={{
            height: "52px",
            padding: "0 16px",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
          }}
        >
          {/* Logo & Judul Halaman */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                textDecoration: "none",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: "9px",
                  height: "9px",
                  backgroundColor: "var(--accent-blue)",
                  borderRadius: "2px",
                }}
              />
              <span
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  letterSpacing: "-0.3px",
                }}
              >
                JagaLog
              </span>
            </Link>

            <span style={{ color: "var(--border-color)", fontSize: "14px" }}>|</span>

            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-secondary)",
              }}
            >
              {mounted ? getMobileTitle(pathname) : "JagaLog"}
            </span>
          </div>

          {/* Status Live & Profil Singkat */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {mounted && isReconnectingVisible ? (
              <span
                title="Menyambung ulang..."
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#D97706",
                  display: "inline-block",
                }}
              />
            ) : (
              <span
                title="Terhubung Live (SSE)"
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: "#22C55E",
                  display: "inline-block",
                }}
              />
            )}

            {isCheckingRole && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(0, 0, 0, 0.05)",
                  color: "var(--text-secondary)",
                }}
              >
                Memeriksa...
              </span>
            )}

            {currentUser && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "2px 6px",
                  borderRadius: "4px",
                  backgroundColor: currentUser.role === "admin" ? "#FEF3C7" : "#EDF2F7",
                  color: currentUser.role === "admin" ? "#92400E" : "#4A5568",
                  textTransform: "uppercase",
                }}
              >
                {currentUser.role}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Navigasi Bawah Mobile Fixed */}
      <MobileBottomNav currentUser={currentUser || undefined} />
    </>
  );
}
