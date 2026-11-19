"use client";

import React, { useMemo } from "react";
import { DeviceTypeIcon } from "./DeviceTypeIcon";

interface TopologyNodeItem {
  id: string;
  mapId: string;
  deviceId: string | null;
  isVirtual: boolean;
  nama: string;
  tipe: string;
  ip: string | null;
  lokasi: string | null;
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
}

export function TopologyListView({
  nodes,
  onSelectNode,
  searchQuery = "",
  filterStatus = null,
  filterType = null,
}: {
  nodes: TopologyNodeItem[];
  onSelectNode: (nodeId: string) => void;
  searchQuery?: string;
  filterStatus?: string | null;
  filterType?: string | null;
}) {
  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchName = n.nama.toLowerCase().includes(q);
        const matchIp = n.ip ? n.ip.toLowerCase().includes(q) : false;
        const matchLoc = n.lokasi ? n.lokasi.toLowerCase().includes(q) : false;
        if (!matchName && !matchIp && !matchLoc) return false;
      }
      if (filterStatus && n.status !== filterStatus) return false;
      if (filterType && n.tipe.toLowerCase() !== filterType.toLowerCase()) return false;
      return true;
    });
  }, [nodes, searchQuery, filterStatus, filterType]);

  // Kelompokkan berdasarkan lokasi
  const groupedByLocation = useMemo(() => {
    const map = new Map<string, TopologyNodeItem[]>();
    for (const node of filteredNodes) {
      const locKey = node.lokasi ? node.lokasi.trim() : "Tanpa Lokasi / Virtual";
      const arr = map.get(locKey) || [];
      arr.push(node);
      map.set(locKey, arr);
    }
    return Array.from(map.entries());
  }, [filteredNodes]);

  const getStatusBadge = (status: string) => {
    const config = {
      online: { color: "#15803D", bg: "#F0FDF4", glyph: "●", label: "Online" },
      log_stopped: { color: "#B45309", bg: "#FEFCE8", glyph: "◐", label: "Log berhenti" },
      offline: { color: "#B91C1C", bg: "#FEF2F2", glyph: "○", label: "Offline" },
      unknown: { color: "#64748B", bg: "#F1F5F9", glyph: "◌", label: "Belum ada data" },
    }[status] || { color: "#64748B", bg: "#F1F5F9", glyph: "◌", label: "Belum ada data" };

    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          padding: "2px 6px",
          borderRadius: "3px",
          fontSize: "10px",
          fontWeight: 600,
          backgroundColor: config.bg,
          color: config.color,
        }}
      >
        <span>{config.glyph}</span>
        <span>{config.label}</span>
      </span>
    );
  };

  if (filteredNodes.length === 0) {
    return (
      <div
        style={{
          padding: "48px 24px",
          textAlign: "center",
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: "1px solid var(--border-color, #E6E4DF)",
          borderRadius: "6px",
          color: "var(--text-muted, #8C93A0)",
          fontSize: "13px",
        }}
      >
        Tidak ada perangkat yang cocok dengan kriteria filter atau pencarian.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {groupedByLocation.map(([lokasi, items]) => {
        const onlineCount = items.filter((i) => i.status === "online").length;

        return (
          <div
            key={lokasi}
            style={{
              backgroundColor: "var(--bg-panel, #FFFFFF)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "6px",
              overflow: "hidden",
            }}
          >
            {/* Header Grup Lokasi */}
            <div
              style={{
                padding: "10px 14px",
                backgroundColor: "var(--bg-app, #FAFAF8)",
                borderBottom: "1px solid var(--border-color, #E6E4DF)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main, #1F2430)" }}>
                📍 {lokasi}
              </span>
              <span style={{ fontSize: "11px", color: "var(--text-muted, #8C93A0)" }}>
                {onlineCount} dari {items.length} online
              </span>
            </div>

            {/* Daftar Perangkat */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              {items.map((node) => {
                const hasAlert = node.insidenTerbuka.critical > 0 || node.insidenTerbuka.high > 0;

                return (
                  <div
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectNode(node.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectNode(node.id);
                      }
                    }}
                    style={{
                      padding: "12px 14px",
                      borderBottom: "1px solid #F0EFEA",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "10px",
                      cursor: "pointer",
                      transition: "background-color 0.1s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: 1 }}>
                      <span style={{ color: "var(--accent-blue, #1F5FBF)", flexShrink: 0 }}>
                        <DeviceTypeIcon type={node.tipe} size={16} />
                      </span>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span
                            style={{
                              fontSize: "13px",
                              fontWeight: 600,
                              color: "var(--text-main, #1F2430)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {node.nama}
                          </span>
                          {hasAlert && (
                            <span
                              style={{
                                fontSize: "9px",
                                fontWeight: 700,
                                backgroundColor: "rgba(200, 55, 45, 0.12)",
                                color: "var(--accent-red, #C8372D)",
                                padding: "1px 4px",
                                borderRadius: "3px",
                              }}
                            >
                              ! {node.insidenTerbuka.total}
                            </span>
                          )}
                        </div>

                        <span
                          style={{
                            fontFamily: "var(--font-mono, monospace)",
                            fontSize: "11px",
                            color: "var(--text-muted, #8C93A0)",
                            display: "block",
                            marginTop: "1px",
                          }}
                        >
                          {node.ip || "Token-based"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                      {node.rttMs !== null && (
                        <span style={{ fontFamily: "var(--font-mono, monospace)", fontSize: "11px", color: "var(--text-secondary, #5B6270)" }}>
                          {node.rttMs} ms
                        </span>
                      )}
                      {getStatusBadge(node.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
