"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface UserItem {
  id: string;
  username: string;
  role: "admin" | "viewer";
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}

export default function UsersManagementPage() {
  const [currentUser, setCurrentUser] = useState<{ username: string; role: "admin" | "viewer" } | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // State Modal Tambah User
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"viewer" | "admin">("viewer");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // State Modal Reset Password User
  const [resetTargetUser, setResetTargetUser] = useState<UserItem | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [processingUserId, setProcessingUserId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/users");
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memuat daftar pengguna.");
        setIsLoading(false);
        return;
      }

      setUsers(data.users || []);
    } catch (err) {
      console.error(err);
      setErrorMessage("Tidak dapat terhubung ke server.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal membuat pengguna baru.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(`Pengguna '${newUsername}' berhasil ditambahkan.`);
      setIsAddModalOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("viewer");
      fetchUsers();
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: UserItem) => {
    if (processingUserId === user.id) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const nextActive = !user.isActive;
    const actionText = nextActive ? "mengaktifkan" : "menonaktifkan";
    const actionVerb = nextActive ? "diaktifkan" : "dinonaktifkan";

    // Optimistic update
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isActive: nextActive } : u))
    );
    setProcessingUserId(user.id);

    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback otomatis
        setUsers((prev) =>
          prev.map((u) => (u.id === user.id ? { ...u, isActive: !nextActive } : u))
        );
        setErrorMessage(data.error || `Gagal ${actionText} pengguna.`);
        return;
      }

      setSuccessMessage(data.message || `Akun '${user.username}' berhasil ${actionVerb}.`);
    } catch (err) {
      console.error(err);
      // Rollback
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isActive: !nextActive } : u))
      );
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setProcessingUserId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTargetUser) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    setIsSubmitting(true);

    try {
      const res = await fetch(`/api/users/${resetTargetUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: resetPasswordValue }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memperbarui password pengguna.");
        setIsSubmitting(false);
        return;
      }

      setSuccessMessage(`Password akun '${resetTargetUser.username}' berhasil diubah.`);
      setResetTargetUser(null);
      setResetPasswordValue("");
      fetchUsers();
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header Halaman */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "20px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: "var(--text-main)",
                letterSpacing: "-0.3px",
              }}
            >
              Manajemen Pengguna
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Kelola hak akses operator dan administrator sistem JagaLog.
            </p>
          </div>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="touch-target"
            style={{
              padding: "8px 14px",
              minHeight: "44px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#FFFFFF",
              backgroundColor: "var(--accent-blue)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            + Tambah Pengguna
          </button>
        </div>

        {/* Notifikasi Alert */}
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

        {/* Tabel Data Pengguna */}
        <div
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div style={{ height: "2px", backgroundColor: "var(--accent-blue)", width: "100%" }} />

          <div className="desktop-only" style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "13px",
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: "#F8F8F6",
                    borderBottom: "1px solid var(--border-color)",
                    color: "var(--text-secondary)",
                    height: "38px",
                  }}
                >
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Username</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Peran (Role)</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Perlu Ganti Password</th>
                  <th style={{ padding: "0 16px", fontWeight: 600 }}>Dibuat Pada</th>
                  <th style={{ padding: "0 16px", fontWeight: 600, textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Memuat daftar pengguna...
                    </td>
                  </tr>
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Belum ada pengguna terdaftar.
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr
                      key={u.id}
                      style={{
                        height: "44px",
                        borderBottom: "1px solid var(--border-color)",
                      }}
                    >
                      <td style={{ padding: "0 16px", fontWeight: 600, color: "var(--text-main)" }}>
                        <span className="font-mono">{u.username}</span>
                      </td>
                      <td style={{ padding: "0 16px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            backgroundColor: u.role === "admin" ? "#FEF3C7" : "#EDF2F7",
                            color: u.role === "admin" ? "#92400E" : "#4A5568",
                            fontWeight: 600,
                            textTransform: "uppercase",
                          }}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td style={{ padding: "0 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            color: u.isActive ? "#15803D" : "#B91C1C",
                            fontWeight: 500,
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              backgroundColor: u.isActive ? "#22C55E" : "#EF4444",
                            }}
                          />
                          {u.isActive ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td style={{ padding: "0 16px", color: "var(--text-secondary)" }}>
                        {u.mustChangePassword ? (
                          <span style={{ color: "#D97706", fontWeight: 500 }}>Ya (Login awal)</span>
                        ) : (
                          "Tidak"
                        )}
                      </td>
                      <td style={{ padding: "0 16px", color: "var(--text-secondary)" }}>
                        <span className="font-mono" style={{ fontSize: "12px" }}>
                          {new Date(u.createdAt).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            year: "numeric",
                            month: "short",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          WIB
                        </span>
                      </td>
                      <td style={{ padding: "0 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setResetTargetUser(u);
                              setResetPasswordValue("");
                            }}
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "transparent",
                              color: "var(--text-main)",
                              cursor: "pointer",
                            }}
                          >
                            Ganti Password
                          </button>
                          <button
                            type="button"
                            disabled={processingUserId === u.id}
                            onClick={() => handleToggleStatus(u)}
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "transparent",
                              color: u.isActive ? "var(--accent-red)" : "var(--accent-blue)",
                              cursor: processingUserId === u.id ? "not-allowed" : "pointer",
                              opacity: processingUserId === u.id ? 0.6 : 1,
                            }}
                          >
                            {processingUserId === u.id
                              ? "Memproses..."
                              : u.isActive
                              ? "Nonaktifkan"
                              : "Aktifkan"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List */}
          <div className="mobile-only" style={{ display: "none" }}>
            {isLoading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                Memuat daftar pengguna...
              </div>
            ) : users.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                Belum ada pengguna terdaftar.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px" }}>
                {users.map((u) => (
                  <div
                    key={`mob-${u.id}`}
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderLeft: u.isActive ? "3px solid #22C55E" : "3px solid var(--accent-red)",
                      borderRadius: "var(--radius-sm)",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                      <span className="font-mono" style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-main)" }}>
                        {u.username}
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: u.role === "admin" ? "#FEF3C7" : "#EDF2F7",
                          color: u.role === "admin" ? "#92400E" : "#4A5568",
                          fontWeight: 600,
                          textTransform: "uppercase",
                        }}
                      >
                        {u.role}
                      </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          color: u.isActive ? "#15803D" : "#B91C1C",
                          fontWeight: 500,
                        }}
                      >
                        <span
                          style={{
                            width: "6px",
                            height: "6px",
                            borderRadius: "50%",
                            backgroundColor: u.isActive ? "#22C55E" : "#EF4444",
                          }}
                        />
                        {u.isActive ? "Aktif" : "Nonaktif"}
                      </span>

                      {u.mustChangePassword && (
                        <span style={{ color: "#D97706", fontSize: "11px", fontWeight: 500 }}>
                          Perlu ganti password
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                      Dibuat:{" "}
                      <span className="font-mono">
                        {new Date(u.createdAt).toLocaleDateString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: "8px", marginTop: "4px", paddingTop: "8px", borderTop: "1px solid var(--border-color)" }}>
                      <button
                        type="button"
                        className="touch-target"
                        onClick={() => {
                          setResetTargetUser(u);
                          setResetPasswordValue("");
                        }}
                        style={{
                          flex: 1,
                          minHeight: "44px",
                          padding: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "#FFFFFF",
                          color: "var(--text-main)",
                          cursor: "pointer",
                        }}
                      >
                        Ganti Password
                      </button>
                      <button
                        type="button"
                        className="touch-target"
                        disabled={processingUserId === u.id}
                        onClick={() => handleToggleStatus(u)}
                        style={{
                          flex: 1,
                          minHeight: "44px",
                          padding: "8px",
                          fontSize: "12px",
                          fontWeight: 600,
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          backgroundColor: "#FFFFFF",
                          color: u.isActive ? "var(--accent-red)" : "var(--accent-blue)",
                          cursor: processingUserId === u.id ? "not-allowed" : "pointer",
                          opacity: processingUserId === u.id ? 0.6 : 1,
                        }}
                      >
                        {processingUserId === u.id
                          ? "Memproses..."
                          : u.isActive
                          ? "Nonaktifkan"
                          : "Aktifkan"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal Tambah Pengguna */}
      {isAddModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "440px",
              maxHeight: "90dvh",
              overflowY: "auto",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: "3px", backgroundColor: "var(--accent-blue)", width: "100%" }} />
            <div style={{ padding: "24px" }}>
              <h2
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                Tambah Pengguna Baru
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Pengguna baru akan diminta mengganti password saat pertama kali masuk.
              </p>

              <form onSubmit={handleCreateUser} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label
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
                    type="text"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    placeholder="misal: operator1"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      marginBottom: "6px",
                    }}
                  >
                    Password Awal (min. 8 karakter)
                  </label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--text-main)",
                      marginBottom: "6px",
                    }}
                  >
                    Peran (Role)
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as "viewer" | "admin")}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                    }}
                  >
                    <option value="viewer">Viewer (Hanya lihat dashboard dan log)</option>
                    <option value="admin">Admin (Akses penuh dan konfigurasi)</option>
                  </select>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  <button
                    type="button"
                    className="touch-target"
                    onClick={() => setIsAddModalOpen(false)}
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 14px",
                      minHeight: "44px",
                      fontSize: "13px",
                      fontWeight: 500,
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "transparent",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="touch-target"
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 16px",
                      minHeight: "44px",
                      fontSize: "13px",
                      fontWeight: 600,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-blue)",
                      color: "#FFFFFF",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Menyimpan..." : "Simpan Pengguna"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reset Password */}
      {resetTargetUser && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              maxHeight: "90dvh",
              overflowY: "auto",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              overflow: "hidden",
            }}
          >
            <div style={{ height: "3px", backgroundColor: "var(--accent-red)", width: "100%" }} />
            <div style={{ padding: "24px" }}>
              <h2
                style={{
                  fontSize: "16px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                Ganti Password: {resetTargetUser.username}
              </h2>
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Masukkan password baru untuk akun ini.
              </p>

              <form onSubmit={handleResetPassword} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div>
                  <label
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
                    type="password"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    placeholder="••••••••"
                    required
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                  <button
                    type="button"
                    className="touch-target"
                    onClick={() => setResetTargetUser(null)}
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 14px",
                      minHeight: "44px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "transparent",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="touch-target"
                    disabled={isSubmitting}
                    style={{
                      padding: "8px 16px",
                      minHeight: "44px",
                      fontSize: "13px",
                      fontWeight: 600,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-red)",
                      color: "#FFFFFF",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Menyimpan..." : "Update Password"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
