"use client";

import React, { useState, useEffect } from "react";

export interface LogFilterItem {
  id: string;
  deviceId: string | null;
  name: string;
  matchType: "contains" | "exact" | "regex";
  pattern: string;
  action: "discard" | "merge" | "lower_severity";
  isActive: boolean;
  matchCount: number;
  lastMatchedAt: string | null;
  createdBy: string;
  isSystemSuggested: boolean;
  description: string | null;
  createdAt: string;
}

interface LogFilterManagerProps {
  deviceId?: string | null;
  deviceName?: string;
  initialPattern?: string | null;
  onClearInitialPattern?: () => void;
}

export function LogFilterManager({
  deviceId = null,
  deviceName,
  initialPattern,
  onClearInitialPattern,
}: LogFilterManagerProps) {
  const [filters, setFilters] = useState<LogFilterItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFilter, setEditingFilter] = useState<LogFilterItem | null>(null);
  const [name, setName] = useState("");
  const [matchType, setMatchType] = useState<"contains" | "exact" | "regex">("contains");
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<"discard" | "merge" | "lower_severity">("discard");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Test Pattern State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    matchedCount: number;
    samples: Array<{ id: number; message: string; eventTime: string; severity: number }>;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Cleanup Modal State (Pembersihan Log Banjir)
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [cleanupPattern, setCleanupPattern] = useState("");
  const [cleanupMatchType, setCleanupMatchType] = useState<"contains" | "exact">("contains");
  const [cleanupFrom, setCleanupFrom] = useState("");
  const [cleanupTo, setCleanupTo] = useState("");
  const [cleanupCount, setCleanupCount] = useState<number | null>(null);
  const [isCalculatingCleanup, setIsCalculatingCleanup] = useState(false);
  const [isExecutingCleanup, setIsExecutingCleanup] = useState(false);
  const [cleanupResultMsg, setCleanupResultMsg] = useState<string | null>(null);

  const fetchFilters = async () => {
    setIsLoading(true);
    try {
      const url = deviceId
        ? `/api/filters?deviceId=${deviceId}`
        : `/api/filters?scope=global`;
      const res = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setFilters(data.filters || []);
      } else {
        setErrorMessage(data.error || "Gagal memuat aturan filter.");
      }
    } catch {
      setErrorMessage("Terjadi kesalahan jaringan saat memuat filter.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, [deviceId]);

  // Jika ada initialPattern dari luar (mis. klik tombol "Abaikan pesan seperti ini")
  useEffect(() => {
    if (initialPattern) {
      setEditingFilter(null);
      setName(`Abaikan: ${initialPattern.slice(0, 30)}...`);
      setMatchType("contains");
      setPattern(initialPattern);
      setAction("discard");
      setDescription("Dibuat otomatis dari Event Log.");
      setIsActive(true);
      setTestResult(null);
      setTestError(null);
      setIsModalOpen(true);
      if (onClearInitialPattern) onClearInitialPattern();
    }
  }, [initialPattern]);

  const handleOpenCreateModal = () => {
    setEditingFilter(null);
    setName("");
    setMatchType("contains");
    setPattern("");
    setAction("discard");
    setDescription("");
    setIsActive(true);
    setTestResult(null);
    setTestError(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (f: LogFilterItem) => {
    setEditingFilter(f);
    setName(f.name);
    setMatchType(f.matchType);
    setPattern(f.pattern);
    setAction(f.action);
    setDescription(f.description || "");
    setIsActive(f.isActive);
    setTestResult(null);
    setTestError(null);
    setIsModalOpen(true);
  };

  const handleToggleActive = async (f: LogFilterItem) => {
    try {
      const res = await fetch(`/api/filters/${f.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !f.isActive }),
      });
      const data = await res.json();
      if (res.ok) {
        setFilters((prev) =>
          prev.map((item) => (item.id === f.id ? { ...item, isActive: !item.isActive } : item))
        );
        setSuccessMessage(data.message);
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setErrorMessage(data.error || "Gagal mengubah status filter.");
      }
    } catch {
      setErrorMessage("Terjadi kesalahan jaringan.");
    }
  };

  const handleDelete = async (f: LogFilterItem) => {
    if (!confirm(`Hapus aturan filter "${f.name}"?`)) return;

    try {
      const res = await fetch(`/api/filters/${f.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setFilters((prev) => prev.filter((item) => item.id !== f.id));
        setSuccessMessage("Filter berhasil dihapus.");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setErrorMessage(data.error || "Gagal menghapus filter.");
      }
    } catch {
      setErrorMessage("Terjadi kesalahan jaringan.");
    }
  };

  const handleTestPattern = async () => {
    if (!pattern.trim()) {
      setTestError("Masukkan pola terlebih dahulu.");
      return;
    }

    setIsTesting(true);
    setTestError(null);
    setTestResult(null);

    try {
      const res = await fetch("/api/filters/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: pattern.trim(),
          matchType,
          deviceId: deviceId || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestResult({
          matchedCount: data.matchedCount,
          samples: data.samples || [],
        });
      } else {
        setTestError(data.error || "Gagal menguji pola.");
      }
    } catch {
      setTestError("Terjadi kesalahan jaringan saat menguji pola.");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !pattern.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (editingFilter) {
        // Update
        const res = await fetch(`/api/filters/${editingFilter.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            matchType,
            pattern,
            action,
            isActive,
            description,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setFilters((prev) =>
            prev.map((item) => (item.id === editingFilter.id ? data.filter : item))
          );
          setIsModalOpen(false);
          setSuccessMessage("Aturan filter berhasil diperbarui.");
          setTimeout(() => setSuccessMessage(null), 3000);
        } else {
          setErrorMessage(data.error || "Gagal menyimpan perubahan filter.");
        }
      } else {
        // Create
        const res = await fetch("/api/filters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: deviceId || null,
            name,
            matchType,
            pattern,
            action,
            isActive,
            description,
          }),
        });
        const data = await res.json();
        if (res.ok) {
          setFilters((prev) => [data.filter, ...prev]);
          setIsModalOpen(false);
          setSuccessMessage("Aturan filter baru berhasil dibuat.");
          setTimeout(() => setSuccessMessage(null), 3000);
        } else {
          setErrorMessage(data.error || "Gagal membuat aturan filter.");
        }
      }
    } catch {
      setErrorMessage("Terjadi kesalahan jaringan saat menyimpan filter.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Kalkulasi baris yang akan dibersihkan (Dry Run)
  const handleCalculateCleanup = async () => {
    if (!cleanupPattern.trim() || !deviceId) return;
    setIsCalculatingCleanup(true);
    setCleanupResultMsg(null);
    try {
      const res = await fetch(`/api/devices/${deviceId}/logs/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: cleanupPattern.trim(),
          matchType: cleanupMatchType,
          from: cleanupFrom || undefined,
          to: cleanupTo || undefined,
          dryRun: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCleanupCount(data.totalToClean);
      } else {
        setCleanupResultMsg(`Error: ${data.error}`);
      }
    } catch {
      setCleanupResultMsg("Kesalahan jaringan saat menghitung log.");
    } finally {
      setIsCalculatingCleanup(false);
    }
  };

  // Eksekusi pembersihan bertahap
  const handleExecuteCleanup = async () => {
    if (!cleanupPattern.trim() || !deviceId) return;
    if (cleanupCount === 0) return;

    if (
      !confirm(
        `PERINGATAN: Anda akan menghapus permanen sekitar ${cleanupCount?.toLocaleString(
          "id-ID"
        )} baris log yang cocok dengan pola "${cleanupPattern}". Lanjutkan?`
      )
    ) {
      return;
    }

    setIsExecutingCleanup(true);
    setCleanupResultMsg("Sedang menghapus data bertahap per 5.000 baris agar tidak mengunci tabel...");

    try {
      const res = await fetch(`/api/devices/${deviceId}/logs/cleanup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: cleanupPattern.trim(),
          matchType: cleanupMatchType,
          from: cleanupFrom || undefined,
          to: cleanupTo || undefined,
          dryRun: false,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCleanupResultMsg(data.message);
        setCleanupCount(0);
        setSuccessMessage(data.message);
        setTimeout(() => setSuccessMessage(null), 4000);
      } else {
        setCleanupResultMsg(`Gagal: ${data.error}`);
      }
    } catch {
      setCleanupResultMsg("Terjadi kesalahan jaringan saat pembersihan log.");
    } finally {
      setIsExecutingCleanup(false);
    }
  };

  return (
    <div
      style={{
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "20px 24px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "16px",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div>
          <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>
            {deviceId
              ? `Filter Log Perangkat: ${deviceName || ""}`
              : "Filter Log Global (Semua Perangkat)"}
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            {deviceId
              ? "Atur pola pesan yang ingin dibuang, digabung (dedupe), atau diturunkan tingkat keparahannya khusus untuk perangkat ini."
              : "Aturan penyaringan kebisingan (noise filter) dan anti-looping yang berlaku secara menyeluruh untuk semua perangkat."}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {deviceId && (
            <button
              type="button"
              onClick={() => {
                setCleanupPattern("");
                setCleanupCount(null);
                setCleanupResultMsg(null);
                setIsCleanupOpen(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: "#FEF2F2",
                color: "#991B1B",
                border: "1px solid #FCA5A5",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Hapus Log dengan Pola Ini
            </button>
          )}

          <button
            type="button"
            onClick={handleOpenCreateModal}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: "var(--accent-blue)",
              color: "#FFFFFF",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            + Tambah Aturan Filter
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      {errorMessage && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "14px",
            backgroundColor: "#FEF2F2",
            border: "1px solid #FCA5A5",
            borderRadius: "var(--radius-sm)",
            fontSize: "12px",
            color: "#991B1B",
          }}
        >
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div
          style={{
            padding: "8px 12px",
            marginBottom: "14px",
            backgroundColor: "#F0FDF4",
            border: "1px solid #86EFAC",
            borderRadius: "var(--radius-sm)",
            fontSize: "12px",
            color: "#166534",
          }}
        >
          {successMessage}
        </div>
      )}

      {/* Table Filters */}
      {isLoading ? (
        <div style={{ padding: "28px", textAlign: "center", color: "var(--text-secondary)", fontSize: "12px" }}>
          Memuat aturan filter...
        </div>
      ) : filters.length === 0 ? (
        <div
          style={{
            padding: "32px",
            textAlign: "center",
            backgroundColor: "#F8FAFC",
            border: "1px dashed var(--border-color)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text-secondary)",
            fontSize: "13px",
          }}
        >
          Belum ada aturan filter log yang dikonfigurasi. Klik tombol "+ Tambah Aturan Filter" untuk membuat aturan baru.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                <th style={{ padding: "10px 12px" }}>Status</th>
                <th style={{ padding: "10px 12px" }}>Nama Filter</th>
                <th style={{ padding: "10px 12px" }}>Tipe & Pola</th>
                <th style={{ padding: "10px 12px" }}>Aksi</th>
                <th style={{ padding: "10px 12px" }}>Dibuang / Cocok</th>
                <th style={{ padding: "10px 12px" }}>Terakhir Cocok</th>
                <th style={{ padding: "10px 12px", textAlign: "right" }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filters.map((f) => {
                const actionBadge = {
                  discard: { label: "Buang", bg: "#FEE2E2", text: "#991B1B" },
                  merge: { label: "Gabung (Dedupe)", bg: "#E0E7FF", text: "#3730A3" },
                  lower_severity: { label: "Turunkan Severity", bg: "#FEF3C7", text: "#92400E" },
                }[f.action] || { label: f.action, bg: "#F1F5F9", text: "#334155" };

                return (
                  <tr key={f.id} style={{ borderBottom: "1px solid var(--border-color)" }}>
                    {/* Status Toggle */}
                    <td style={{ padding: "10px 12px", width: "70px" }}>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(f)}
                        style={{
                          padding: "3px 8px",
                          fontSize: "11px",
                          fontWeight: 700,
                          borderRadius: "12px",
                          border: "none",
                          cursor: "pointer",
                          backgroundColor: f.isActive ? "#DCFCE7" : "#F1F5F9",
                          color: f.isActive ? "#166534" : "#64748B",
                        }}
                        title={f.isActive ? "Klik untuk menonaktifkan" : "Klik untuk mengaktifkan"}
                      >
                        {f.isActive ? "Aktif" : "Mati"}
                      </button>
                    </td>

                    {/* Nama */}
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>{f.name}</span>
                        {f.isSystemSuggested && (
                          <span
                            style={{
                              fontSize: "10px",
                              backgroundColor: "#EFF6FF",
                              color: "#1D4ED8",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              fontWeight: 600,
                            }}
                          >
                            Bawaan
                          </span>
                        )}
                      </div>
                      {f.description && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 400, marginTop: "2px" }}>
                          {f.description}
                        </div>
                      )}
                    </td>

                    {/* Pola */}
                    <td style={{ padding: "10px 12px", maxWidth: "280px" }}>
                      <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "2px" }}>
                        {f.matchType === "contains" && "Mengandung:"}
                        {f.matchType === "exact" && "Persis sama:"}
                        {f.matchType === "regex" && "RegEx:"}
                      </div>
                      <code
                        style={{
                          fontFamily: "monospace",
                          fontSize: "11px",
                          backgroundColor: "#F1F5F9",
                          padding: "2px 6px",
                          borderRadius: "3px",
                          display: "inline-block",
                          wordBreak: "break-all",
                        }}
                      >
                        {f.pattern}
                      </code>
                    </td>

                    {/* Aksi */}
                    <td style={{ padding: "10px 12px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: "11px",
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          backgroundColor: actionBadge.bg,
                          color: actionBadge.text,
                        }}
                      >
                        {actionBadge.label}
                      </span>
                    </td>

                    {/* Match Count */}
                    <td style={{ padding: "10px 12px", fontFamily: "monospace", fontWeight: 600 }}>
                      {f.matchCount.toLocaleString("id-ID")} log
                    </td>

                    {/* Terakhir Cocok */}
                    <td style={{ padding: "10px 12px", color: "var(--text-secondary)", fontSize: "11px" }}>
                      {f.lastMatchedAt
                        ? new Date(f.lastMatchedAt).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }) + " WIB"
                        : "Belum pernah"}
                    </td>

                    {/* Actions */}
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(f)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "11px",
                            backgroundColor: "#FFFFFF",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          Ubah
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(f)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "11px",
                            backgroundColor: "#FEF2F2",
                            color: "#991B1B",
                            border: "1px solid #FCA5A5",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL 1: Form Tambah / Edit Filter */}
      {isModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 110,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "560px",
              backgroundColor: "var(--bg-panel)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700 }}>
                {editingFilter ? "Ubah Aturan Filter" : "Tambah Aturan Filter Baru"}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer" }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Nama Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Nama Filter *
                </label>
                <input
                  type="text"
                  required
                  placeholder="mis. Abaikan loop download package MikroTik"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              </div>

              {/* Tipe & Pola */}
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Tipe Pencocokan
                  </label>
                  <select
                    value={matchType}
                    onChange={(e) => setMatchType(e.target.value as any)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      fontSize: "12px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    <option value="contains">Mengandung teks</option>
                    <option value="exact">Persis sama</option>
                    <option value="regex">RegEx (Aman)</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Pola Pesan *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={
                      matchType === "contains"
                        ? "mis. Download from jagalog.maudynetwork.id FINISHED"
                        : matchType === "exact"
                        ? "Isi teks pesan persis"
                        : "mis. Download from .* FINISHED"
                    }
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>
              </div>

              {/* Tombol Uji Pola */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleTestPattern}
                  disabled={isTesting || !pattern.trim()}
                  style={{
                    padding: "5px 12px",
                    fontSize: "11px",
                    fontWeight: 600,
                    backgroundColor: "#F1F5F9",
                    color: "var(--text-main)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    cursor: isTesting ? "wait" : "pointer",
                  }}
                >
                  {isTesting ? "Menguji pola..." : "Uji Pola (24 Jam Terakhir)"}
                </button>
                <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                  Cek berapa log di database yang cocok sebelum disimpan.
                </span>
              </div>

              {/* Hasil Uji Pola */}
              {testError && (
                <div style={{ padding: "8px", fontSize: "11px", color: "#991B1B", backgroundColor: "#FEF2F2", borderRadius: "4px" }}>
                  {testError}
                </div>
              )}
              {testResult && (
                <div
                  style={{
                    padding: "10px",
                    backgroundColor: "#F8FAFC",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    fontSize: "11px",
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                    Hasil Uji: Cocok dengan{" "}
                    <strong style={{ color: "var(--accent-blue)" }}>
                      {testResult.matchedCount.toLocaleString("id-ID")} log
                    </strong>{" "}
                    dalam 24 jam terakhir.
                  </div>
                  {testResult.samples.length > 0 && (
                    <div style={{ marginTop: "6px" }}>
                      <div style={{ color: "var(--text-secondary)", marginBottom: "3px" }}>5 Contoh Pesan Cocok:</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                        {testResult.samples.map((s) => (
                          <div
                            key={s.id}
                            style={{
                              fontFamily: "monospace",
                              fontSize: "10px",
                              backgroundColor: "#FFFFFF",
                              border: "1px solid #E2E8F0",
                              padding: "3px 6px",
                              borderRadius: "3px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {s.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Aksi Filter */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Aksi saat Cocok
                </label>
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value as any)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                  }}
                >
                  <option value="discard">Buang pesan (Jangan simpan ke database)</option>
                  <option value="merge">Gabung pesan berulang (Dedupe jendela 60 detik)</option>
                  <option value="lower_severity">Turunkan severity ke 7 (Debug)</option>
                </select>
              </div>

              {/* Deskripsi */}
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Keterangan / Catatan (Opsional)
                </label>
                <input
                  type="text"
                  placeholder="Alasan filter ini dibuat"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              </div>

              {/* Status Aktif */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  id="filter-is-active"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <label htmlFor="filter-is-active" style={{ fontSize: "12px", cursor: "pointer" }}>
                  Aktifkan filter ini sekarang
                </label>
              </div>

              {/* Footer Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    cursor: "pointer",
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: "7px 16px",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: "var(--accent-blue)",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: isSubmitting ? "wait" : "pointer",
                  }}
                >
                  {isSubmitting ? "Menyimpan..." : editingFilter ? "Simpan Perubahan" : "Buat Filter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Pembersihan Log Banjir (Batch Cleanup) */}
      {isCleanupOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 110,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "540px",
              backgroundColor: "var(--bg-panel)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-color)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#991B1B" }}>
                Pembersihan Log Banjir (Batch Cleanup)
              </h3>
              <button
                type="button"
                onClick={() => setIsCleanupOpen(false)}
                style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer" }}
              >
                &times;
              </button>
            </div>

            <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px", fontSize: "12px" }}>
              <p style={{ color: "var(--text-secondary)", margin: 0 }}>
                Hapus riwayat log berulang yang membanjiri database secara aman dalam batch 5.000 baris agar tidak mengunci tabel.
              </p>

              <div>
                <label style={{ display: "block", fontWeight: 600, marginBottom: "4px" }}>
                  Pola Teks yang Dihapus *
                </label>
                <input
                  type="text"
                  required
                  placeholder="mis. Download from jagalog.maudynetwork.id FINISHED"
                  value={cleanupPattern}
                  onChange={(e) => {
                    setCleanupPattern(e.target.value);
                    setCleanupCount(null);
                  }}
                  style={{
                    width: "100%",
                    padding: "7px 10px",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: "4px" }}>
                    Dari Waktu (Opsional)
                  </label>
                  <input
                    type="datetime-local"
                    value={cleanupFrom}
                    onChange={(e) => {
                      setCleanupFrom(e.target.value);
                      setCleanupCount(null);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: "11px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontWeight: 600, marginBottom: "4px" }}>
                    Sampai Waktu (Opsional)
                  </label>
                  <input
                    type="datetime-local"
                    value={cleanupTo}
                    onChange={(e) => {
                      setCleanupTo(e.target.value);
                      setCleanupCount(null);
                    }}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      fontSize: "11px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>
              </div>

              {/* Tombol Hitung Jumlah */}
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  onClick={handleCalculateCleanup}
                  disabled={isCalculatingCleanup || !cleanupPattern.trim()}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: "#F1F5F9",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    cursor: isCalculatingCleanup ? "wait" : "pointer",
                  }}
                >
                  {isCalculatingCleanup ? "Menghitung..." : "Hitung Jumlah Baris"}
                </button>
                {cleanupCount !== null && (
                  <span style={{ fontWeight: 600, color: cleanupCount > 0 ? "#991B1B" : "#166534" }}>
                    Ditemukan: {cleanupCount.toLocaleString("id-ID")} baris log
                  </span>
                )}
              </div>

              {cleanupResultMsg && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: "4px",
                    backgroundColor: "#F8FAFC",
                    border: "1px solid var(--border-color)",
                    color: "var(--text-main)",
                  }}
                >
                  {cleanupResultMsg}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={() => setIsCleanupOpen(false)}
                  style={{
                    padding: "7px 14px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    cursor: "pointer",
                  }}
                >
                  Tutup
                </button>

                <button
                  type="button"
                  onClick={handleExecuteCleanup}
                  disabled={isExecutingCleanup || cleanupCount === null || cleanupCount === 0}
                  style={{
                    padding: "7px 16px",
                    fontWeight: 600,
                    backgroundColor: "#DC2626",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: isExecutingCleanup || !cleanupCount ? "not-allowed" : "pointer",
                    opacity: isExecutingCleanup || !cleanupCount ? 0.6 : 1,
                  }}
                >
                  {isExecutingCleanup ? "Sedang Menghapus..." : `Hapus ${cleanupCount ? cleanupCount.toLocaleString("id-ID") + " " : ""}Baris Sekarang`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
