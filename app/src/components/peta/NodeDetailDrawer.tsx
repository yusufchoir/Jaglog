"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { DeviceTypeIcon } from "./DeviceTypeIcon";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";

interface NodeDetailData {
  node: {
    id: string;
    mapId: string;
    deviceId: string | null;
    isVirtual: boolean;
    tipeVirtual?: string | null;
    nama: string;
    tipe: string;
    ip: string | null;
    lokasi: string | null;
    catatan: string | null;
    status: "online" | "log_stopped" | "offline" | "unknown";
    statusDurationText: string;
    lastSeenAt: string | null;
    ping?: {
      enabled: boolean;
      isOk: boolean | null;
      lastPingAt: string | null;
      rttMs: number | null;
    };
    uptime?: {
      uptime24h: number | null;
      uptime7d: number | null;
      totalUptimeSeconds: number | null;
    };
    statusTimeline?: Array<{
      status: string;
      percentage: number;
      durationMinutes: number;
    }>;
  };
  logStats?: {
    total24h: number;
    breakdown: {
      critical: number;
      error: number;
      warning: number;
      info: number;
    };
    ratePerMinute: number;
    recentEvents: Array<{
      id: number;
      eventTime: string;
      severity: number;
      category: string;
      message: string;
    }>;
  };
  insidenTerbuka?: Array<{
    id: string;
    severity: string;
    title: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
  }>;
  analisaAi?: {
    id: string;
    riskLevel: string;
    summary: string;
    recommendations: string[];
    suspectedAttack: string | null;
    createdAt: string;
  } | null;
  koneksi?: Array<{
    nodeId: string;
    nama: string;
    tipe: string;
    status: string;
    linkLabel: string | null;
    linkType: string;
  }>;
}

