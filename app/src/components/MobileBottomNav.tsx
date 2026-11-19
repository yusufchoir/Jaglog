"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MobileMoreSheet } from "@/components/MobileMoreSheet";
import { useCurrentUser } from "@/components/UserProvider";

interface MobileBottomNavProps {
  currentUser?: {
    username: string;
    role: "admin" | "viewer";
  };
  openIncidentCount?: number;
}

export function MobileBottomNav({
  currentUser: propUser,
  openIncidentCount = 0,
}: MobileBottomNavProps) {
  const pathname = usePathname();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const { currentUser: contextUser } = useCurrentUser();
  const currentUser = propUser || (contextUser ? { username: contextUser.username, role: contextUser.role } : undefined);

  const isRingkasanActive = pathname === "/";
  const isPerangkatActive = pathname.startsWith("/perangkat");
  const isInsidenActive = pathname.startsWith("/insiden");
  const isOtherActive =
    pathname.startsWith("/pengguna") || pathname.startsWith("/pengaturan");

  return (
    <>
      <nav
        aria-label="Navigasi Utama Mobile"
        className="mobile-flex"
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 40,
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          borderTop: "1px solid var(--border-color, #E6E4DF)",
          boxShadow: "0 -2px 10px rgba(0, 0, 0, 0.04)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          alignItems: "center",
          justifyContent: "space-around",
          height: "calc(56px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {/* 1. Ringkasan */}
        <Link
          href="/"
          prefetch={false}
          style={{
            flex: 1,
            height: "100%",
            minHeight: "44px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            color: isRingkasanActive
              ? "var(--accent-blue, #1F5FBF)"
              : "var(--text-secondary, #5B6270)",
            textDecoration: "none",
            position: "relative",
          }}
        >
          {isRingkasanActive && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "25%",
                right: "25%",
                height: "2px",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                borderRadius: "0 0 2px 2px",
              }}
            />
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={isRingkasanActive ? "2.4" : "1.8"}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span
            style={{
              fontSize: "11px",
              fontWeight: isRingkasanActive ? 700 : 500,
            }}
          >
            Ringkasan
          </span>
        </Link>

        {/* 2. Perangkat */}
        <Link
          href="/perangkat"
          prefetch={false}
          style={{
            flex: 1,
            height: "100%",
            minHeight: "44px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            color: isPerangkatActive
              ? "var(--accent-blue, #1F5FBF)"
              : "var(--text-secondary, #5B6270)",
            textDecoration: "none",
            position: "relative",
          }}
        >
          {isPerangkatActive && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "25%",
                right: "25%",
                height: "2px",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                borderRadius: "0 0 2px 2px",
              }}
            />
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={isPerangkatActive ? "2.4" : "1.8"}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <span
            style={{
              fontSize: "11px",
              fontWeight: isPerangkatActive ? 700 : 500,
            }}
          >
            Perangkat
          </span>
        </Link>

        {/* 3. Insiden */}
        <Link
          href="/insiden"
          prefetch={false}
          style={{
            flex: 1,
            height: "100%",
            minHeight: "44px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            color: isInsidenActive
              ? "var(--accent-blue, #1F5FBF)"
              : "var(--text-secondary, #5B6270)",
            textDecoration: "none",
            position: "relative",
          }}
        >
          {isInsidenActive && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "25%",
                right: "25%",
                height: "2px",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                borderRadius: "0 0 2px 2px",
              }}
            />
          )}
          <div style={{ position: "relative" }}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={isInsidenActive ? "2.4" : "1.8"}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {openIncidentCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-4px",
                  right: "-8px",
                  backgroundColor: "var(--accent-red, #C8372D)",
                  color: "#FFFFFF",
                  fontSize: "10px",
                  fontWeight: 700,
                  borderRadius: "8px",
                  padding: "0 4px",
                  minWidth: "16px",
                  height: "16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {openIncidentCount > 99 ? "99+" : openIncidentCount}
              </span>
            )}
          </div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: isInsidenActive ? 700 : 500,
            }}
          >
            Insiden
          </span>
        </Link>

        {/* 4. Lainnya */}
        <button
          type="button"
          onClick={() => setIsMoreOpen(true)}
          style={{
            flex: 1,
            height: "100%",
            minHeight: "44px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            color: isOtherActive || isMoreOpen
              ? "var(--accent-blue, #1F5FBF)"
              : "var(--text-secondary, #5B6270)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            position: "relative",
          }}
        >
          {isOtherActive && (
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "25%",
                right: "25%",
                height: "2px",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                borderRadius: "0 0 2px 2px",
              }}
            />
          )}
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={isOtherActive || isMoreOpen ? "2.4" : "1.8"}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
          <span
            style={{
              fontSize: "11px",
              fontWeight: isOtherActive || isMoreOpen ? 700 : 500,
            }}
          >
            Lainnya
          </span>
        </button>
      </nav>

      {/* Lembar Bawah Menu Lainnya */}
      <MobileMoreSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        currentUser={currentUser}
      />
    </>
  );
}
