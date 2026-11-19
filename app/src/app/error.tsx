"use client";

import React, { useEffect, useState } from "react";
import { reportClientError, handleChunkLoadRecovery } from "@/lib/client-logger";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [errorId] = useState(() => {
    return (
      error.digest ||
      `ERR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    );
  });

  useEffect(() => {
    // 1. Cek apakah ini ChunkLoadError (modul usang pasca redeploy) -> reload otomatis 1x
    if (handleChunkLoadRecovery(error)) {
      return;
    }

    // 2. Laporkan ke server
    reportClientError(error, {
      errorId,
      path: typeof window !== "undefined" ? window.location.pathname : "/",
      komponen: "AppRootErrorBoundary",
    });
  }, [error, errorId]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--bg-app, #FAFAF8)",
        padding: "24px",
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif)",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: "1px solid var(--accent-red, #C8372D)",
          borderRadius: "8px",
          padding: "32px 28px",
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.06)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "48px",
            height: "48px",
            borderRadius: "24px",
            backgroundColor: "rgba(200, 55, 45, 0.1)",
            color: "var(--accent-red, #C8372D)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px auto",
            fontSize: "22px",
            fontWeight: 700,
          }}
        >
          !
        </div>

        <h2
          style={{
            fontSize: "18px",
            fontWeight: 700,
            color: "var(--text-main, #1F2430)",
            margin: "0 0 8px 0",
          }}
        >
          Terjadi Kesalahan
        </h2>

        <p
          style={{
            fontSize: "13px",
            color: "var(--text-secondary, #5B6270)",
            lineHeight: 1.6,
            margin: "0 0 20px 0",
          }}
        >
          Terjadi kesalahan saat menampilkan halaman ini. Data Anda aman.
        </p>

        <div
          style={{
            display: "inline-block",
            backgroundColor: "var(--bg-app, #FAFAF8)",
            border: "1px solid var(--border-subtle, #E5E7EB)",
            borderRadius: "4px",
            padding: "6px 12px",
            fontSize: "11px",
            color: "var(--text-secondary, #5B6270)",
            marginBottom: "24px",
            fontFamily: "monospace",
          }}
        >
          Kode Referensi: <strong>{errorId}</strong>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <button
            onClick={() => reset()}
            style={{
              width: "100%",
              padding: "10px 16px",
              backgroundColor: "var(--accent-blue, #1D4ED8)",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
              transition: "background-color 0.15s ease",
            }}
          >
            Coba lagi
          </button>

          <button
            onClick={() => window.location.reload()}
            style={{
              width: "100%",
              padding: "10px 16px",
              backgroundColor: "var(--bg-panel, #FFFFFF)",
              color: "var(--text-main, #1F2430)",
              border: "1px solid var(--border-subtle, #D1D5DB)",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Muat ulang halaman
          </button>

          <a
            href="/"
            style={{
              display: "block",
              width: "100%",
              padding: "10px 16px",
              backgroundColor: "transparent",
              color: "var(--accent-blue, #1D4ED8)",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
              boxSizing: "border-box",
            }}
          >
            Kembali ke Ringkasan
          </a>
        </div>
      </div>
    </div>
  );
}

