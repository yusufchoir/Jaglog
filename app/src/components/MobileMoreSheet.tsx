"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/BottomSheet";
import { usePWAInstall } from "@/components/PWAInstallPrompt";
import { useCurrentUser } from "@/components/UserProvider";

interface MobileMoreSheetProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: {
    username: string;
    role: "admin" | "viewer";
    displayName?: string;
  };
}

export function MobileMoreSheet({
  isOpen,
  onClose,
  currentUser: propUser,
}: MobileMoreSheetProps) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { canInstall, isIOS, isStandalone, promptInstall } = usePWAInstall();
  const { currentUser: contextUser } = useCurrentUser();
  const currentUser = propUser || (contextUser ? { username: contextUser.username, role: contextUser.role, displayName: contextUser.displayName } : undefined);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      if (typeof window !== "undefined" && "serviceWorker" in navigator) {
        try {
          navigator.serviceWorker.controller?.postMessage({ type: "CLEAR_CACHE" });
        } catch {}
      }
      if (typeof window !== "undefined" && "caches" in window) {
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {}
      }
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    } catch (err) {
      console.warn("Gagal logout:", err);
    } finally {
      onClose();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      } else {
        router.push("/login");
      }
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title="Menu & Akun">
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* User Card */}
        {currentUser && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              backgroundColor: "#F8F8F6",
              borderRadius: "6px",
              border: "1px solid var(--border-color, #E6E4DF)",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 700,
                  color: "var(--text-main, #1F2430)",
                }}
              >
                {currentUser.displayName || currentUser.username}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                Sesi aktif (12 jam)
              </div>
            </div>
            <span
              style={{
                fontSize: "11px",
                padding: "3px 8px",
                borderRadius: "4px",
                backgroundColor:
                  currentUser.role === "admin" ? "#FEF3C7" : "#EDF2F7",
                color: currentUser.role === "admin" ? "#92400E" : "#4A5568",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {currentUser.role}
            </span>
          </div>
        )}

        {/* Navigasi Utama Tambahan */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "var(--text-muted, #718096)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Visualisasi & Peta
          </span>

          <Link
            href="/grup"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: "44px",
              padding: "10px 14px",
              borderRadius: "4px",
              backgroundColor: "#FFFFFF",
              border: "1px solid var(--border-color, #E6E4DF)",
              color: "var(--text-main, #1F2430)",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
              <span>Grup & Area Perangkat</span>
            </div>
            <span style={{ color: "var(--text-muted, #718096)" }}>→</span>
          </Link>

          <Link
            href="/peta"
            onClick={onClose}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              minHeight: "44px",
              padding: "10px 14px",
              borderRadius: "4px",
              backgroundColor: "#FFFFFF",
              border: "1px solid var(--border-color, #E6E4DF)",
              color: "var(--text-main, #1F2430)",
              fontSize: "14px",
              fontWeight: 500,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
              <span>Peta Jaringan & Topologi</span>
            </div>
            <span style={{ color: "var(--text-muted, #718096)" }}>→</span>
          </Link>
        </div>

        {/* Navigation Options for Admin */}
        {currentUser?.role === "admin" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--text-muted, #718096)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Administrasi Sistem
            </span>

            <Link
              href="/pengguna"
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: "44px",
                padding: "10px 14px",
                borderRadius: "4px",
                backgroundColor: "#FFFFFF",
                border: "1px solid var(--border-color, #E6E4DF)",
                color: "var(--text-main, #1F2430)",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span>Kelola Pengguna</span>
              </div>
              <span style={{ color: "var(--text-muted, #718096)" }}>→</span>
            </Link>

            <Link
              href="/pengaturan"
              onClick={onClose}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minHeight: "44px",
                padding: "10px 14px",
                borderRadius: "4px",
                backgroundColor: "#FFFFFF",
                border: "1px solid var(--border-color, #E6E4DF)",
                color: "var(--text-main, #1F2430)",
                fontSize: "14px",
                fontWeight: 500,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Pengaturan Sistem</span>
              </div>
              <span style={{ color: "var(--text-muted, #718096)" }}>→</span>
            </Link>
          </div>
        )}

        {/* PWA Installation Card / Action */}
        {!isStandalone && (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--text-muted, #718096)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Aplikasi Mobile (PWA)
            </span>

            {canInstall && (
              <button
                type="button"
                onClick={promptInstall}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  minHeight: "44px",
                  padding: "10px 14px",
                  borderRadius: "4px",
                  backgroundColor: "#F0FDF4",
                  border: "1px solid #BBF7D0",
                  color: "#166534",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Pasang Aplikasi JagaLog (PWA)</span>
                </div>
                <span>+</span>
              </button>
            )}

            {isIOS && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: "4px",
                  backgroundColor: "#F8FAFC",
                  border: "1px solid var(--border-color, #E6E4DF)",
                  fontSize: "12px",
                  color: "var(--text-secondary, #5B6270)",
                  lineHeight: 1.5,
                }}
              >
                <strong>Di iPhone / iPad:</strong> Tekan tombol <strong>Bagikan (Share)</strong> di Safari lalu pilih <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
              </div>
            )}
          </div>
        )}

        {/* Action Logout */}
        <div style={{ marginTop: "8px" }}>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            style={{
              width: "100%",
              minHeight: "44px",
              padding: "10px 16px",
              borderRadius: "4px",
              backgroundColor: "transparent",
              border: "1px solid var(--border-color, #E6E4DF)",
              color: "var(--accent-red, #C8372D)",
              fontSize: "14px",
              fontWeight: 600,
              cursor: isLoggingOut ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{isLoggingOut ? "Sedang Keluar..." : "Keluar dari Akun"}</span>
          </button>
        </div>

        {/* Footer info */}
        <div
          style={{
            textAlign: "center",
            fontSize: "11px",
            color: "var(--text-muted, #718096)",
            marginTop: "4px",
          }}
        >
          JagaLog v1.0.0 – Pemantauan & Analisa Log Jaringan
        </div>
      </div>
    </BottomSheet>
  );
}
