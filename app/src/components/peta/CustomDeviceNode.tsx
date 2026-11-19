import React, { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { DeviceTypeIcon } from "./DeviceTypeIcon";

export interface CustomDeviceNodeData {
  id: string;
  mapId: string;
  deviceId: string | null;
  isVirtual: boolean;
  tipeVirtual?: string | null;
  nama: string;
  tipe: string;
  ip: string | null;
  lokasi: string | null;
  status: "online" | "log_stopped" | "offline" | "unknown";
  pingStatus: "up" | "rto" | "disabled" | "unknown";
  rttMs: number | null;
  insidenTerbuka: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  terkunci?: boolean;
  isEditMode?: boolean;
  onSelectNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onToggleLock?: (nodeId: string) => void;
  [key: string]: unknown;
}

export const CustomDeviceNode = memo(function CustomDeviceNode({
  data,
  selected,
}: {
  data: CustomDeviceNodeData;
  selected?: boolean;
}) {
  const incidents = data.insidenTerbuka || { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  const hasCriticalOrHighIncident =
    (incidents.critical || 0) > 0 || (incidents.high || 0) > 0;

  const statusConfig = {
    online: {
      color: "#15803D",
      bg: "#F0FDF4",
      borderColor: "#86EFAC",
      glyph: "●",
      label: "Online",
    },
    log_stopped: {
      color: "#B45309",
      bg: "#FEFCE8",
      borderColor: "#FDE047",
      glyph: "◐",
      label: "Log berhenti",
    },
    offline: {
      color: "#B91C1C",
      bg: "#FEF2F2",
      borderColor: "#FCA5A5",
      glyph: "○",
      label: "Offline",
    },
    unknown: {
      color: "#64748B",
      bg: "#F1F5F9",
      borderColor: "#CBD5E1",
      glyph: "◌",
      label: "Belum ada data",
    },
  }[data.status] || {
    color: "#64748B",
    bg: "#F1F5F9",
    borderColor: "#CBD5E1",
    glyph: "◌",
    label: "Belum ada data",
  };

  const topBarColor = hasCriticalOrHighIncident
    ? "var(--accent-red, #C8372D)"
    : "var(--accent-blue, #1F5FBF)";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Node ${data.nama}, tipe ${data.tipe}, status ${statusConfig.label}${
        data.rttMs !== null ? `, latensi ${data.rttMs} milidetik` : ""
      }${
        incidents.total > 0
          ? `, memiliki ${incidents.total} insiden keamanan terbuka`
          : ""
      }`}
      onClick={() => {
        if (data.onSelectNode) data.onSelectNode(data.id);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (data.onSelectNode) data.onSelectNode(data.id);
        }
      }}
      style={{
        width: "185px",
        backgroundColor: "var(--bg-panel, #FFFFFF)",
        border: selected
          ? "2px solid var(--accent-blue, #1F5FBF)"
          : data.status === "offline"
          ? "1px solid #FCA5A5"
          : "1px solid var(--border-color, #E6E4DF)",
        borderRadius: "6px",
        boxShadow: selected
          ? "0 0 0 1px var(--accent-blue, #1F5FBF), 0 2px 6px rgba(0,0,0,0.06)"
          : "0 1px 3px rgba(0,0,0,0.04)",
        position: "relative",
        cursor: "pointer",
        userSelect: "none",
        outline: "none",
        transition: "box-shadow 0.15s ease, border-color 0.15s ease",
      }}
    >
      {/* Garis Aksen Atas Tipis (2px) */}
      <div
        style={{
          height: "3px",
          backgroundColor: topBarColor,
          borderTopLeftRadius: "5px",
          borderTopRightRadius: "5px",
          width: "100%",
        }}
      />

      {/* Handles React Flow untuk koneksi link (atas, bawah, kiri, kanan) */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "var(--accent-blue, #1F5FBF)",
          border: "1px solid #FFFFFF",
          opacity: data.isEditMode ? 0.9 : 0,
        }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "var(--accent-blue, #1F5FBF)",
          border: "1px solid #FFFFFF",
          opacity: data.isEditMode ? 0.9 : 0,
        }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "var(--accent-blue, #1F5FBF)",
          border: "1px solid #FFFFFF",
          opacity: data.isEditMode ? 0.9 : 0,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        style={{
          width: "7px",
          height: "7px",
          backgroundColor: "var(--accent-blue, #1F5FBF)",
          border: "1px solid #FFFFFF",
          opacity: data.isEditMode ? 0.9 : 0,
        }}
      />

      <div style={{ padding: "8px 10px" }}>
        {/* Header Node: Ikon Tipe + Nama + Badge Insiden */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flex: 1 }}>
            <span
              style={{
                color: hasCriticalOrHighIncident ? "var(--accent-red, #C8372D)" : "var(--accent-blue, #1F5FBF)",
                display: "inline-flex",
                alignItems: "center",
                flexShrink: 0,
              }}
            >
              <DeviceTypeIcon type={data.isVirtual ? (data.tipeVirtual || "cloud") : data.tipe} size={15} />
            </span>
            <span
              title={data.nama}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-main, #1F2430)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: "1.2",
              }}
            >
              {data.nama}
            </span>
          </div>

          {/* Lencana Insiden Terbuka */}
          {incidents.total > 0 && (
            <span
              title={`${incidents.total} Insiden Terbuka (${incidents.critical} Kritis)`}
              style={{
                fontSize: "9px",
                fontWeight: 700,
                backgroundColor: hasCriticalOrHighIncident ? "rgba(200, 55, 45, 0.12)" : "rgba(230, 81, 0, 0.12)",
                color: hasCriticalOrHighIncident ? "var(--accent-red, #C8372D)" : "#E65100",
                padding: "1px 4px",
                borderRadius: "3px",
                flexShrink: 0,
              }}
            >
              ! {incidents.total}
            </span>
          )}

          {/* Indikator Terkunci (Mode Edit) */}
          {data.terkunci && (
            <span
              title="Posisi node dikunci"
              style={{ fontSize: "10px", color: "var(--text-muted, #8C93A0)", flexShrink: 0 }}
            >
              🔒
            </span>
          )}
        </div>

        {/* IP Monospace */}
        <div
          style={{
            fontFamily: "var(--font-mono, monospace)",
            fontSize: "10px",
            color: "var(--text-muted, #8C93A0)",
            marginTop: "3px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {data.ip || (data.isVirtual ? "Virtual Gateway" : "Token-based (HTTP)")}
        </div>

        {/* Baris Status (Glyph + Teks) & RTT */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "6px",
            paddingTop: "4px",
            borderTop: "1px solid #F0EFEA",
            fontSize: "10px",
          }}
        >
          {/* Badge Status */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              padding: "1px 5px",
              borderRadius: "3px",
              backgroundColor: statusConfig.bg,
              color: statusConfig.color,
              fontWeight: 600,
              fontSize: "10px",
            }}
          >
            <span
              className={data.status === "offline" ? "subtle-pulse" : ""}
              style={{
                fontSize: "9px",
                lineHeight: 1,
              }}
            >
              {statusConfig.glyph}
            </span>
            <span>{statusConfig.label}</span>
          </span>

          {/* RTT Ping */}
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: "9.5px",
              color:
                data.rttMs !== null
                  ? data.rttMs > 100
                    ? "#B45309"
                    : "var(--text-secondary, #5B6270)"
                  : "var(--text-muted, #8C93A0)",
            }}
          >
            {data.rttMs !== null
              ? `${data.rttMs} ms`
              : data.pingStatus === "rto"
              ? "RTO"
              : "-"}
          </span>
        </div>
      </div>
    </div>
  );
});
