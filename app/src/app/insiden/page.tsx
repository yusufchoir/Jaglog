"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import Link from "next/link";

interface Incident {
  id: string;
  deviceId: string;
  deviceName: string | null;
  deviceType: string | null;
  ruleKey: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  status: "open" | "ack" | "closed";
  mainEntity: string | null;
  evidence: any[] | null;
}

interface IncidentSummary {
  open: number;
  ack: number;
  closed: number;
}

interface DeviceOption {
  id: string;
  name: string;
}

interface AIAnalysisResult {
  summary: string;
  riskLevel: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  findings: string[];
  recommendations: string[];
  cliCommands: string[];
  confidence: number;
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [summary, setSummary] = useState<IncidentSummary>({ open: 0, ack: 0, closed: 0 });
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>("open");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterDeviceId, setFilterDeviceId] = useState<string>("all");
  const [filterGroupId, setFilterGroupId] = useState<string>("all");
  const [groups, setGroups] = useState<{ id: string; nama: string }[]>([]);

  // Detail Modal state
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIAnalysisResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Sync initial groupId from URL query
  useEffect(() => {
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      const urlGroupId = searchParams.get("groupId");
      if (urlGroupId) {
        setFilterGroupId(urlGroupId);
      }
    }
  }, []);

  // Load device and group options
  useEffect(() => {
    async function loadOptions() {
      try {
        const [devRes, grpRes] = await Promise.all([
          fetch("/api/devices"),
          fetch("/api/groups"),
        ]);
        if (devRes.ok) {
          const devData = await devRes.json();
          if (devData.devices) {
            setDevices(devData.devices.map((d: any) => ({ id: d.id, name: d.name })));
          }
        }
        if (grpRes.ok) {
          const grpData = await grpRes.json();
          if (grpData.groups) {
            setGroups(grpData.groups.map((g: any) => ({ id: g.id, nama: g.nama })));
          }
        }
      } catch (err) {
        console.error("Gagal memuat opsi filter perangkat/grup:", err);
      }
    }
    loadOptions();
  }, []);

  // Fetch incidents
  const fetchIncidents = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.append("status", filterStatus);
      if (filterSeverity !== "all") params.append("severity", filterSeverity);
      if (filterDeviceId !== "all") params.append("deviceId", filterDeviceId);
      if (filterGroupId !== "all") params.append("groupId", filterGroupId);

      // Sinkronkan ke URL
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (filterGroupId !== "all") {
          url.searchParams.set("groupId", filterGroupId);
        } else {
          url.searchParams.delete("groupId");
        }
        window.history.replaceState({}, "", url.toString());
      }

      const res = await fetch(`/api/incidents?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memuat data insiden.");
        setIsLoading(false);
        return;
      }

      setIncidents(data.incidents || []);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan saat memuat insiden.");
    } finally {
      setIsLoading(false);
    }
  }, [filterStatus, filterSeverity, filterDeviceId, filterGroupId]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const { subscribe } = useLiveUpdates();
  const incidentDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedFetchIncidents = useCallback(() => {
    if (incidentDebounceRef.current) clearTimeout(incidentDebounceRef.current);
    incidentDebounceRef.current = setTimeout(() => {
      fetchIncidents();
    }, 400);
  }, [fetchIncidents]);

  useEffect(() => {
    const unsub = subscribe("insiden.berubah", debouncedFetchIncidents);
    const unsubResync = subscribe("resync", debouncedFetchIncidents);
    return () => {
      unsub();
      unsubResync();
      if (incidentDebounceRef.current) clearTimeout(incidentDebounceRef.current);
    };
  }, [subscribe, debouncedFetchIncidents]);

  // Update status (open, ack, closed)
  const handleUpdateStatus = async (id: string, newStatus: "open" | "ack" | "closed") => {
    try {
      const res = await fetch("/api/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memperbarui status.");
        return;
      }

      setActionMessage(`Status insiden berhasil diubah menjadi '${newStatus}'.`);
      setTimeout(() => setActionMessage(null), 3000);

      // Refresh incident list
      fetchIncidents();

      // Update selected incident in modal if open
      if (selectedIncident && selectedIncident.id === id) {
        setSelectedIncident({ ...selectedIncident, status: newStatus });
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan saat memperbarui status.");
    }
  };

  // Run AI Analysis for incident
  const handleRunAiAnalysis = async (incidentId: string, force = false) => {
    setIsAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, force }),
      });
      const data = await res.json();

      if (!res.ok) {
        setAiError(data.error || "Gagal memproses analisa AI.");
        return;
      }

      setAiResult(data.analysis);
    } catch (err) {
      console.error(err);
      setAiError("Terjadi kesalahan jaringan saat menghubungi modul AI.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // Helper copy CLI command
  const handleCopyCommand = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case "critical":
        return { label: "KRITIS", bg: "#FEF2F2", text: "#991B1B", border: "#FCA5A5" };
      case "high":
        return { label: "TINGGI", bg: "#FFF7ED", text: "#9A3412", border: "#FDBA74" };
      case "medium":
        return { label: "SEDANG", bg: "#FEFCE8", text: "#854D0E", border: "#FDE047" };
      default:
        return { label: "RENDAH", bg: "#F0FDF4", text: "#166534", border: "#86EFAC" };
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "open":
        return { label: "Terbuka", bg: "#FEF2F2", text: "var(--accent-red)", dot: "var(--accent-red)" };
      case "ack":
        return { label: "Ditinjau", bg: "#EFF6FF", text: "var(--accent-blue)", dot: "var(--accent-blue)" };
      default:
        return { label: "Selesai", bg: "#F1F5F9", text: "#475569", dot: "#94A3B8" };
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header Title */}
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--text-main)",
              letterSpacing: "-0.4px",
            }}
          >
            Insiden Keamanan
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Deteksi anomali, serangan brute-force, scan port, dan aktivitas mencurigakan dari log perangkat.
          </p>
        </div>

        {/* Notifikasi Status Aksi */}
        {actionMessage && (
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
            {actionMessage}
          </div>
        )}

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

        {/* Ringkasan Status Cards */}
        <div
          className="grid-2-mobile mobile-gap-8"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            onClick={() => setFilterStatus("open")}
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: filterStatus === "open" ? "3px solid var(--accent-red)" : "3px solid transparent",
              borderRadius: "var(--radius-md)",
              padding: "16px 20px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              Insiden Terbuka
            </div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                color: summary.open > 0 ? "var(--accent-red)" : "var(--text-main)",
                marginTop: "4px",
              }}
            >
              {summary.open}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Perlu perhatian segera
            </div>
          </div>

          <div
            onClick={() => setFilterStatus("ack")}
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: filterStatus === "ack" ? "3px solid var(--accent-blue)" : "3px solid transparent",
              borderRadius: "var(--radius-md)",
              padding: "16px 20px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              Sedang Ditinjau
            </div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                color: summary.ack > 0 ? "var(--accent-blue)" : "var(--text-main)",
                marginTop: "4px",
              }}
            >
              {summary.ack}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Dalam proses penanganan
            </div>
          </div>

          <div
            onClick={() => setFilterStatus("closed")}
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: filterStatus === "closed" ? "3px solid #16A34A" : "3px solid transparent",
              borderRadius: "var(--radius-md)",
              padding: "16px 20px",
              cursor: "pointer",
              transition: "all 0.15s ease",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
              Insiden Selesai
            </div>
            <div
              style={{
                fontSize: "26px",
                fontWeight: 700,
                color: "var(--text-main)",
                marginTop: "4px",
              }}
            >
              {summary.closed}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
              Telah ditutup / resolusi
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <SectionErrorBoundary sectionName="Daftar Insiden Keamanan">
        <div
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            padding: "14px 18px",
            marginBottom: "16px",
            display: "flex",
            flexWrap: "wrap",
            gap: "14px",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "center" }}>
            {/* Status Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Status:</span>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  fontSize: "13px",
                  padding: "5px 10px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                }}
              >
                <option value="all">Semua Status</option>
                <option value="open">Terbuka (Open)</option>
                <option value="ack">Ditinjau (Ack)</option>
                <option value="closed">Selesai (Closed)</option>
              </select>
            </div>

            {/* Severity Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Keparahan:</span>
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                style={{
                  fontSize: "13px",
                  padding: "5px 10px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                }}
              >
                <option value="all">Semua Tingkat</option>
                <option value="critical">Kritis (Critical)</option>
                <option value="high">Tinggi (High)</option>
                <option value="medium">Sedang (Medium)</option>
                <option value="low">Rendah (Low)</option>
              </select>
            </div>

            {/* Device Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Perangkat:</span>
              <select
                value={filterDeviceId}
                onChange={(e) => setFilterDeviceId(e.target.value)}
                style={{
                  fontSize: "13px",
                  padding: "5px 10px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                  maxWidth: "200px",
                }}
              >
                <option value="all">Semua Perangkat</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Group Filter */}
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Grup / Area:</span>
              <select
                value={filterGroupId}
                onChange={(e) => setFilterGroupId(e.target.value)}
                style={{
                  fontSize: "13px",
                  padding: "5px 10px",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: "#FFFFFF",
                  color: "var(--text-main)",
                  outline: "none",
                  maxWidth: "200px",
                }}
              >
                <option value="all">Semua Area</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.nama}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={() => fetchIncidents()}
            style={{
              padding: "6px 14px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: "#FFFFFF",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              color: "var(--text-main)",
            }}
          >
            Segarkan
          </button>
        </div>

        {/* Tabel Insiden */}
        <div
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            overflow: "hidden",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          {isLoading ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
              Memuat data insiden...
            </div>
          ) : incidents.length === 0 ? (
            <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
              Tidak ada insiden yang sesuai dengan filter.
            </div>
          ) : (
            <>
              <div className="desktop-only" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
                <thead>
                  <tr
                    style={{
                      backgroundColor: "#F8FAFC",
                      borderBottom: "1px solid var(--border-color)",
                      color: "var(--text-secondary)",
                      fontSize: "11px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    <th style={{ padding: "12px 16px" }}>Status</th>
                    <th style={{ padding: "12px 16px" }}>Keparahan</th>
                    <th style={{ padding: "12px 16px" }}>Perangkat</th>
                    <th style={{ padding: "12px 16px" }}>Jenis Insiden & Entitas</th>
                    <th style={{ padding: "12px 16px", textAlign: "center" }}>Frekuensi</th>
                    <th style={{ padding: "12px 16px" }}>Terakhir Terlihat</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map((inc) => {
                    const sev = getSeverityBadge(inc.severity);
                    const st = getStatusBadge(inc.status);

                    return (
                      <tr
                        key={inc.id}
                        style={{
                          borderBottom: "1px solid var(--border-color)",
                          transition: "background-color 0.1s ease",
                        }}
                        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#F9FAFB")}
                        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        {/* Status */}
                        <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              backgroundColor: st.bg,
                              color: st.text,
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            <span
                              style={{
                                width: "6px",
                                height: "6px",
                                borderRadius: "50%",
                                backgroundColor: st.dot,
                              }}
                            />
                            {st.label}
                          </span>
                        </td>

                        {/* Keparahan */}
                        <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "4px",
                              backgroundColor: sev.bg,
                              color: sev.text,
                              border: `1px solid ${sev.border}`,
                            }}
                          >
                            {sev.label}
                          </span>
                        </td>

                        {/* Perangkat */}
                        <td style={{ padding: "12px 16px" }}>
                          <Link
                            href={`/perangkat/${inc.deviceId}`}
                            style={{
                              fontWeight: 600,
                              color: "var(--accent-blue)",
                              textDecoration: "none",
                            }}
                          >
                            {inc.deviceName || "Perangkat"}
                          </Link>
                          <div style={{ fontSize: "11px", color: "var(--text-secondary)", textTransform: "uppercase" }}>
                            {inc.deviceType || "generic"}
                          </div>
                        </td>

                        {/* Judul & Entitas */}
                        <td style={{ padding: "12px 16px" }}>
                          <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{inc.title}</div>
                          {inc.mainEntity && (
                            <div
                              className="font-mono"
                              style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}
                            >
                              Entitas: <span style={{ color: "var(--text-main)" }}>{inc.mainEntity}</span>
                            </div>
                          )}
                        </td>

                        {/* Frekuensi */}
                        <td style={{ padding: "12px 16px", textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              backgroundColor: "#F1F5F9",
                              fontSize: "12px",
                              fontWeight: 700,
                              color: "#334155",
                            }}
                          >
                            {inc.count}x
                          </span>
                        </td>

                        {/* Terakhir Terlihat */}
                        <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                          {new Date(inc.lastSeen).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          WIB
                        </td>

                        {/* Aksi */}
                        <td style={{ padding: "12px 16px", textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => {
                              setSelectedIncident(inc);
                              setAiResult(null);
                              setAiError(null);
                            }}
                            style={{
                              padding: "5px 10px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "#FFFFFF",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                              color: "var(--accent-blue)",
                              marginRight: "6px",
                            }}
                          >
                            Detail & Bukti
                          </button>

                          {inc.status === "open" && (
                            <button
                              onClick={() => handleUpdateStatus(inc.id, "ack")}
                              style={{
                                padding: "5px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                backgroundColor: "transparent",
                                border: "1px solid var(--border-color)",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                              }}
                            >
                              Tinjau
                            </button>
                          )}

                          {inc.status !== "closed" && (
                            <button
                              onClick={() => handleUpdateStatus(inc.id, "closed")}
                              style={{
                                padding: "5px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                backgroundColor: "#F0FDF4",
                                border: "1px solid #86EFAC",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                color: "#166534",
                                marginLeft: "6px",
                              }}
                            >
                              Tutup
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="mobile-only" style={{ display: "none" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px" }}>
                {incidents.map((inc) => {
                  const sev = getSeverityBadge(inc.severity);
                  const st = getStatusBadge(inc.status);
                  const stripeColor =
                    inc.severity === "critical"
                      ? "var(--accent-red)"
                      : inc.severity === "high"
                      ? "#E65100"
                      : inc.severity === "medium"
                      ? "#F57F17"
                      : "var(--accent-blue)";

                  return (
                    <div
                      key={`mob-${inc.id}`}
                      style={{
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color)",
                        borderLeft: `4px solid ${stripeColor}`,
                        borderRadius: "var(--radius-sm)",
                        padding: "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "3px",
                              backgroundColor: sev.bg,
                              color: sev.text,
                              border: `1px solid ${sev.border}`,
                            }}
                          >
                            {sev.label}
                          </span>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 600,
                              padding: "2px 6px",
                              borderRadius: "3px",
                              backgroundColor: st.bg,
                              color: st.text,
                            }}
                          >
                            {st.label}
                          </span>
                        </div>

                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {new Date(inc.lastSeen).toLocaleTimeString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}{" "}
                          WIB
                        </span>
                      </div>

                      <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-main)" }}>
                        {inc.title}
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px", color: "var(--text-secondary)" }}>
                        <Link
                          href={`/perangkat/${inc.deviceId}`}
                          style={{
                            fontWeight: 600,
                            color: "var(--accent-blue)",
                            textDecoration: "none",
                          }}
                        >
                          {inc.deviceName || "Perangkat"}
                        </Link>
                        {inc.mainEntity && (
                          <span className="font-mono" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {inc.mainEntity}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginTop: "4px",
                          paddingTop: "10px",
                          borderTop: "1px solid var(--border-color)",
                        }}
                      >
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                          Frekuensi: <strong style={{ color: "var(--text-main)" }}>{inc.count}x</strong>
                        </span>

                        <div style={{ display: "flex", gap: "6px" }}>
                          {inc.status === "open" && (
                            <button
                              onClick={() => handleUpdateStatus(inc.id, "ack")}
                              className="touch-target"
                              style={{
                                padding: "6px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                backgroundColor: "transparent",
                                border: "1px solid var(--border-color)",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                color: "var(--text-secondary)",
                              }}
                            >
                              Tinjau
                            </button>
                          )}

                          {inc.status !== "closed" && (
                            <button
                              onClick={() => handleUpdateStatus(inc.id, "closed")}
                              className="touch-target"
                              style={{
                                padding: "6px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                                backgroundColor: "#F0FDF4",
                                border: "1px solid #86EFAC",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                color: "#166534",
                              }}
                            >
                              Tutup
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedIncident(inc);
                              setAiResult(null);
                              setAiError(null);
                            }}
                            className="touch-target"
                            style={{
                              padding: "6px 12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "var(--accent-blue)",
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                              color: "#FFFFFF",
                            }}
                          >
                            Detail & Bukti
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
        </div>
        </SectionErrorBoundary>
      </main>

      {/* Modal Detail Insiden & Bukti & Analisa AI */}
      {selectedIncident && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
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
              maxWidth: "800px",
              maxHeight: "90vh",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: "18px 24px",
                borderBottom: "1px solid var(--border-color)",
                borderTop: "3px solid var(--accent-red)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      ...getSeverityBadge(selectedIncident.severity),
                    }}
                  >
                    {getSeverityBadge(selectedIncident.severity).label}
                  </span>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    Rule: <code className="font-mono">{selectedIncident.ruleKey}</code>
                  </span>
                </div>
                <h2
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: "var(--text-main)",
                    marginTop: "6px",
                  }}
                >
                  {selectedIncident.title}
                </h2>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "4px" }}>
                  Perangkat:{" "}
                  <strong>{selectedIncident.deviceName || selectedIncident.deviceId}</strong> | Entitas:{" "}
                  <strong className="font-mono">{selectedIncident.mainEntity || "-"}</strong> | Frekuensi:{" "}
                  <strong>{selectedIncident.count}x</strong>
                </div>
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                }}
              >
                &times;
              </button>
            </div>

            {/* Modal Body Scrollable */}
            <SectionErrorBoundary sectionName="Detail Insiden & Analisa AI">
            <div style={{ padding: "20px 24px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Bagian Analisa AI */}
              <div
                style={{
                  backgroundColor: "#F8FAFC",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  padding: "16px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        width: "8px",
                        height: "8px",
                        backgroundColor: "var(--accent-blue)",
                        borderRadius: "2px",
                      }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)" }}>
                      Analisa Investigasi AI
                    </span>
                  </div>

                  <button
                    onClick={() => handleRunAiAnalysis(selectedIncident.id, true)}
                    disabled={isAiLoading}
                    style={{
                      padding: "5px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: isAiLoading ? "#E2E8F0" : "var(--accent-blue)",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: isAiLoading ? "not-allowed" : "pointer",
                    }}
                  >
                    {isAiLoading ? "Sedang Menganalisa..." : aiResult ? "Analisa Ulang" : "Analisa dengan AI"}
                  </button>
                </div>

                {aiError && (
                  <div
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "#FEF2F2",
                      border: "1px solid #FCA5A5",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "12px",
                      color: "#991B1B",
                      marginBottom: "10px",
                    }}
                  >
                    {aiError}
                  </div>
                )}

                {aiResult ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}>
                    {/* Ringkasan & Risiko */}
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          ...getSeverityBadge(aiResult.riskLevel.toLowerCase()),
                        }}
                      >
                        RISIKO: {aiResult.riskLevel}
                      </span>
                      <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        Keyakinan AI: {Math.round(aiResult.confidence * 100)}%
                      </span>
                    </div>

                    <div style={{ color: "var(--text-main)", lineHeight: "1.5" }}>{aiResult.summary}</div>

                    {/* Temuan */}
                    {aiResult.findings && aiResult.findings.length > 0 && (
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>
                          TEMUAN INVESTIGASI:
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-main)", lineHeight: "1.5" }}>
                          {aiResult.findings.map((f, i) => (
                            <li key={i}>{f}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rekomendasi */}
                    {aiResult.recommendations && aiResult.recommendations.length > 0 && (
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>
                          LANGKAH MITIGASI REKOMENDASI:
                        </div>
                        <ul style={{ margin: 0, paddingLeft: "20px", color: "var(--text-main)", lineHeight: "1.5" }}>
                          {aiResult.recommendations.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Rekomendasi Perintah CLI */}
                    {aiResult.cliCommands && aiResult.cliCommands.length > 0 && (
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>
                          PERINTAH CLI (SALIN & JALANKAN PADA PERANGKAT):
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {aiResult.cliCommands.map((cmd, i) => (
                            <div
                              key={i}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                backgroundColor: "#1E293B",
                                padding: "8px 12px",
                                borderRadius: "4px",
                                color: "#F8FAFC",
                                fontFamily: "var(--font-mono)",
                                fontSize: "12px",
                              }}
                            >
                              <span style={{ overflowX: "auto", whiteSpace: "nowrap" }}>{cmd}</span>
                              <button
                                onClick={() => handleCopyCommand(cmd, i)}
                                style={{
                                  marginLeft: "12px",
                                  padding: "3px 8px",
                                  fontSize: "11px",
                                  backgroundColor: copiedIndex === i ? "#16A34A" : "#334155",
                                  color: "#FFFFFF",
                                  border: "none",
                                  borderRadius: "3px",
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {copiedIndex === i ? "Tersalin!" : "Salin"}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                    Klik tombol &quot;Analisa dengan AI&quot; untuk menjalankan analisa investigasi cerdas, mengidentifikasi pola serangan, dan memperoleh perintah perbaikan cepat sesuai OS perangkat.
                  </div>
                )}
              </div>

              {/* Bukti Log Terlampir */}
              <div>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)", marginBottom: "8px" }}>
                  Bukti Log Kejadian ({selectedIncident.evidence?.length || 0} Baris Log)
                </div>
                {selectedIncident.evidence && selectedIncident.evidence.length > 0 ? (
                  <div
                    style={{
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      overflow: "hidden",
                      maxHeight: "260px",
                      overflowY: "auto",
                    }}
                  >
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px", textAlign: "left" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                          <th style={{ padding: "8px 12px", width: "130px" }}>Waktu (WIB)</th>
                          <th style={{ padding: "8px 12px", width: "90px" }}>Severity / Kat</th>
                          <th style={{ padding: "8px 12px" }}>Pesan Log</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedIncident.evidence.map((ev: any, idx: number) => (
                          <tr
                            key={idx}
                            style={{
                              borderBottom: "1px solid #F1F5F9",
                              backgroundColor: idx % 2 === 0 ? "#FFFFFF" : "#FBFBFA",
                            }}
                          >
                            <td style={{ padding: "6px 12px", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                              {ev.timestamp || ev.eventTime
                                ? new Date(ev.timestamp || ev.eventTime).toLocaleString("id-ID", {
                                    timeZone: "Asia/Jakarta",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    second: "2-digit",
                                  })
                                : "-"}
                            </td>
                            <td style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: ev.severity === "err" || ev.severity === "crit" ? "var(--accent-red)" : "inherit",
                                }}
                              >
                                {ev.severity || "-"}
                              </span>{" "}
                              / <span style={{ color: "var(--text-secondary)" }}>{ev.category || "-"}</span>
                            </td>
                            <td
                              className="font-mono"
                              style={{
                                padding: "6px 12px",
                                wordBreak: "break-all",
                                color: "var(--text-main)",
                              }}
                            >
                              {ev.message || JSON.stringify(ev)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontStyle: "italic" }}>
                    Tidak ada lampiran baris log bukti untuk insiden ini.
                  </div>
                )}
              </div>
            </div>
            </SectionErrorBoundary>

            {/* Modal Footer Actions */}
            <div
              style={{
                padding: "14px 24px",
                borderTop: "1px solid var(--border-color)",
                backgroundColor: "#F8FAFC",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", gap: "8px" }}>
                {selectedIncident.status !== "ack" && (
                  <button
                    onClick={() => handleUpdateStatus(selectedIncident.id, "ack")}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#EFF6FF",
                      color: "var(--accent-blue)",
                      border: "1px solid #BFDBFE",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Tandai Sedang Ditinjau
                  </button>
                )}

                {selectedIncident.status !== "closed" && (
                  <button
                    onClick={() => handleUpdateStatus(selectedIncident.id, "closed")}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#F0FDF4",
                      color: "#166534",
                      border: "1px solid #86EFAC",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Tandai Selesai (Tutup Insiden)
                  </button>
                )}

                {selectedIncident.status === "closed" && (
                  <button
                    onClick={() => handleUpdateStatus(selectedIncident.id, "open")}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#FEF2F2",
                      color: "var(--accent-red)",
                      border: "1px solid #FCA5A5",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Buka Kembali Insiden
                  </button>
                )}
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                style={{
                  padding: "6px 14px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "#FFFFFF",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  color: "var(--text-main)",
                }}
              >
                Tutup Jendela
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
