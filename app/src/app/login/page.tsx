"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPath = searchParams.get("from") || "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim() || !password) {
      setErrorMessage("Username dan password wajib diisi.");
      return;
    }

    setIsLoading(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let data: any = {};
      try {
        data = await res.json();
      } catch (jsonErr) {
        console.warn("Response is not JSON:", jsonErr);
      }

      if (!res.ok) {
        const detailMsg = data.detail ? ` (${data.detail})` : "";
        setErrorMessage(
          data.error
            ? `${data.error}${detailMsg}`
            : `Gagal masuk (HTTP ${res.status}). Periksa kembali kredensial atau status database.`
        );
        setIsLoading(false);
        return;
      }

      if (data.redirectTo) {
        router.push(data.redirectTo);
      } else {
        router.push(fromPath);
      }
      router.refresh();
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Login request failed:", err);
      if (err.name === "AbortError") {
        setErrorMessage("Waktu tunggu habis (timeout). Server atau database tidak merespons dalam 10 detik.");
      } else {
        setErrorMessage("Tidak dapat terhubung ke server. Periksa jaringan atau status aplikasi.");
      }
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "400px",
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      {/* Garis Aksen 3px di atas kartu */}
      <div style={{ height: "3px", backgroundColor: "var(--accent-blue)", width: "100%" }} />

      <div style={{ padding: "32px 24px" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--text-main)",
              letterSpacing: "-0.3px",
              marginBottom: "6px",
            }}
          >
            Masuk ke JagaLog
          </h1>
          <p
            style={{
              fontSize: "13px",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            Platform pemantauan dan analisa log keamanan perangkat jaringan.
          </p>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "20px",
              backgroundColor: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderLeft: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              color: "#991B1B",
              lineHeight: 1.4,
            }}
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label
              htmlFor="username"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "6px",
              }}
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="misal: admin"
              disabled={isLoading}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "16px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "#FFFFFF",
                color: "var(--text-main)",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--accent-blue)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              style={{
                display: "block",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--text-main)",
                marginBottom: "6px",
              }}
            >
              Password
            </label>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                style={{
                  width: "100%",
                  padding: "10px 44px 10px 12px",
                  fontSize: "16px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                }}
                onFocus={(e) => (e.target.style.borderColor = "var(--accent-blue)")}
                onBlur={(e) => (e.target.style.borderColor = "var(--border-color)")}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                style={{
                  position: "absolute",
                  right: "4px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  width: "40px",
                  height: "40px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  borderRadius: "4px",
                }}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            style={{
              marginTop: "8px",
              minHeight: "44px",
              padding: "10px 16px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: isLoading ? "#93C5FD" : "var(--accent-blue)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: isLoading ? "not-allowed" : "pointer",
              transition: "background-color 0.15s ease",
            }}
          >
            {isLoading ? "Memverifikasi..." : "Masuk"}
          </button>
        </form>

        <div
          style={{
            marginTop: "24px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border-color)",
            fontSize: "12px",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
          }}
        >
          Sesi aktif selama 12 jam. Percobaan login dibatasi maksimal 5 kali per 15 menit untuk melindungi sistem dari brute force.
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "calc(16px + env(safe-area-inset-top, 0px)) 16px calc(16px + env(safe-area-inset-bottom, 0px)) 16px",
        backgroundColor: "var(--bg-app)",
      }}
    >
      <Suspense fallback={<div style={{ color: "var(--text-secondary)" }}>Memuat halaman masuk...</div>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
