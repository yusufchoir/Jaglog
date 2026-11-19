"use client";

import React, { useEffect, useState, useCallback } from "react";

export interface UnknownSourceEntry {
  ip: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

interface ExistingDeviceOption {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
}

interface UnknownSourcesPanelProps {
  initialSources?: UnknownSourceEntry[];
  onDeviceRegisteredOrBound?: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const d = new Date(isoDate);
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 5) return "baru saja";
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  return `${Math.floor(diffHours / 24)} hari lalu`;
}

export function UnknownSourcesPanel({
  initialSources,
  onDeviceRegisteredOrBound,
}: UnknownSourcesPanelProps) {
  const [sources, setSources] = useState<UnknownSourceEntry[]>(initialSources || []);
  const [isLoading, setIsLoading] = useState(!initialSources);
  const [devicesList, setDevicesList] = useState<ExistingDeviceOption[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);

  // Modal state: "register" | "bind" | null
  const [activeAction, setActiveAction] = useState<{
    mode: "register" | "bind";
    ip: string;
  } | null>(null);

  // Form Tambah Perangkat Baru
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("mikrotik");
  const [newLocation, setNewLocation] = useState("");
  const [newNotes, setNewNotes] = useState("");

  // Form Pasangkan ke Perangkat yang Ada
  const [selectedDeviceId, setSelectedDeviceId] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (initialSources) {
      setSources(initialSources);
    }
  }, [initialSources]);

  const fetchUnknownSources = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/admin/diagnostik");
      if (res.ok) {
        const data = await res.json();
        setSources(data.unknownSources || []);
      }
    } catch (err) {
      console.error("Gagal memuat sumber tidak dikenal:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialSources) {
      fetchUnknownSources();
    }
  }, [initialSources, fetchUnknownSources]);

  const fetchDevicesList = async () => {
    setIsLoadingDevices(true);
    try {
      const res = await fetch("/api/devices");
      if (res.ok) {
        const data = await res.json();
        const all: ExistingDeviceOption[] = (data.devices || []).map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          ipAddress: d.ipAddress || null,
        }));
        // Prioritaskan perangkat tanpa IP di bagian atas
        all.sort((a, b) => {
          if (!a.ipAddress && b.ipAddress) return -1;
          if (a.ipAddress && !b.ipAddress) return 1;
          return a.name.localeCompare(b.name);
        });
        setDevicesList(all);
        const firstWithoutIp = all.find((d) => !d.ipAddress);
        setSelectedDeviceId(firstWithoutIp ? firstWithoutIp.id : all[0]?.id || "");
      }
    } catch (err) {
      console.error("Gagal memuat daftar perangkat:", err);
    } finally {
      setIsLoadingDevices(false);
    }
  };

  const openRegisterModal = (ip: string) => {
    setFeedback(null);
    setNewName(`PERANGKAT-${ip.replace(/\./g, "-")}`);
    setNewType("mikrotik");
    setNewLocation("");
    setNewNotes(`Didaftarkan oleh admin dari Sumber Tidak Dikenal (${ip})`);
    setActiveAction({ mode: "register", ip });
  };

  const openBindModal = (ip: string) => {
    setFeedback(null);
    setActiveAction({ mode: "bind", ip });
    fetchDevicesList();
  };

  const handleConfirmRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAction || activeAction.mode !== "register") return;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          type: newType,
          ipAddress: activeAction.ip,
          location: newLocation.trim() || undefined,
          notes: newNotes.trim() || undefined,
          pingEnabled: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error || "Gagal mendaftarkan perangkat baru.",
        });
        return;
      }

      setSources((prev) => prev.filter((s) => s.ip !== activeAction.ip));
      setFeedback({
        type: "success",
        message: `Perangkat '${newName.trim()}' (${activeAction.ip}) berhasil didaftarkan dan diaktifkan.`,
      });
      setActiveAction(null);
      if (onDeviceRegisteredOrBound) onDeviceRegisteredOrBound();
    } catch {
      setFeedback({
        type: "error",
        message: "Terjadi kesalahan jaringan saat mendaftarkan perangkat.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBind = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAction || activeAction.mode !== "bind" || !selectedDeviceId) return;
    setIsSubmitting(true);
    setFeedback(null);

    try {
      const res = await fetch(`/api/devices/${selectedDeviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ipAddress: activeAction.ip,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: "error",
          message: data.error || "Gagal memasangkan IP ke perangkat.",
        });
        return;
      }

      const targetDev = devicesList.find((d) => d.id === selectedDeviceId);
      setSources((prev) => prev.filter((s) => s.ip !== activeAction.ip));
      setFeedback({
        type: "success",
        message: `IP ${activeAction.ip} berhasil dipasangkan ke perangkat '${targetDev?.name || selectedDeviceId}'.`,
      });
      setActiveAction(null);
      if (onDeviceRegisteredOrBound) onDeviceRegisteredOrBound();
    } catch {
      setFeedback({
        type: "error",
        message: "Terjadi kesalahan jaringan saat memasangkan IP.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="unknown-sources-panel"
      style={{
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "20px 24px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <h2
              style={{
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--text-main)",
                letterSpacing: "-0.2px",
              }}
            >
              Sumber Tidak Dikenal (Unknown Syslog Sources)
            </h2>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: "4px",
                backgroundColor: sources.length > 0 ? "#FEF2F2" : "#F1F5F9",
                color: sources.length > 0 ? "#B91C1C" : "#475569",
                border: `1px solid ${sources.length > 0 ? "#FECACA" : "#E2E8F0"}`,
              }}
            >
              {sources.length} IP (Maks 100 • TTL 24 Jam)
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Daftar alamat IP yang mengirim paket syslog tetapi belum cocok dengan perangkat mana pun. Hanya menyimpan ringkasan agregat tanpa isi pesan mentah, dan tidak pernah mendaftarkan perangkat secara otomatis.
          </p>
        </div>

        <button
          type="button"
          onClick={fetchUnknownSources}
          disabled={isLoading}
          style={{
            padding: "6px 12px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--border-color)",
            backgroundColor: "#FFFFFF",
            color: "var(--text-main)",
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "Memuat..." : "Segarkan Daftar"}
        </button>
      </div>

      {feedback && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: "14px",
            borderRadius: "var(--radius-sm)",
            fontSize: "12px",
            backgroundColor: feedback.type === "success" ? "#F0FDF4" : "#FEF2F2",
            border: `1px solid ${feedback.type === "success" ? "#86EFAC" : "#FCA5A5"}`,
            color: feedback.type === "success" ? "#166534" : "#991B1B",
          }}
        >
          {feedback.message}
        </div>
      )}

      {isLoading && sources.length === 0 ? (
        <div
          style={{
            padding: "24px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--text-secondary)",
          }}
        >
          Memuat daftar sumber tidak dikenal...
        </div>
      ) : sources.length === 0 ? (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            fontSize: "12px",
            color: "var(--text-secondary)",
            backgroundColor: "#F8FAFC",
            border: "1px dashed var(--border-color)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          Tidak ada paket dari alamat IP yang tidak dikenal dalam 24 jam terakhir.
        </div>
      ) : (
        <div style={{ overflowX: "auto", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                <th style={{ padding: "10px 14px" }}>Alamat IP Pengirim</th>
                <th style={{ padding: "10px 14px" }}>Jumlah Paket Ditolak</th>
                <th style={{ padding: "10px 14px" }}>Waktu Terakhir Diterima</th>
                <th style={{ padding: "10px 14px", textAlign: "right" }}>Tindakan Admin</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((item) => (
                <tr key={item.ip} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 700 }} className="font-mono">
                    {item.ip}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <strong>{item.count.toLocaleString("id-ID")}</strong> paket
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>
                    {formatRelativeTime(item.lastSeen)}{" "}
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                      ({new Date(item.lastSeen).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })} WIB)
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        onClick={() => openRegisterModal(item.ip)}
                        style={{
                          padding: "5px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          backgroundColor: "var(--accent-blue)",
                          color: "#FFFFFF",
                          border: "none",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        Daftarkan sebagai perangkat
                      </button>
                      <button
                        type="button"
                        onClick={() => openBindModal(item.ip)}
                        style={{
                          padding: "5px 10px",
                          fontSize: "11px",
                          fontWeight: 600,
                          backgroundColor: "#FFFFFF",
                          color: "var(--text-main)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        Pasangkan ke perangkat yang ada
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Konfirmasi Admin: Daftarkan atau Pasangkan */}
      {activeAction && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 120,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "460px",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              borderTop: "3px solid var(--accent-blue)",
              padding: "22px 24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            {activeAction.mode === "register" ? (
              <form onSubmit={handleConfirmRegister} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>
                    Konfirmasi Daftarkan Perangkat Baru
                  </h3>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    Alamat IP <strong className="font-mono">{activeAction.ip}</strong> akan didaftarkan sebagai perangkat aktif penerima syslog.
                  </p>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Alamat IP Sumber (Terisi Otomatis)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={activeAction.ip}
                    className="font-mono"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      fontSize: "12px",
                      backgroundColor: "#F1F5F9",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-main)",
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Nama Perangkat *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Contoh: ROUTER-CABANG-1"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      fontSize: "12px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                      Tipe Perangkat *
                    </label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="mikrotik">MikroTik RouterOS</option>
                      <option value="linux">Linux Server</option>
                      <option value="windows">Windows Server</option>
                      <option value="firewall">Firewall</option>
                      <option value="switch">Network Switch</option>
                      <option value="other">Lainnya</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                      Lokasi
                    </label>
                    <input
                      type="text"
                      value={newLocation}
                      onChange={(e) => setNewLocation(e.target.value)}
                      placeholder="Opsional"
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    disabled={isSubmitting}
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
                    disabled={isSubmitting || !newName.trim()}
                    style={{
                      padding: "7px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-blue)",
                      color: "#FFFFFF",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Menyimpan..." : "Konfirmasi & Daftarkan"}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmBind} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)" }}>
                    Pasangkan IP ke Perangkat yang Ada
                  </h3>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    Pilih perangkat yang akan dipasangkan dengan alamat IP sumber <strong className="font-mono">{activeAction.ip}</strong>.
                  </p>
                </div>

                {isLoadingDevices ? (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "12px 0" }}>
                    Memuat daftar perangkat...
                  </div>
                ) : devicesList.length === 0 ? (
                  <div style={{ fontSize: "12px", color: "var(--accent-red)", padding: "12px 0" }}>
                    Tidak ada perangkat terdaftar yang dapat dipilih.
                  </div>
                ) : (
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                      Pilih Perangkat Tujuan *
                    </label>
                    <select
                      value={selectedDeviceId}
                      onChange={(e) => setSelectedDeviceId(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      {devicesList.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.type.toUpperCase()}) — {d.ipAddress ? `IP saat ini: ${d.ipAddress}` : "Belum punya IP"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setActiveAction(null)}
                    disabled={isSubmitting}
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
                    disabled={isSubmitting || !selectedDeviceId}
                    style={{
                      padding: "7px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--accent-blue)",
                      color: "#FFFFFF",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {isSubmitting ? "Menyimpan..." : "Konfirmasi Pasangkan IP"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

