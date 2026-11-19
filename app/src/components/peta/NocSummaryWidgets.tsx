"use client";

import React, { useState } from "react";
import Link from "next/link";
import { DeviceTypeIcon } from "./DeviceTypeIcon";

export interface NocRingkasanData {
  totalNodes: number;
  onlineCount: number;
  logStoppedCount: number;
  offlineCount: number;
  unknownCount: number;
  insiden: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  perJenis: Array<{
    tipe: string;
    count: number;
    online: number;
    problematic: number;
    openIncidents: number;
  }>;
  heatmap: Array<{
    id: string;
    nama: string;
    tipe: string;
    ip: string | null;
    status: "online" | "log_stopped" | "offline" | "unknown";
    pingStatus: string;
    rttMs: number | null;
    insidenTerbuka: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      total: number;
    };
    groupId?: string | null;
  }>;
  alarmTerbaru: Array<{
    id: string;
    deviceId: string;
    deviceName: string | null;
    deviceType: string | null;
    severity: string;
    title: string;
    status: string;
    lastSeen: string;
  }>;
}

export function NocSummaryWidgets({
  ringkasan,
  onSelectNode,
  onFilterStatus,
  onFilterType,
  filterGroupId = null,
  showMiniMapLink = true,
}: {
  ringkasan: NocRingkasanData;
  onSelectNode?: (nodeId: string) => void;
  onFilterStatus?: (status: string | null) => void;
  onFilterType?: (type: string | null) => void;
  filterGroupId?: string | null;
  showMiniMapLink?: boolean;
}) {
  const [hoveredNode, setHoveredNode] = useState<NocRingkasanData["heatmap"][0] | null>(null);

  const {
    totalNodes = 0,
    onlineCount = 0,
    logStoppedCount = 0,
    offlineCount = 0,
    unknownCount = 0,
    insiden = { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
    perJenis = [],
    heatmap = [],
    alarmTerbaru = [],
  } = ringkasan;

  const displayedHeatmap = React.useMemo(() => {
    if (!filterGroupId) return heatmap;
    return heatmap.filter((n) => n.groupId === filterGroupId);
  }, [heatmap, filterGroupId]);

  // Donut SVG Parameters
  const radius = 38;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;

  // Hitung stroke-dasharray untuk Donut Status
  const safeTotal = Math.max(totalNodes, 1);
  const pOnline = (onlineCount / safeTotal) * circumference;
  const pLogStopped = (logStoppedCount / safeTotal) * circumference;
  const pOffline = (offlineCount / safeTotal) * circumference;
  const pUnknown = (unknownCount / safeTotal) * circumference;

  // Hitung stroke-dasharray untuk Donut Alarm Severity
  const safeIncTotal = Math.max(insiden.total, 1);
  const pCrit = (insiden.critical / safeIncTotal) * circumference;
  const pHigh = (insiden.high / safeIncTotal) * circumference;
  const pMed = (insiden.medium / safeIncTotal) * circumference;
  const pLow = (insiden.low / safeIncTotal) * circumference;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Header Bar NOC & Pratinjau Link */}
      {showMiniMapLink && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            padding: "14px 18px",
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderLeft: "3px solid var(--accent-blue, #1F5FBF)",
            borderRadius: "6px",
          }}
        >
          <div>
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main, #1F2430)", margin: 0 }}>
              Pusat Pemantauan Operasi Jaringan (NOC Overview)
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary, #5B6270)", margin: "2px 0 0 0" }}>
              Visualisasi topologi perangkat aktif, distribusi alarm, dan heatmap kesehatan sistem.
            </p>
          </div>
          <Link
            href="/peta"
            className="touch-target"
            style={{
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: "var(--accent-blue, #1F5FBF)",
              color: "#FFFFFF",
              borderRadius: "4px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            Buka Peta Jaringan Penuh →
          </Link>
        </div>
      )}

      {/* 2. Grid 4 Widget NOC: Donut Status, Donut Alarm, Heatmap, Ringkasan Jenis */}
      <div
        className="grid-2-mobile"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "16px",
        }}
      >
        {/* Widget A: Donut Status Perangkat */}
        <div
          style={{
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
            DISTRIBUSI STATUS PERANGKAT
          </span>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: "12px", gap: "12px" }}>
            {/* SVG Donut */}
            <div style={{ position: "relative", width: "96px", height: "96px", flexShrink: 0 }}>
              <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: "rotate(-90deg)" }}>
                {/* Background Ring */}
                <circle cx="48" cy="48" r={radius} stroke="#F0EFEA" strokeWidth={strokeWidth} fill="transparent" />
                {totalNodes > 0 && (
                  <>
                    {/* Online Segment */}
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#22C55E"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pOnline} ${circumference}`}
                      strokeDashoffset={0}
                    />
                    {/* Log Berhenti Segment */}
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#EAB308"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pLogStopped} ${circumference}`}
                      strokeDashoffset={-pOnline}
                    />
                    {/* Offline Segment */}
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#EF4444"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pOffline} ${circumference}`}
                      strokeDashoffset={-(pOnline + pLogStopped)}
                    />
                    {/* Unknown Segment */}
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#94A3B8"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pUnknown} ${circumference}`}
                      strokeDashoffset={-(pOnline + pLogStopped + pOffline)}
                    />
                  </>
                )}
              </svg>

              {/* Total di Tengah */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                  {totalNodes}
                </span>
                <span style={{ fontSize: "9px", color: "var(--text-muted, #8C93A0)", textTransform: "uppercase" }}>
                  Node
                </span>
              </div>
            </div>

            {/* Legenda Interaktif */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
              <button
                type="button"
                onClick={() => onFilterStatus && onFilterStatus("online")}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  color: "var(--text-main, #1F2430)",
                }}
              >
                <span style={{ color: "#15803D", fontWeight: 700 }}>●</span>
                <span>Online: <strong>{onlineCount}</strong></span>
              </button>

              <button
                type="button"
                onClick={() => onFilterStatus && onFilterStatus("log_stopped")}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  color: "var(--text-main, #1F2430)",
                }}
              >
                <span style={{ color: "#B45309", fontWeight: 700 }}>◐</span>
                <span>Log Berhenti: <strong>{logStoppedCount}</strong></span>
              </button>

              <button
                type="button"
                onClick={() => onFilterStatus && onFilterStatus("offline")}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  color: "var(--text-main, #1F2430)",
                }}
              >
                <span style={{ color: "#B91C1C", fontWeight: 700 }}>○</span>
                <span>Offline: <strong>{offlineCount}</strong></span>
              </button>

              <button
                type="button"
                onClick={() => onFilterStatus && onFilterStatus("unknown")}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  color: "var(--text-main, #1F2430)",
                }}
              >
                <span style={{ color: "#64748B", fontWeight: 700 }}>◌</span>
                <span>Belum Ada Data: <strong>{unknownCount}</strong></span>
              </button>
            </div>
          </div>
        </div>

        {/* Widget B: Donut Alarm Insiden Terbuka */}
        <div
          style={{
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
              ALARM KEAMANAN TERBUKA
            </span>
            <Link href="/insiden" style={{ fontSize: "11px", color: "var(--accent-blue, #1F5FBF)", fontWeight: 600 }}>
              Semua →
            </Link>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", marginTop: "12px", gap: "12px" }}>
            {/* SVG Donut Alarm */}
            <div style={{ position: "relative", width: "96px", height: "96px", flexShrink: 0 }}>
              <svg width="96" height="96" viewBox="0 0 96 96" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="48" cy="48" r={radius} stroke="#F0EFEA" strokeWidth={strokeWidth} fill="transparent" />
                {insiden.total > 0 && (
                  <>
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#C8372D"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pCrit} ${circumference}`}
                      strokeDashoffset={0}
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#E65100"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pHigh} ${circumference}`}
                      strokeDashoffset={-pCrit}
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#F57F17"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pMed} ${circumference}`}
                      strokeDashoffset={-(pCrit + pHigh)}
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      stroke="#0288D1"
                      strokeWidth={strokeWidth}
                      fill="transparent"
                      strokeDasharray={`${pLow} ${circumference}`}
                      strokeDashoffset={-(pCrit + pHigh + pMed)}
                    />
                  </>
                )}
              </svg>

              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    color: insiden.total > 0 ? "var(--accent-red, #C8372D)" : "var(--text-main, #1F2430)",
                  }}
                >
                  {insiden.total}
                </span>
                <span style={{ fontSize: "9px", color: "var(--text-muted, #8C93A0)", textTransform: "uppercase" }}>
                  Alarm
                </span>
              </div>
            </div>

            {/* Legenda Alarm */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "11px" }}>
              <span style={{ color: "var(--accent-red, #C8372D)", fontWeight: 600 }}>
                ● Kritis: {insiden.critical}
              </span>
              <span style={{ color: "#E65100", fontWeight: 600 }}>
                ● Tinggi: {insiden.high}
              </span>
              <span style={{ color: "#826B00", fontWeight: 600 }}>
                ● Sedang: {insiden.medium}
              </span>
              <span style={{ color: "var(--accent-blue, #1F5FBF)", fontWeight: 600 }}>
                ● Rendah: {insiden.low}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Heatmap Status Perangkat (Mendukung hingga 300 node) */}
      <div
        style={{
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          padding: "16px 18px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
          <div>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
              HEATMAP KESEHATAN PERANGKAT (KONDISI BERMASALAH DI DEPAN)
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary, #5B6270)", display: "block", marginTop: "2px" }}>
              Klik kotak untuk membuka rincian node secara langsung.
            </span>
          </div>

          {/* Tooltip Keterangan Blok yang Sedang Diarahkan / Disentuh */}
          {hoveredNode && (
            <div
              style={{
                fontSize: "11px",
                padding: "2px 8px",
                borderRadius: "3px",
                backgroundColor: "var(--text-main, #1F2430)",
                color: "#FFFFFF",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>{hoveredNode.nama}</span>
              <span style={{ color: "#CBD5E1" }}>({hoveredNode.ip || "Token"})</span>
              <span style={{ textTransform: "capitalize" }}>• {hoveredNode.status}</span>
              {hoveredNode.rttMs !== null && <span>• {hoveredNode.rttMs} ms</span>}
            </div>
          )}
        </div>

        {/* Kotak-kotak Heatmap */}
        {displayedHeatmap.length === 0 ? (
          <p style={{ fontSize: "12px", color: "var(--text-muted, #8C93A0)", margin: 0 }}>
            {filterGroupId ? "Tidak ada perangkat dalam area terpilih." : "Belum ada perangkat yang terdaftar di peta."}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(28px, 1fr))",
              gap: "6px",
            }}
          >
            {displayedHeatmap.map((node) => {
              const hasAlert = node.insidenTerbuka.critical > 0 || node.insidenTerbuka.high > 0;
              const bg =
                node.status === "online"
                  ? "#22C55E"
                  : node.status === "log_stopped"
                  ? "#EAB308"
                  : node.status === "offline"
                  ? "#EF4444"
                  : "#94A3B8";

              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => onSelectNode && onSelectNode(node.id)}
                  onMouseEnter={() => setHoveredNode(node)}
                  onMouseLeave={() => setHoveredNode(null)}
                  onTouchStart={() => setHoveredNode(node)}
                  aria-label={`${node.nama}, ${node.status}${hasAlert ? ", ada insiden" : ""}`}
                  style={{
                    height: "28px",
                    width: "100%",
                    backgroundColor: bg,
                    border: hasAlert ? "2px solid #991B1B" : "1px solid rgba(0, 0, 0, 0.08)",
                    borderRadius: "4px",
                    cursor: "pointer",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    transition: "transform 0.1s ease",
                  }}
                >
                  {hasAlert && (
                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#FFFFFF" }}>!</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Tabel Ringkasan per Jenis Perangkat */}
      {perJenis.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "16px 18px",
          }}
        >
          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
            RINGKASAN PER JENIS PERANGKAT
          </span>

          <div style={{ overflowX: "auto", marginTop: "10px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-color, #E6E4DF)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px", color: "var(--text-muted, #8C93A0)", fontWeight: 600 }}>JENIS</th>
                  <th style={{ padding: "6px 8px", color: "var(--text-muted, #8C93A0)", fontWeight: 600 }}>TOTAL</th>
                  <th style={{ padding: "6px 8px", color: "var(--text-muted, #8C93A0)", fontWeight: 600 }}>ONLINE</th>
                  <th style={{ padding: "6px 8px", color: "var(--text-muted, #8C93A0)", fontWeight: 600 }}>BERMASALAH</th>
                  <th style={{ padding: "6px 8px", color: "var(--text-muted, #8C93A0)", fontWeight: 600 }}>INSIDEN</th>
                </tr>
              </thead>
              <tbody>
                {perJenis.map((row) => (
                  <tr
                    key={row.tipe}
                    onClick={() => onFilterType && onFilterType(row.tipe)}
                    title={`Klik untuk memfilter peta ke tipe ${row.tipe}`}
                    style={{
                      borderBottom: "1px solid #F0EFEA",
                      cursor: "pointer",
                      transition: "background-color 0.1s ease",
                    }}
                  >
                    <td style={{ padding: "8px", fontWeight: 600, color: "var(--text-main, #1F2430)", textTransform: "capitalize" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <DeviceTypeIcon type={row.tipe} size={14} color="var(--accent-blue, #1F5FBF)" />
                        <span>{row.tipe}</span>
                      </div>
                    </td>
                    <td style={{ padding: "8px", color: "var(--text-main, #1F2430)" }}>{row.count}</td>
                    <td style={{ padding: "8px", color: "#15803D", fontWeight: 600 }}>{row.online}</td>
                    <td style={{ padding: "8px", color: row.problematic > 0 ? "var(--accent-red, #C8372D)" : "var(--text-secondary, #5B6270)", fontWeight: row.problematic > 0 ? 600 : 400 }}>
                      {row.problematic}
                    </td>
                    <td style={{ padding: "8px", color: row.openIncidents > 0 ? "var(--accent-red, #C8372D)" : "#64748B", fontWeight: row.openIncidents > 0 ? 700 : 400 }}>
                      {row.openIncidents}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Daftar 5 Alarm / Insiden Terbaru */}
      {alarmTerbaru.length > 0 && (
        <div
          style={{
            backgroundColor: "var(--bg-panel, #FFFFFF)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
            padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-muted, #8C93A0)", letterSpacing: "0.5px" }}>
              5 ALARM INSIDEN TERAKHIR
            </span>
            <Link href="/insiden" style={{ fontSize: "11px", color: "var(--accent-blue, #1F5FBF)", fontWeight: 600 }}>
              Buka Semua Insiden →
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {alarmTerbaru.map((al) => {
              const isCrit = al.severity === "critical";
              const isHigh = al.severity === "high";

              return (
                <Link
                  key={al.id}
                  href="/insiden"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    backgroundColor: "var(--bg-app, #FAFAF8)",
                    border: "1px solid var(--border-color, #E6E4DF)",
                    borderLeft: isCrit
                      ? "3px solid var(--accent-red, #C8372D)"
                      : isHigh
                      ? "3px solid #E65100"
                      : "3px solid transparent",
                    borderRadius: "4px",
                    textDecoration: "none",
                    gap: "8px",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          backgroundColor: isCrit ? "rgba(200, 55, 45, 0.1)" : "rgba(230, 81, 0, 0.1)",
                          color: isCrit ? "var(--accent-red, #C8372D)" : "#E65100",
                        }}
                      >
                        {al.severity}
                      </span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted, #8C93A0)" }}>
                        {al.deviceName || "Perangkat"}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--text-main, #1F2430)",
                        display: "block",
                        marginTop: "2px",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {al.title}
                    </span>
                  </div>

                  <span style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)", flexShrink: 0 }}>
                    {new Date(al.lastSeen).toLocaleTimeString("id-ID", {
                      timeZone: "Asia/Jakarta",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    WIB
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
