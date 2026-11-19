"use client";

import { useEffect, useState } from "react";

export default function OfflinePage() {
  const [isOnline, setIsOnline] = useState(false);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleRetry = () => {
    window.location.reload();
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backgroundColor: "var(--bg-app, #FAFAF8)",
        color: "var(--text-main, #1F2430)",
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          padding: "32px 24px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
          textAlign: "center",
        }}
      >
        {/* Garis Aksen 3px di atas */}
        <div
          style={{
            height: "3px",
            backgroundColor: "var(--accent-red, #C8372D)",
            width: "100%",
            margin: "-32px -24px 24px -24px",
          }}
        />

        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "50%",
            backgroundColor: "rgba(200, 55, 45, 0.1)",
            color: "var(--accent-red, #C8372D)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "16px",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: "18px",
            fontWeight: 700,
            marginBottom: "8px",
            letterSpacing: "-0.3px",
          }}
        >
          Tidak Ada Koneksi Internet
        </h1>

        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary, #5B6270)",
            lineHeight: 1.5,
            marginBottom: "20px",
          }}
        >
          Data log dan status keamanan terbaru memerlukan koneksi internet aktif. Periksa koneksi Wi-Fi atau data seluler Anda.
        </p>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: isOnline ? "#15803D" : "#B91C1C",
            backgroundColor: isOnline ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
            padding: "4px 10px",
            borderRadius: "4px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: isOnline ? "#22C55E" : "#EF4444",
            }}
          />
          <span>{isOnline ? "Jaringan terdeteksi kembali" : "Perangkat sedang offline"}</span>
        </div>

        <div>
          <button
            onClick={handleRetry}
            style={{
              width: "100%",
              minHeight: "44px",
              padding: "10px 16px",
              fontSize: "14px",
              fontWeight: 600,
              backgroundColor: "var(--accent-blue, #1F5FBF)",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Coba Lagi
          </button>
        </div>
      </div>
    </div>
  );
}
