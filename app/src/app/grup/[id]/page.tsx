"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { Toast } from "@/components/Toast";
import { useCurrentUser } from "@/components/UserProvider";
import { groupColorHexMap, GroupBorderColor } from "@shared/groups";

interface GroupDetail {
  id: string;
  nama: string;
  deskripsi: string | null;
  warnaGaris: GroupBorderColor;
  urutan: number;
  parentId: string | null;
  createdAt: string;
}

interface GroupDevice {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
  location: string | null;
  status: string;
  calculatedStatus: "online" | "log_stopped" | "offline" | "unknown";
  lastSeenAt: string | null;
  pingEnabled: boolean;
  lastPingOk: boolean | null;
  lastPingRtt: number | null;
  createdAt: string;
}

interface GroupIncident {
  id: string;
  deviceId: string;
  deviceName: string | null;
  title: string;
  description: string;
  severity: "critical" | "warning" | "info";
  status: "open" | "resolved";
  createdAt: string;
}

interface GroupSummary {
  totalDevices: number;
  onlineCount: number;
  logStoppedCount: number;
  offlineCount: number;
  unknownCount: number;
  openIncidentCount: number;
  uptime24h: number | null;
}

interface HourlyLog {
  hour: string;
  count: number;
}

export default function DetailGrupPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  const { subscribe } = useLiveUpdates();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [devices, setDevices] = useState<GroupDevice[]>([]);
  const [openIncidents, setOpenIncidents] = useState<GroupIncident[]>([]);
  const [summary, setSummary] = useState<GroupSummary | null>(null);
  const [logVolume24h, setLogVolume24h] = useState<HourlyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Available devices to add
  const [allOtherDevices, setAllOtherDevices] = useState<any[]>([]);
  const [isAddDeviceModalOpen, setIsAddDeviceModalOpen] = useState(false);
  const [selectedDeviceIdsToAdd, setSelectedDeviceIdsToAdd] = useState<string[]>([]);
  const [isSubmittingAddDevices, setIsSubmittingAddDevices] = useState(false);

  // User role dari UserProvider tunggal
  const { currentUser, isAdmin } = useCurrentUser();
  const currentUserRole = currentUser?.role || "viewer";
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const fetchGroupDetail = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/groups/${groupId}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error("Grup perangkat tidak ditemukan.");
        throw new Error("Gagal mengambil detail grup.");
      }
      const data = await res.json();
      setGroup(data.group);
      setDevices(data.devices || []);
      setOpenIncidents(data.openIncidents || []);
      setSummary(data.summary || null);
      setLogVolume24h(data.logVolume24h || []);
    } catch (err: any) {
      console.error("fetchGroupDetail error:", err);
      if (!silent) setErrorMsg(err.message || "Terjadi kesalahan saat memuat detail grup.");
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchGroupDetail();
  }, [fetchGroupDetail]);

  // SSE updates
  useEffect(() => {
    const unsubGroup = subscribe("grup.berubah", () => {
      fetchGroupDetail(true);
    });
    const unsubDevStatus = subscribe("perangkat.status", () => {
      fetchGroupDetail(true);
    });
    const unsubInc = subscribe("insiden.berubah", () => {
      fetchGroupDetail(true);
    });
    return () => {
      unsubGroup();
      unsubDevStatus();
      unsubInc();
    };
  }, [subscribe, fetchGroupDetail]);

  // Fetch all devices to populate "Add Device" modal
  const handleOpenAddDeviceModal = async () => {
    setIsAddDeviceModalOpen(true);
    setSelectedDeviceIdsToAdd([]);
    try {
      const res = await fetch("/api/devices");
      const data = await res.json();
      if (res.ok && data.devices) {
        // Filter out devices already in this group
        const available = data.devices.filter((d: any) => d.groupId !== groupId);
        setAllOtherDevices(available);
      }
    } catch (err) {
      console.error("Gagal mengambil daftar perangkat:", err);
    }
  };

  const handleConfirmAddDevices = async () => {
    if (selectedDeviceIdsToAdd.length === 0) return;
    setIsSubmittingAddDevices(true);
    try {
      const res = await fetch("/api/devices/bulk-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceIds: selectedDeviceIdsToAdd,
          groupId: groupId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal menambahkan perangkat.");

      setToast({ message: data.message || "Perangkat berhasil ditambahkan ke grup ini.", type: "success" });
      setIsAddDeviceModalOpen(false);
      fetchGroupDetail(true);
    } catch (err: any) {
      setToast({ message: err.message || "Gagal menambahkan perangkat.", type: "error" });
    } finally {
      setIsSubmittingAddDevices(false);
    }
  };

  const handleRemoveDeviceFromGroup = async (deviceId: string, deviceName: string) => {
    try {
      const res = await fetch("/api/devices/bulk-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceIds: [deviceId],
          groupId: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Gagal melepas perangkat.");
      setToast({ message: `Perangkat '${deviceName}' dilepas dari grup.`, type: "success" });
      fetchGroupDetail(true);
    } catch (err: any) {
      setToast({ message: err.message || "Gagal melepas perangkat.", type: "error" });
    }
  };

  // Max log count for 24h chart scaling
  const maxLogCount = useMemo(() => {
    if (logVolume24h.length === 0) return 10;
    return Math.max(...logVolume24h.map((l) => l.count), 10);
  }, [logVolume24h]);

  const colorConfig = group ? groupColorHexMap[group.warnaGaris] || groupColorHexMap.biru : groupColorHexMap.biru;

  if (isLoading) {
    return (
      <div style={{ padding: "40px 24px", maxWidth: "1200px", margin: "0 auto", textAlign: "center", color: "var(--text-secondary, #5B6270)" }}>
        Memuat detail grup perangkat...
      </div>
    );
  }

  if (errorMsg || !group) {
    return (
      <div style={{ padding: "40px 24px", maxWidth: "800px", margin: "0 auto" }}>
        <div style={{ padding: "16px", backgroundColor: "rgba(200, 55, 45, 0.05)", border: "1px solid rgba(200, 55, 45, 0.2)", borderRadius: "6px", color: "#C8372D", marginBottom: "16px" }}>
          {errorMsg || "Grup tidak ditemukan."}
        </div>
        <Link
          href="/grup"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            backgroundColor: "#FFFFFF",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "4px",
            color: "var(--text-main, #1F2430)",
            textDecoration: "none",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          ← Kembali ke Daftar Grup
        </Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app, #FAFAF8)", paddingBottom: "70px" }}>
      <div style={{ padding: "20px 24px", maxWidth: "1300px", margin: "0 auto" }}>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Navigasi Atas & Judul */}
      <div style={{ marginBottom: "16px" }}>
        <Link
          href="/grup"
          style={{
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-secondary, #5B6270)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          ← Kembali ke Daftar Grup
        </Link>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "16px",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "3px",
              border: `3px solid ${colorConfig.border}`,
              backgroundColor: colorConfig.bg,
            }}
          />
          <div>
            <h1
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: "var(--text-main, #1F2430)",
                margin: 0,
                letterSpacing: "-0.2px",
              }}
            >
              {group.nama}
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "var(--text-secondary, #5B6270)",
                margin: "4px 0 0 0",
              }}
            >
              {group.deskripsi || "Tidak ada deskripsi tambahan untuk grup ini."}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <Link
            href={`/peta?group=${group.id}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              minHeight: "44px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--accent-blue, #1F5FBF)",
              backgroundColor: "rgba(31, 95, 191, 0.06)",
              border: "1px solid rgba(31, 95, 191, 0.25)",
              borderRadius: "4px",
              textDecoration: "none",
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
              <line x1="8" y1="2" x2="8" y2="18" />
              <line x1="16" y1="6" x2="16" y2="22" />
            </svg>
            Buka di Peta Jaringan
          </Link>

          {currentUserRole === "admin" && (
            <button
              type="button"
              onClick={handleOpenAddDeviceModal}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                minHeight: "44px",
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "var(--accent-blue, #1F5FBF)",
                border: "1px solid var(--accent-blue, #1F5FBF)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              + Tambah Perangkat ke Grup
            </button>
          )}
        </div>
      </div>

      {/* Ringkasan Status Donut / Bilah Status Proporsional */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid var(--border-color, #E6E4DF)", borderRadius: "6px", padding: "14px 16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase" }}>
              Status Keaktifan
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-main, #1F2430)", marginTop: "4px" }}>
              {summary.onlineCount} <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--text-secondary, #5B6270)" }}>dari {summary.totalDevices} online</span>
            </div>
            {/* Status bar */}
            <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", marginTop: "10px", backgroundColor: "#E6E4DF" }}>
              {summary.totalDevices > 0 && (
                <>
                  <div style={{ width: `${(summary.onlineCount / summary.totalDevices) * 100}%`, backgroundColor: "#1F5FBF" }} title={`Online: ${summary.onlineCount}`} />
                  <div style={{ width: `${(summary.logStoppedCount / summary.totalDevices) * 100}%`, backgroundColor: "#D97706" }} title={`Log Berhenti: ${summary.logStoppedCount}`} />
                  <div style={{ width: `${(summary.offlineCount / summary.totalDevices) * 100}%`, backgroundColor: "#C8372D" }} title={`Offline: ${summary.offlineCount}`} />
                  <div style={{ width: `${(summary.unknownCount / summary.totalDevices) * 100}%`, backgroundColor: "#5B6270" }} title={`Belum Ada Data: ${summary.unknownCount}`} />
                </>
              )}
            </div>
          </div>

          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid var(--border-color, #E6E4DF)", borderRadius: "6px", padding: "14px 16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase" }}>
              Uptime Gabungan (24 Jam)
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: summary.uptime24h !== null && summary.uptime24h >= 99 ? "var(--accent-blue, #1F5FBF)" : summary.uptime24h !== null ? "#C8372D" : "var(--text-secondary, #5B6270)", marginTop: "4px" }}>
              {summary.uptime24h !== null ? `${summary.uptime24h}%` : "-"}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)", marginTop: "4px" }}>
              {summary.uptime24h !== null ? "Berdasarkan rasio aktif anggota" : "Belum cukup data riwayat"}
            </div>
          </div>

          <div style={{ backgroundColor: "#FFFFFF", border: "1px solid var(--border-color, #E6E4DF)", borderRadius: "6px", padding: "14px 16px" }}>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textTransform: "uppercase" }}>
              Insiden Terbuka
            </div>
            <div style={{ fontSize: "20px", fontWeight: 700, color: summary.openIncidentCount > 0 ? "#C8372D" : "var(--text-main, #1F2430)", marginTop: "4px" }}>
              {summary.openIncidentCount}
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)", marginTop: "4px" }}>
              {summary.openIncidentCount > 0 ? "Perlu penanganan teknis" : "Semua insiden terselesaikan"}
            </div>
          </div>
        </div>
      )}

      {/* Grafik Volume Log Gabungan 24 Jam */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          padding: "16px 20px",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main, #1F2430)", margin: 0 }}>
            Volume Log Gabungan (24 Jam Terakhir)
          </h2>
          <span style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
            Total event dari seluruh {devices.length} perangkat di grup
          </span>
        </div>

        {logVolume24h.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--text-secondary, #5B6270)", fontSize: "13px" }}>
            Belum ada aktivitas log tercatat dalam 24 jam terakhir.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", height: "100px", gap: "4px", paddingTop: "10px" }}>
            {logVolume24h.map((point) => {
              const heightPct = Math.max(4, Math.round((point.count / maxLogCount) * 100));
              const timeLabel = point.hour.split("T")[1]?.slice(0, 5) || "";
              return (
                <div
                  key={point.hour}
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: "100%",
                    justifyContent: "flex-end",
                  }}
                  title={`Pukul ${timeLabel}: ${point.count.toLocaleString()} log`}
                >
                  <div
                    style={{
                      width: "100%",
                      height: `${heightPct}%`,
                      backgroundColor: "rgba(31, 95, 191, 0.4)",
                      borderTop: "2px solid var(--accent-blue, #1F5FBF)",
                      borderRadius: "2px 2px 0 0",
                    }}
                  />
                  <span style={{ fontSize: "9px", color: "var(--text-secondary, #5B6270)", marginTop: "4px" }}>
                    {timeLabel}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bagian Daftar Perangkat Anggota */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          overflow: "hidden",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-color, #E6E4DF)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main, #1F2430)", margin: 0 }}>
            Daftar Perangkat Anggota ({devices.length})
          </h2>
        </div>

        {devices.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--text-secondary, #5B6270)", fontSize: "13px" }}>
            Belum ada perangkat yang dimasukkan ke grup ini.
            {currentUserRole === "admin" && (
              <div style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  onClick={handleOpenAddDeviceModal}
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "var(--accent-blue, #1F5FBF)",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  + Tambah Perangkat Sekarang
                </button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ backgroundColor: "#FAFAF8", borderBottom: "1px solid var(--border-color, #E6E4DF)" }}>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Nama Perangkat</th>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Tipe</th>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Alamat IP</th>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Status</th>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>Ping (RTT)</th>
                  <th style={{ padding: "10px 16px", fontWeight: 600, color: "var(--text-secondary, #5B6270)", textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((dev) => (
                  <tr key={dev.id} style={{ borderBottom: "1px solid var(--border-color, #E6E4DF)" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <Link
                        href={`/perangkat/${dev.id}`}
                        style={{ fontWeight: 600, color: "var(--accent-blue, #1F5FBF)", textDecoration: "none" }}
                      >
                        {dev.name}
                      </Link>
                      {dev.location && (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)", marginTop: "2px" }}>
                          Lokasi: {dev.location}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "12px 16px", color: "var(--text-secondary, #5B6270)", textTransform: "capitalize" }}>
                      {dev.type}
                    </td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: "12px" }}>
                      {dev.ipAddress || "-"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                          fontSize: "12px",
                          fontWeight: 600,
                          color:
                            dev.calculatedStatus === "online"
                              ? "var(--accent-blue, #1F5FBF)"
                              : dev.calculatedStatus === "log_stopped"
                              ? "#D97706"
                              : dev.calculatedStatus === "offline"
                              ? "#C8372D"
                              : "#5B6270",
                        }}
                      >
                        <span>
                          {dev.calculatedStatus === "online"
                            ? "●"
                            : dev.calculatedStatus === "log_stopped"
                            ? "⏸"
                            : dev.calculatedStatus === "offline"
                            ? "✕"
                            : "?"}
                        </span>
                        <span>
                          {dev.calculatedStatus === "online"
                            ? "Normal"
                            : dev.calculatedStatus === "log_stopped"
                            ? "Log Berhenti"
                            : dev.calculatedStatus === "offline"
                            ? "Offline"
                            : "Belum Ada Data"}
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                      {dev.lastPingRtt !== null ? `${Math.round(dev.lastPingRtt)} ms` : dev.pingEnabled ? "RTO" : "Nonaktif"}
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: "6px" }}>
                        <Link
                          href={`/perangkat/${dev.id}`}
                          style={{
                            padding: "4px 8px",
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--text-main, #1F2430)",
                            backgroundColor: "#FAFAF8",
                            border: "1px solid var(--border-color, #E6E4DF)",
                            borderRadius: "4px",
                            textDecoration: "none",
                          }}
                        >
                          Detail
                        </Link>
                        {currentUserRole === "admin" && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDeviceFromGroup(dev.id, dev.name)}
                            style={{
                              padding: "4px 8px",
                              fontSize: "12px",
                              fontWeight: 500,
                              color: "#C8372D",
                              backgroundColor: "#FFFFFF",
                              border: "1px solid rgba(200, 55, 45, 0.2)",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                            title="Lepas perangkat dari grup ini (perangkat tidak terhapus)"
                          >
                            Lepas
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bagian Insiden Terbuka di Seluruh Anggota Grup */}
      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          padding: "16px 20px",
        }}
      >
        <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main, #1F2430)", margin: "0 0 12px 0" }}>
          Insiden Terbuka ({openIncidents.length})
        </h2>

        {openIncidents.length === 0 ? (
          <div style={{ color: "var(--text-secondary, #5B6270)", fontSize: "13px" }}>
            Tidak ada insiden terbuka pada perangkat-perangkat di area ini.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {openIncidents.map((inc) => (
              <div
                key={inc.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(200, 55, 45, 0.04)",
                  border: "1px solid rgba(200, 55, 45, 0.2)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main, #1F2430)" }}>
                    {inc.title}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)", marginTop: "2px" }}>
                    Perangkat: <strong>{inc.deviceName || "Unknown"}</strong> • {inc.description}
                  </div>
                </div>
                <Link
                  href={`/insiden`}
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--accent-blue, #1F5FBF)",
                    textDecoration: "none",
                  }}
                >
                  Buka Insiden →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Tambah Perangkat ke Grup */}
      {isAddDeviceModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "16px",
          }}
        >
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "8px",
              width: "100%",
              maxWidth: "520px",
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
              border: "1px solid var(--border-color, #E6E4DF)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                Tambah Perangkat ke '{group.nama}'
              </h3>
              <button
                type="button"
                onClick={() => setIsAddDeviceModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "var(--text-secondary, #5B6270)",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1 }}>
              {allOtherDevices.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "var(--text-secondary, #5B6270)", fontSize: "13px" }}>
                  Seluruh perangkat yang ada sudah berada di dalam grup ini.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {allOtherDevices.map((d) => {
                    const isSelected = selectedDeviceIdsToAdd.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px 12px",
                          border: isSelected ? "1px solid var(--accent-blue, #1F5FBF)" : "1px solid var(--border-color, #E6E4DF)",
                          borderRadius: "4px",
                          backgroundColor: isSelected ? "rgba(31, 95, 191, 0.04)" : "#FFFFFF",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDeviceIdsToAdd([...selectedDeviceIdsToAdd, d.id]);
                            } else {
                              setSelectedDeviceIdsToAdd(selectedDeviceIdsToAdd.filter((id) => id !== d.id));
                            }
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                            {d.name} {d.ipAddress ? `(${d.ipAddress})` : ""}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)" }}>
                            {d.groupName ? `Saat ini di grup: ${d.groupName}` : "Tanpa Grup"} • Lokasi: {d.location || "-"}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              style={{
                padding: "14px 20px",
                borderTop: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#FAFAF8",
              }}
            >
              <span style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)" }}>
                {selectedDeviceIdsToAdd.length} perangkat dipilih
              </span>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => setIsAddDeviceModalOpen(false)}
                  style={{
                    minHeight: "44px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--text-main, #1F2430)",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAddDevices}
                  disabled={selectedDeviceIdsToAdd.length === 0 || isSubmittingAddDevices}
                  style={{
                    minHeight: "44px",
                    padding: "8px 20px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#FFFFFF",
                    backgroundColor: "var(--accent-blue, #1F5FBF)",
                    border: "1px solid var(--accent-blue, #1F5FBF)",
                    borderRadius: "4px",
                    cursor: selectedDeviceIdsToAdd.length === 0 || isSubmittingAddDevices ? "not-allowed" : "pointer",
                    opacity: selectedDeviceIdsToAdd.length === 0 || isSubmittingAddDevices ? 0.6 : 1,
                  }}
                >
                  {isSubmittingAddDevices ? "Menambahkan..." : "Tambahkan ke Grup"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
