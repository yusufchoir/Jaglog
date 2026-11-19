"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!newPassword || newPassword.length < 8) {
      setErrorMessage("Password baru minimal harus 8 karakter.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMessage("Konfirmasi password baru tidak cocok.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memperbarui password.");
        setIsLoading(false);
        return;
      }

      setSuccessMessage("Password berhasil diganti! Mengarahkan ke dashboard...");
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1200);
    } catch (err) {
      console.error("Change password failed:", err);
      setErrorMessage("Gagal terhubung ke server.");
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backgroundColor: "var(--bg-app)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "var(--bg-panel)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: "3px", backgroundColor: "var(--accent-red)", width: "100%" }} />

        <div style={{ padding: "32px 28px" }}>
          <div style={{ marginBottom: "20px" }}>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--accent-red)",
                textTransform: "uppercase",
                letterSpacing: "0.8px",
              }}
            >
              Keamanan Wajib
            </span>
            <h1
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
                marginBottom: "6px",
              }}
            >
              Ganti Password Akun
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary)",
                lineHeight: 1.5,
              }}
            >
              Anda sedang menggunakan password bawaan sistem. Untuk menjaga keamanan server dan log, Anda diwajibkan membuat password baru sebelum melanjutkan.
            </p>
          </div>

          {errorMessage && (
            <div
              style={{
                padding: "10px 14px",
                marginBottom: "16px",
                backgroundColor: "#FEF2F2",
                border: "1px solid #FCA5A5",
                borderLeft: "3px solid var(--accent-red)",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                color: "#991B1B",
              }}
            >
              {errorMessage}
            </div>
          )}

          {successMessage && (
            <div
              style={{
                padding: "10px 14px",
                marginBottom: "16px",
                backgroundColor: "#F0FDF4",
                border: "1px solid #86EFAC",
                borderLeft: "3px solid #16A34A",
                borderRadius: "var(--radius-sm)",
                fontSize: "13px",
                color: "#166534",
              }}
            >
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label
                htmlFor="newPassword"
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  marginBottom: "6px",
                }}
              >
                Password Baru (min. 8 karakter)
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                required
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  fontSize: "14px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-main)",
                  marginBottom: "6px",
                }}
              >
                Ulangi Password Baru
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                disabled={isLoading}
                required
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  fontSize: "14px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                }}
              />
            </div>

            <button
              type="submit"
              className="touch-target"
              disabled={isLoading}
              style={{
                marginTop: "8px",
                padding: "10px 16px",
                minHeight: "44px",
                fontSize: "14px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: isLoading ? "#93C5FD" : "var(--accent-blue)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Menyimpan..." : "Simpan Password Baru"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
