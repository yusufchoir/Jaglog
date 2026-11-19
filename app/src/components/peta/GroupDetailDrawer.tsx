"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { DeviceTypeIcon } from "./DeviceTypeIcon";
import { RawNode, RawGroup } from "./NetworkTopologyCanvas";

interface GroupDetailDrawerProps {
  groupId: string | null;
  groups: RawGroup[];
  nodes: RawNode[];
  onClose: () => void;
  onSelectNode: (nodeId: string) => void;
}

export function GroupDetailDrawer({
  groupId,
  groups,
  nodes,
  onClose,
  onSelectNode,
}: GroupDetailDrawerProps) {
  const group = useMemo(() => {
    if (!groupId) return null;
    return groups.find((g) => g.id === groupId) || null;
  }, [groupId, groups]);

  const memberNodes = useMemo(() => {
    if (!groupId) return [];
    return nodes.filter((n) => n.groupId === groupId);
  }, [groupId, nodes]);

  if (!groupId || !group) return null;

  const onlineCount = memberNodes.filter((n) => n.status === "online").length;
  const logStoppedCount = memberNodes.filter((n) => n.status === "log_stopped").length;
  const offlineCount = memberNodes.filter((n) => n.status === "offline").length;
  const unknownCount = memberNodes.filter((n) => n.status === "unknown").length;
  const totalIncidents = memberNodes.reduce((acc, n) => acc + (n.insidenTerbuka?.total || 0), 0);

  const statusConfig = {
    online: { color: "#15803D", glyph: "●", label: "Online" },
    log_stopped: { color: "#B45309", glyph: "◐", label: "Log berhenti" },
    offline: { color: "#B91C1C", glyph: "○", label: "Offline" },
    unknown: { color: "#64748B", glyph: "◌", label: "Belum ada data" },
  };

  const groupBorderColor =
    group.warnaGaris === "merah"
      ? "#C8372D"
      : group.warnaGaris === "abu"
      ? "#5B6270"
      : "#1F5FBF";

  return (
    <aside
      className="mobile-full-sheet"
      role="region"
      aria-label={`Detail Area ${group.nama}`}
      style={{
        width: "380px",
        height: "100%",
        backgroundColor: "var(--bg-panel, #FFFFFF)",
        borderLeft: "1px solid var(--border-color, #E6E4DF)",
        boxShadow: "-4px 0 16px rgba(0, 0, 0, 0.05)",
        zIndex: 50,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        position: "absolute",
        top: 0,
        right: 0,
      }}
    >
      {/* Header Drawer */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border-color, #E6E4DF)",
          borderTop: `3px solid ${groupBorderColor}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          backgroundColor: "#FFFFFF",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: groupBorderColor,
            }}
          >
            Area Jaringan / Grup
          </span>
          <h3
            style={{
              fontSize: "16px",
              fontWeight: 700,
              color: "var(--text-main, #1F2430)",
              margin: "2px 0 0 0",
            }}
          >
            {group.nama}
          </h3>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="touch-target"
          style={{
            border: "none",
            backgroundColor: "transparent",
            fontSize: "16px",
            color: "var(--text-secondary, #5B6270)",
            cursor: "pointer",
            padding: "4px 8px",
            borderRadius: "4px",
          }}
          title="Tutup detail area"
        >
          ✕
        </button>
      </div>

      {/* Konten Drawer */}
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px", flex: 1 }}>
        {/* Ringkasan Status Anggota */}
        <div
          style={{
            padding: "12px",
            backgroundColor: "var(--bg-app, #FAFAF8)",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "6px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
              Ringkasan Anggota
            </span>
            <span style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--text-secondary, #5B6270)" }}>
              {memberNodes.length} perangkat
            </span>
          </div>

          {/* Bar proporsi status */}
          <div
            style={{
              height: "6px",
              borderRadius: "3px",
              backgroundColor: "#E6E4DF",
              overflow: "hidden",
              display: "flex",
              marginBottom: "10px",
            }}
          >
            {memberNodes.length > 0 && (
              <>
                <div style={{ width: `${(onlineCount / memberNodes.length) * 100}%`, backgroundColor: "#15803D" }} />
                <div style={{ width: `${(logStoppedCount / memberNodes.length) * 100}%`, backgroundColor: "#B45309" }} />
                <div style={{ width: `${(offlineCount / memberNodes.length) * 100}%`, backgroundColor: "#B91C1C" }} />
                <div style={{ width: `${(unknownCount / memberNodes.length) * 100}%`, backgroundColor: "#64748B" }} />
              </>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "11px" }}>
            <span style={{ color: "#15803D", fontWeight: 600 }}>● {onlineCount} Online</span>
            <span style={{ color: "#B45309", fontWeight: 600 }}>◐ {logStoppedCount} Log berhenti</span>
            <span style={{ color: "#B91C1C", fontWeight: 600 }}>○ {offlineCount} Offline</span>
            <span style={{ color: "#64748B", fontWeight: 600 }}>◌ {unknownCount} Belum ada data</span>
          </div>

          {totalIncidents > 0 && (
            <div
              style={{
                marginTop: "10px",
                padding: "6px 10px",
                borderRadius: "4px",
                backgroundColor: "rgba(200, 55, 45, 0.08)",
                borderLeft: "3px solid #C8372D",
                fontSize: "11px",
                fontWeight: 600,
                color: "#C8372D",
              }}
            >
              ⚠ {totalIncidents} insiden keamanan terbuka di area ini
            </div>
          )}
        </div>

        {/* Daftar Anggota Perangkat di Area */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
              Daftar Perangkat ({memberNodes.length})
            </span>
          </div>

          {memberNodes.length === 0 ? (
            <div
              style={{
                padding: "16px",
                textAlign: "center",
                fontSize: "12px",
                color: "var(--text-secondary, #5B6270)",
                backgroundColor: "var(--bg-app, #FAFAF8)",
                borderRadius: "4px",
                border: "1px dashed var(--border-color, #E6E4DF)",
              }}
            >
              Belum ada perangkat di area ini. Tarik perangkat ke dalam kotak area saat mode ubah tata letak.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {memberNodes.map((n) => {
                const st = statusConfig[n.status] || statusConfig.unknown;
                return (
                  <div
                    key={n.id}
                    onClick={() => onSelectNode(n.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      backgroundColor: "#FFFFFF",
                      border: "1px solid var(--border-color, #E6E4DF)",
                      borderRadius: "4px",
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--bg-app, #FAFAF8)")}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "#FFFFFF")}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                      <DeviceTypeIcon type={n.tipe} size={16} />
                      <div style={{ overflow: "hidden" }}>
                        <div
                          style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            color: "var(--text-main, #1F2430)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={n.nama}
                        >
                          {n.nama}
                        </div>
                        {n.ip && (
                          <div
                            style={{
                              fontSize: "10.5px",
                              fontFamily: "monospace",
                              color: "var(--text-secondary, #5B6270)",
                            }}
                          >
                            {n.ip}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          color: st.color,
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        <span>{st.glyph}</span>
                        <span className="desktop-only">{st.label}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tombol Menuju Halaman Grup Lengkap */}
        <div style={{ marginTop: "auto", paddingTop: "16px", borderTop: "1px solid var(--border-color, #E6E4DF)" }}>
          <Link
            href="/grup"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "9px 12px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: "var(--accent-blue, #1F5FBF)",
              color: "#FFFFFF",
              borderRadius: "4px",
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            Kelola Grup & Penetapan Perangkat →
          </Link>
        </div>
      </div>
    </aside>
  );
}
