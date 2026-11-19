"use client";

import React, { useEffect, useState } from "react";
import { reportClientError, handleChunkLoadRecovery } from "@/lib/client-logger";

export default function GlobalError({
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
    if (handleChunkLoadRecovery(error)) {
      return;
    }

    reportClientError(error, {
      errorId,
      path: typeof window !== "undefined" ? window.location.pathname : "/",
      komponen: "GlobalRootLayout",
    });
  }, [error, errorId]);

  return (
    <html lang="id">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: "#FAFAF8",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              maxWidth: "480px",
              width: "100%",
              backgroundColor: "#FFFFFF",
              border: "1px solid #C8372D",
              borderRadius: "8px",
              padding: "32px 28px",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "24px",
                backgroundColor: "rgba(200, 55, 45, 0.1)",
                color: "#C8372D",
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
                color: "#1F2430",
                margin: "0 0 8px 0",
              }}
            >
              Terjadi Kesalahan Sistem
            </h2>

            <p
              style={{
                fontSize: "13px",
                color: "#5B6270",
                lineHeight: 1.6,
                margin: "0 0 20px 0",
              }}
            >
              Terjadi kesalahan saat menampilkan halaman ini. Data Anda aman.
            </p>

            <div
              style={{
                display: "inline-block",
                backgroundColor: "#F3F4F6",
                border: "1px solid #E5E7EB",
                borderRadius: "4px",
                padding: "6px 12px",
                fontSize: "11px",
                color: "#4B5563",
                marginBottom: "24px",
                fontFamily: "monospace",
              }}
            >
              Kode Referensi: <strong>{errorId}</strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <button
                onClick={() => reset()}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  backgroundColor: "#1D4ED8",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Coba lagi
              </button>

              <button
                onClick={() => window.location.reload()}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  backgroundColor: "#FFFFFF",
                  color: "#1F2430",
                  border: "1px solid #D1D5DB",
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
                  color: "#1D4ED8",
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
      </body>
    </html>
  );
}

