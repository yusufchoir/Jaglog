import React, { memo } from "react";
import { NodeResizer, Handle, Position } from "@xyflow/react";

export interface CustomGroupNodeData {
  id: string;
  nama: string;
  warnaGaris: "biru" | "merah" | "abu";
  lebar: number;
  tinggi: number;
  totalNodes: number;
  onlineNodes: number;
  openIncidentsCount?: number;
  isEditMode?: boolean;
  isCollapsed?: boolean;
  worstStatus?: "online" | "log_stopped" | "offline" | "unknown";
  onToggleCollapse?: (groupId: string) => void;
  onOpenGroupDetail?: (groupId: string) => void;
  [key: string]: unknown;
}

export const CustomGroupNode = memo(function CustomGroupNode({
  data,
  selected,
}: {
  data: CustomGroupNodeData;
  selected?: boolean;
}) {
  const borderColorMap = {
    biru: "rgba(31, 95, 191, 0.4)",
    merah: "rgba(200, 55, 45, 0.4)",
    abu: "rgba(148, 163, 184, 0.5)",
  };

  const badgeTextColorMap = {
    biru: "var(--accent-blue, #1F5FBF)",
    merah: "var(--accent-red, #C8372D)",
    abu: "var(--text-secondary, #5B6270)",
  };

  const statusConfig = {
    online: { color: "#15803D", glyph: "●", label: "Online" },
    log_stopped: { color: "#B45309", glyph: "◐", label: "Log berhenti" },
    offline: { color: "#B91C1C", glyph: "○", label: "Offline" },
    unknown: { color: "#64748B", glyph: "◌", label: "Belum ada data" },
  }[data.worstStatus || "unknown"] || {
    color: "#64748B",
    glyph: "◌",
    label: "Belum ada data",
  };

  const borderColor = borderColorMap[data.warnaGaris] || borderColorMap.biru;
  const badgeText = badgeTextColorMap[data.warnaGaris] || badgeTextColorMap.biru;

  // Tampilan 1: GRUP DILIPAT (COLLAPSED)
  // Menampilkan satu node gabungan ringkas dengan status terburuk, lencana jumlah, dan tombol Buka
  if (data.isCollapsed) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-label={`Grup ${data.nama}, terlipat, ${data.totalNodes} anggota, ${data.onlineNodes} online, status ${statusConfig.label}`}
        onClick={(e) => {
          e.stopPropagation();
          data.onOpenGroupDetail?.(data.id);
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          data.onToggleCollapse?.(data.id);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            data.onToggleCollapse?.(data.id);
          }
        }}
        style={{
          width: "240px",
          minHeight: "72px",
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: `1.5px solid ${borderColor}`,
          borderRadius: "6px",
          padding: "8px 12px",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)",
          position: "relative",
          boxSizing: "border-box",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          pointerEvents: "all",
          outline: "none",
        }}
      >
        <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
        <Handle type="target" position={Position.Top} id="top" style={{ opacity: 0 }} />
        <Handle type="source" position={Position.Bottom} id="bottom" style={{ opacity: 0 }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden", flex: 1 }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "2px",
                backgroundColor:
                  data.warnaGaris === "merah"
                    ? "#C8372D"
                    : data.warnaGaris === "abu"
                    ? "#5B6270"
                    : "#1F5FBF",
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--text-main, #1F2430)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={data.nama}
            >
              {data.nama}
            </span>
            {data.openIncidentsCount && data.openIncidentsCount > 0 ? (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  padding: "1px 5px",
                  borderRadius: "10px",
                  backgroundColor: "rgba(200, 55, 45, 0.1)",
                  color: "var(--accent-red, #C8372D)",
                  border: "1px solid rgba(200, 55, 45, 0.3)",
                  flexShrink: 0,
                }}
                title={`${data.openIncidentsCount} insiden terbuka`}
              >
                !{data.openIncidentsCount}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            className="nodrag"
            aria-expanded={false}
            aria-label={`Buka grup ${data.nama}`}
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleCollapse?.(data.id);
            }}
            title="Buka tampilan grup"
            style={{
              minHeight: "44px",
              minWidth: "52px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: "var(--bg-app, #FAFAF8)",
              border: "1px solid var(--border-color, #E6E4DF)",
              borderRadius: "4px",
              color: "var(--text-secondary, #5B6270)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "3px",
              flexShrink: 0,
            }}
          >
            <span>⌄</span>
            <span>Buka</span>
          </button>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", marginTop: "4px" }}>
          <span style={{ color: statusConfig.color, fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
            <span>{statusConfig.glyph}</span>
            <span>{statusConfig.label}</span>
          </span>
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "10px",
              backgroundColor: "rgba(91, 98, 112, 0.08)",
              color: "var(--text-secondary, #5B6270)",
            }}
          >
            {data.totalNodes} anggota - {data.onlineNodes} online
          </span>
        </div>
      </div>
    );
  }

  // Tampilan 2: GRUP TERBUKA (EXPANDED)
  // Menampilkan kotak area pembatas dengan garis putus-putus dan header label
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        minWidth: "200px",
        minHeight: "100px",
        border: `1.5px dashed ${borderColor}`,
        borderRadius: "8px",
        backgroundColor: "rgba(250, 250, 248, 0.6)",
        position: "relative",
        boxSizing: "border-box",
        pointerEvents: "none",
      }}
    >
      {/* Pengubah ukuran grup saat mode edit manual */}
      {data.isEditMode && (
        <NodeResizer
          minWidth={200}
          minHeight={100}
          isVisible={selected}
          lineClassName="border-blue-400"
          handleClassName="h-2.5 w-2.5 bg-blue-500 rounded"
        />
      )}

      {/* Area Judul di Pojok Kiri Atas (Tinggi >= 44px untuk touch target & label tidak menimpa node) */}
      <div
        style={{
          position: "absolute",
          top: "6px",
          left: "12px",
          height: "36px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          backgroundColor: "var(--bg-panel, #FFFFFF)",
          border: `1px solid ${borderColor}`,
          borderRadius: "4px",
          padding: "2px 8px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          pointerEvents: "all",
          zIndex: 2,
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            data.onOpenGroupDetail?.(data.id);
          }}
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: badgeText,
            letterSpacing: "-0.2px",
            cursor: "pointer",
          }}
          title="Klik untuk melihat ringkasan grup"
        >
          {data.nama}
        </span>
        <span
          style={{
            fontSize: "10px",
            color: "var(--text-muted, #8C93A0)",
            fontWeight: 500,
          }}
        >
          {data.onlineNodes} dari {data.totalNodes} online
        </span>

        {data.openIncidentsCount && data.openIncidentsCount > 0 ? (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 700,
              padding: "1px 5px",
              borderRadius: "10px",
              backgroundColor: "rgba(200, 55, 45, 0.1)",
              color: "var(--accent-red, #C8372D)",
              border: "1px solid rgba(200, 55, 45, 0.3)",
            }}
            title={`${data.openIncidentsCount} insiden terbuka`}
          >
            !{data.openIncidentsCount}
          </span>
        ) : null}

        {/* Tombol Lipat */}
        <button
          type="button"
          className="nodrag"
          aria-expanded={true}
          aria-label={`Lipat grup ${data.nama}`}
          onClick={(e) => {
            e.stopPropagation();
            data.onToggleCollapse?.(data.id);
          }}
          title="Lipat grup menjadi satu node"
          style={{
            minHeight: "44px",
            minWidth: "44px",
            padding: "4px 8px",
            fontSize: "10.5px",
            fontWeight: 600,
            backgroundColor: "transparent",
            border: "1px solid var(--border-color, #E6E4DF)",
            borderRadius: "3px",
            color: "var(--text-secondary, #5B6270)",
            cursor: "pointer",
            marginLeft: "2px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
          }}
        >
          <span>⌃</span>
          <span>Lipat</span>
        </button>
      </div>

      {/* Tampilan Grup Kosong (0 Perangkat) */}
      {data.totalNodes === 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-muted, #8C93A0)",
            fontSize: "11px",
            fontStyle: "italic",
            pointerEvents: "none",
            userSelect: "none",
            paddingTop: "24px",
          }}
        >
          Belum ada perangkat
        </div>
      )}
    </div>
  );
});