export function NodeDetailDrawer({
  nodeId,
  onClose,
  onSelectNode,
  currentUserRole = "viewer",
}: {
  nodeId: string | null;
  onClose: () => void;
  onSelectNode?: (targetNodeId: string) => void;
  currentUserRole?: "admin" | "viewer";
}) {
  const [data, setData] = useState<NodeDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const fetchDetail = useCallback(async (id: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/peta/node/${id}/detail`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal memuat rincian node`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || "Gagal memuat rincian node.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (nodeId) {
      fetchDetail(nodeId);
      // Pindahkan fokus ke tombol tutup saat drawer dibuka
      setTimeout(() => {
        closeBtnRef.current?.focus();
      }, 50);
    } else {
      setData(null);
      setError(null);
    }
  }, [nodeId, fetchDetail]);

  // Tutup dengan keyboard Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && nodeId) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodeId, onClose]);

  // Live SSE: perbarui status/ping/insiden in-place jika event cocok dengan perangkat ini
  const { subscribe } = useLiveUpdates();
  useEffect(() => {
    if (!data?.node.deviceId) return;
    const currentDeviceId = data.node.deviceId;

    const unsubStatus = subscribe("perangkat.status", (evt) => {
      if (evt.perangkat_id === currentDeviceId && evt.data_ringkas) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            node: {
              ...prev.node,
              status: (evt.data_ringkas?.status_perangkat as any) || prev.node.status,
              ping: {
                ...prev.node.ping,
                enabled: prev.node.ping?.enabled ?? true,
                isOk: evt.data_ringkas?.ping_ok ?? prev.node.ping?.isOk ?? null,
                lastPingAt: new Date().toISOString(),
                rttMs: evt.data_ringkas?.ping_rtt ?? prev.node.ping?.rttMs ?? null,
              },
            },
          };
        });
      }
    });

    const unsubPing = subscribe("perangkat.ping", (evt) => {
      if (evt.perangkat_id === currentDeviceId && evt.data_ringkas) {
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            node: {
              ...prev.node,
              ping: {
                ...prev.node.ping,
                enabled: prev.node.ping?.enabled ?? true,
                isOk: evt.data_ringkas?.ping_ok ?? prev.node.ping?.isOk ?? null,
                lastPingAt: new Date().toISOString(),
                rttMs: evt.data_ringkas?.ping_rtt ?? prev.node.ping?.rttMs ?? null,
              },
            },
          };
        });
      }
    });

    return () => {
      unsubStatus();
      unsubPing();
    };
  }, [data?.node.deviceId, subscribe]);

  const handleCopyIp = (ip: string) => {
    navigator.clipboard.writeText(ip);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  };

  const handlePingNow = async () => {
    if (!data?.node.deviceId) return;
    setIsPinging(true);
    setPingResult(null);
    try {
      const res = await fetch(`/api/devices/${data.node.deviceId}/ping`, {
        method: "POST",
      });
      const resJson = await res.json();
      if (res.ok) {
        setPingResult(
          resJson.pingOk ? `Sukses: RTT ${resJson.rttMs} ms` : "RTO: Tidak membalas ping"
        );
        fetchDetail(data.node.id);
      } else {
        setPingResult(resJson.error || "Gagal tes ping.");
      }
    } catch {
      setPingResult("Koneksi gagal saat tes ping.");
    } finally {
      setIsPinging(false);
    }
  };

  const handleTriggerAiAnalysis = async () => {
    if (!data?.node.deviceId) return;
    setIsAnalyzing(true);
    setAiError(null);
    try {
      const res = await fetch(`/api/devices/${data.node.deviceId}/analyze`, {
        method: "POST",
      });
      if (res.ok) {
        fetchDetail(data.node.id);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setAiError(errJson.error || "Gagal menjalankan analisa AI.");
      }
    } catch {
      setAiError("Terjadi kesalahan jaringan.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!nodeId) return null;

  const node = data?.node;
  const statusConfig = {
    online: { color: "#15803D", bg: "#F0FDF4", glyph: "●", label: "Online" },
    log_stopped: { color: "#B45309", bg: "#FEFCE8", glyph: "◐", label: "Log berhenti" },
    offline: { color: "#B91C1C", bg: "#FEF2F2", glyph: "○", label: "Offline" },
    unknown: { color: "#64748B", bg: "#F1F5F9", glyph: "◌", label: "Belum ada data" },
  }[node?.status || "unknown"] || {
    color: "#64748B",
    bg: "#F1F5F9",
    glyph: "◌",
    label: "Belum ada data",
  };

  return (
    <aside
      ref={drawerRef}
      aria-label="Panel Keterangan Detail Perangkat"
      className="peta-detail-drawer"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        maxWidth: "420px",
        backgroundColor: "var(--bg-panel, #FFFFFF)",
        borderLeft: "1px solid var(--border-color, #E6E4DF)",
        boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.08)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        transition: "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Garis Aksen Tipis Atas */}
      <div style={{ height: "3px", backgroundColor: "var(--accent-blue, #1F5FBF)", width: "100%" }} />

      {/* Header Drawer */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "12px",
          position: "sticky",
          top: 0,
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          zIndex: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ color: "var(--accent-blue, #1F5FBF)" }}>
              <DeviceTypeIcon
                type={node ? (node.isVirtual ? (node.tipeVirtual || "cloud") : node.tipe) : "other"}
                size={18}
              />
            </span>
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-main, #1F2430)",
                letterSpacing: "-0.2px",
                margin: 0,
                wordBreak: "break-word",
              }}
            >
              {node?.nama || "Memuat..."}
            </h2>
          </div>

          {node && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: "11px",
                  padding: "1px 6px",
                  borderRadius: "3px",
                  fontWeight: 600,
                  backgroundColor: statusConfig.bg,
                  color: statusConfig.color,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <span>{statusConfig.glyph}</span>
                <span>{statusConfig.label}</span>
              </span>

              <span style={{ fontSize: "11px", color: "var(--text-muted, #8C93A0)" }}>
                {node.statusDurationText}
              </span>
            </div>
          )}
        </div>

        {/* Tombol Tutup */}
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Tutup panel detail"
          className="touch-target"
          style={{
            background: "transparent",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "4px",
            width: "32px",
            height: "32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-secondary, #5B6270)",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Konten Drawer */}
      <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "20px" }}>
        {isLoading && !node && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ height: "40px", backgroundColor: "#F3F4F6", borderRadius: "4px" }} />
            <div style={{ height: "80px", backgroundColor: "#F3F4F6", borderRadius: "4px" }} />
            <div style={{ height: "100px", backgroundColor: "#F3F4F6", borderRadius: "4px" }} />
          </div>
        )}

        {error && (
          <div
            style={{
              padding: "12px 14px",
              backgroundColor: "rgba(200, 55, 45, 0.08)",
              border: "1px solid var(--accent-red, #C8372D)",
              borderRadius: "4px",
              color: "var(--accent-red, #C8372D)",
              fontSize: "12px",
            }}
          >
            <p style={{ margin: "0 0 8px 0" }}>{error}</p>
            <button
              onClick={() => nodeId && fetchDetail(nodeId)}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "var(--accent-red, #C8372D)",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              Muat Ulang
            </button>
          </div>
        )}

        {node && (
          <>
            {/* Bagian Identitas Jaringan */}
            <div
              style={{
                padding: "12px 14px",
                backgroundColor: "var(--bg-app, #FAFAF8)",
                border: "1px solid var(--border-color, #E6E4DF)",
                borderRadius: "6px",
                fontSize: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-muted, #8C93A0)" }}>Alamat IP:</span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                    {node.ip || (node.isVirtual ? "Virtual Gateway" : "Token-based (HTTP)")}
                  </span>
                  {node.ip && (
                    <button
                      type="button"
                      onClick={() => handleCopyIp(node.ip!)}
                      title="Salin alamat IP"
                      style={{
                        padding: "2px 6px",
                        fontSize: "10px",
                        border: "1px solid var(--border-color, #E6E4DF)",
                        borderRadius: "3px",
                        backgroundColor: "#FFFFFF",
                        cursor: "pointer",
                        color: copiedIp ? "#15803D" : "var(--text-secondary, #5B6270)",
                      }}
                    >
                      {copiedIp ? "Tersalin!" : "Salin"}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted, #8C93A0)" }}>Tipe Perangkat:</span>
                <span style={{ fontWeight: 600, textTransform: "capitalize", color: "var(--text-main, #1F2430)" }}>
                  {node.tipe}
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted, #8C93A0)" }}>Lokasi:</span>
                <span style={{ fontWeight: 500, color: "var(--text-main, #1F2430)" }}>
                  {node.lokasi || "-"}
                </span>
              </div>

              {node.catatan && (
                <div style={{ borderTop: "1px solid #EBE9E4", paddingTop: "6px" }}>
                  <span style={{ color: "var(--text-muted, #8C93A0)", display: "block", marginBottom: "2px" }}>
                    Catatan:
                  </span>
                  <p style={{ margin: 0, color: "var(--text-secondary, #5B6270)", lineHeight: 1.4 }}>
                    {node.catatan}
                  </p>
                </div>
              )}
            </div>

            {/* Bagian Kesehatan & Ping */}
            {!node.isVirtual && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
                  KESEHATAN & KONEKTIVITAS
                </span>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "10px",
                  }}
                >
                  {/* Ping Box */}
                  <div
                    style={{
                      padding: "10px 12px",
                      backgroundColor: "var(--bg-app, #FAFAF8)",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "6px",
                    }}
                  >
                    <span style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)", display: "block" }}>
                      STATUS PING
                    </span>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginTop: "4px" }}>
                      <span
                        style={{
                          fontSize: "14px",
                          fontWeight: 700,
                          color: node.ping?.isOk ? "#15803D" : node.ping?.isOk === false ? "var(--accent-red, #C8372D)" : "#64748B",
                        }}
                      >
                        {node.ping?.isOk ? "UP" : node.ping?.isOk === false ? "RTO" : "Non-aktif"}
                      </span>
                      {node.ping?.rttMs != null && (
                        <span style={{ fontSize: "11px", fontFamily: "var(--font-mono, monospace)", color: "var(--text-secondary, #5B6270)" }}>
                          ({node.ping.rttMs} ms)
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Uptime Box */}
                  <div
                    style={{
                      padding: "10px 12px",
                      backgroundColor: "var(--bg-app, #FAFAF8)",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "6px",
                    }}
                  >
                    <span style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)", display: "block" }}>
                      UPTIME (24 JAM / 7 HARI)
                    </span>
                    <div style={{ marginTop: "4px", fontSize: "13px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                      {node.uptime?.uptime24h !== null && node.uptime?.uptime24h !== undefined
                        ? `${node.uptime.uptime24h}%`
                        : "-"}{" "}
                      /{" "}
                      {node.uptime?.uptime7d !== null && node.uptime?.uptime7d !== undefined
                        ? `${node.uptime.uptime7d}%`
                        : "-"}
                    </div>
                  </div>
                </div>

                {/* Log Terakhir Diterima */}
                <div
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "var(--bg-app, #FAFAF8)",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderRadius: "6px",
                    fontSize: "11px",
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ color: "var(--text-muted, #8C93A0)" }}>Log Terakhir Diterima:</span>
                  <span style={{ fontWeight: 600, color: "var(--text-main, #1F2430)" }}>
                    {node.lastSeenAt
                      ? new Date(node.lastSeenAt).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          dateStyle: "short",
                          timeStyle: "medium",
                        }) + " WIB"
                      : "Belum pernah menerima log"}
                  </span>
                </div>
              </div>
            )}

            {/* Statistik Log 24 Jam */}
            {data?.logStats && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
                    AKTIVITAS LOG (24 JAM)
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)" }}>
                    Total: <strong>{data.logStats.total24h.toLocaleString("id-ID")}</strong> event
                  </span>
                </div>

                {/* Severity mini bar */}
                <div style={{ display: "flex", gap: "6px", fontSize: "11px" }}>
                  <span style={{ padding: "3px 6px", borderRadius: "3px", backgroundColor: "rgba(200, 55, 45, 0.1)", color: "var(--accent-red, #C8372D)", fontWeight: 600 }}>
                    Crit: {data.logStats.breakdown.critical}
                  </span>
                  <span style={{ padding: "3px 6px", borderRadius: "3px", backgroundColor: "rgba(230, 81, 0, 0.1)", color: "#E65100", fontWeight: 600 }}>
                    Err: {data.logStats.breakdown.error}
                  </span>
                  <span style={{ padding: "3px 6px", borderRadius: "3px", backgroundColor: "rgba(245, 127, 23, 0.1)", color: "#B45309", fontWeight: 600 }}>
                    Warn: {data.logStats.breakdown.warning}
                  </span>
                  <span style={{ padding: "3px 6px", borderRadius: "3px", backgroundColor: "rgba(31, 95, 191, 0.08)", color: "var(--accent-blue, #1F5FBF)", fontWeight: 600 }}>
                    Info: {data.logStats.breakdown.info}
                  </span>
                </div>

                {/* 5 Event Log Terbaru */}
                {data.logStats.recentEvents.length > 0 && (
                  <div
                    style={{
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "6px",
                      overflow: "hidden",
                    }}
                  >
                    {data.logStats.recentEvents.map((evt) => (
                      <div
                        key={evt.id}
                        style={{
                          padding: "8px 10px",
                          borderBottom: "1px solid var(--border-color, #E6E4DF)",
                          fontSize: "11px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted, #8C93A0)" }}>
                          <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                            {new Date(evt.eventTime).toLocaleTimeString("id-ID", {
                              timeZone: "Asia/Jakarta",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}{" "}
                            WIB
                          </span>
                          <span style={{ fontWeight: 600, textTransform: "uppercase" }}>
                            {evt.category}
                          </span>
                        </div>
                        <p style={{ margin: 0, color: "var(--text-main, #1F2430)", lineHeight: 1.3 }}>
                          {evt.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Insiden Keamanan Terbuka */}
            {data?.insidenTerbuka && data.insidenTerbuka.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent-red, #C8372D)", letterSpacing: "0.5px" }}>
                  INSIDEN TERBUKA ({data.insidenTerbuka.length})
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {data.insidenTerbuka.map((inc) => (
                    <Link
                      key={inc.id}
                      href="/insiden"
                      style={{
                        display: "block",
                        padding: "8px 10px",
                        backgroundColor: "rgba(200, 55, 45, 0.05)",
                        border: "1px solid rgba(200, 55, 45, 0.2)",
                        borderLeft: "3px solid var(--accent-red, #C8372D)",
                        borderRadius: "4px",
                        textDecoration: "none",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--accent-red, #C8372D)", fontWeight: 700 }}>
                        <span>{inc.severity.toUpperCase()}</span>
                        <span>{inc.count}x terdeteksi</span>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", display: "block", marginTop: "2px" }}>
                        {inc.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Analisa AI Terakhir */}
            {data?.analisaAi && (
              <div
                style={{
                  padding: "12px 14px",
                  backgroundColor: "rgba(106, 27, 154, 0.05)",
                  border: "1px solid rgba(106, 27, 154, 0.2)",
                  borderLeft: "3px solid #6A1B9A",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#6A1B9A" }}>
                    ANALISA AI ({data.analisaAi.riskLevel.toUpperCase()})
                  </span>
                  {currentUserRole === "admin" && (
                    <button
                      type="button"
                      onClick={handleTriggerAiAnalysis}
                      disabled={isAnalyzing}
                      style={{
                        padding: "2px 8px",
                        fontSize: "10px",
                        fontWeight: 600,
                        backgroundColor: "#6A1B9A",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: "3px",
                        cursor: "pointer",
                      }}
                    >
                      {isAnalyzing ? "Menganalisa..." : "Analisa Ulang"}
                    </button>
                  )}
                </div>
                {aiError && (
                  <div
                    style={{
                      margin: "4px 0 8px 0",
                      padding: "4px 8px",
                      backgroundColor: "rgba(200, 55, 45, 0.1)",
                      borderLeft: "3px solid var(--accent-red, #C8372D)",
                      fontSize: "11px",
                      color: "var(--accent-red, #C8372D)",
                      borderRadius: "2px",
                    }}
                  >
                    {aiError}
                  </div>
                )}
                <p style={{ margin: "0 0 6px 0", color: "var(--text-main, #1F2430)", lineHeight: 1.4 }}>
                  {data.analisaAi.summary}
                </p>
                {data.analisaAi.recommendations && data.analisaAi.recommendations.length > 0 && (
                  <ul style={{ margin: "4px 0 0 16px", padding: 0, color: "var(--text-secondary, #5B6270)" }}>
                    {data.analisaAi.recommendations.slice(0, 2).map((rec, idx) => (
                      <li key={idx} style={{ marginTop: "2px" }}>
                        {rec}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Hubungan Koneksi dengan Node Lain */}
            {data?.koneksi && data.koneksi.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
                  KONEKSI TERHUBUNG ({data.koneksi.length})
                </span>

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {data.koneksi.map((kon) => (
                    <div
                      key={kon.nodeId}
                      role="button"
                      tabIndex={0}
                      onClick={() => onSelectNode && onSelectNode(kon.nodeId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          if (onSelectNode) onSelectNode(kon.nodeId);
                        }
                      }}
                      title="Klik untuk menyorot node ini di peta"
                      style={{
                        padding: "8px 12px",
                        backgroundColor: "var(--bg-app, #FAFAF8)",
                        border: "1px solid var(--border-color, #E6E4DF)",
                        borderRadius: "4px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <DeviceTypeIcon type={kon.tipe} size={14} color="var(--accent-blue, #1F5FBF)" />
                        <div>
                          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-main, #1F2430)", display: "block" }}>
                            {kon.nama}
                          </span>
                          <span style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)" }}>
                            {kon.linkLabel || kon.linkType}
                          </span>
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: "3px",
                          backgroundColor: kon.status === "online" ? "#F0FDF4" : kon.status === "offline" ? "#FEF2F2" : "#FEFCE8",
                          color: kon.status === "online" ? "#15803D" : kon.status === "offline" ? "#B91C1C" : "#B45309",
                        }}
                      >
                        {kon.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Bagian Tombol Aksi Bersama */}
            {!node.isVirtual && node.deviceId && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  borderTop: "1px solid var(--border-color, #E6E4DF)",
                  paddingTop: "16px",
                  marginTop: "auto",
                }}
              >
                {pingResult && (
                  <span style={{ fontSize: "11px", fontWeight: 600, color: pingResult.startsWith("Sukses") ? "#15803D" : "var(--accent-red, #C8372D)" }}>
                    {pingResult}
                  </span>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={handlePingNow}
                    disabled={isPinging}
                    className="touch-target"
                    style={{
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "var(--bg-app, #FAFAF8)",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "4px",
                      color: "var(--text-main, #1F2430)",
                      cursor: "pointer",
                    }}
                  >
                    {isPinging ? "Menguji..." : "⚡ Tes Ping"}
                  </button>

                  <Link
                    href={`/perangkat/${node.deviceId}`}
                    className="touch-target"
                    style={{
                      padding: "8px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "var(--accent-blue, #1F5FBF)",
                      color: "#FFFFFF",
                      borderRadius: "4px",
                      textDecoration: "none",
                      textAlign: "center",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    Buka Halaman Perangkat →
                  </Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
