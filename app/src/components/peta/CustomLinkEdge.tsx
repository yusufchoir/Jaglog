import React, { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  EdgeProps,
} from "@xyflow/react";

export interface CustomLinkEdgeData {
  id: string;
  label?: string | null;
  tipe: "kabel" | "wireless" | "vpn" | "lainnya";
  sourceStatus?: string;
  targetStatus?: string;
  onDeleteLink?: (linkId: string) => void;
  isEditMode?: boolean;
}

export const CustomLinkEdge = memo(function CustomLinkEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data,
  } = props;
  const edgeData = (props.data as unknown as CustomLinkEdgeData) || undefined;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
  });

  const sourceStatus = edgeData?.sourceStatus || "online";
  const targetStatus = edgeData?.targetStatus || "online";

  // Tentukan warna garis mengikuti status ujung terburuk:
  // 1. Offline di salah satu ujung -> Garis Merah
  // 2. Unknown di salah satu ujung -> Putus-putus Abu
  // 3. Log Berhenti di salah satu ujung -> Kuning/Krem
  // 4. Normal -> Biru Muda / Slate
  let strokeColor = "#94A3B8"; // default slate
  let strokeDasharray = undefined;

  if (sourceStatus === "offline" || targetStatus === "offline") {
    strokeColor = "var(--accent-red, #C8372D)";
  } else if (sourceStatus === "unknown" || targetStatus === "unknown") {
    strokeColor = "#94A3B8";
    strokeDasharray = "4 4";
  } else if (sourceStatus === "log_stopped" || targetStatus === "log_stopped") {
    strokeColor = "#D97706";
  } else {
    // Normal: jika wireless atau vpn beri gaya garis spesifik
    if (edgeData?.tipe === "wireless") {
      strokeColor = "var(--accent-blue, #1F5FBF)";
      strokeDasharray = "5 3";
    } else if (edgeData?.tipe === "vpn") {
      strokeColor = "#6366F1";
      strokeDasharray = "6 3";
    } else {
      strokeColor = "var(--accent-blue, #1F5FBF)";
    }
  }

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: 1.5,
          strokeDasharray,
        }}
      />

      {/* Label Keterangan di Tengah Garis */}
      {(edgeData?.label || edgeData?.isEditMode) && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              zIndex: 10,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: "var(--bg-panel, #FFFFFF)",
                border: "1px solid var(--border-color, #E6E4DF)",
                borderRadius: "3px",
                padding: "1px 6px",
                fontSize: "10px",
                fontFamily: "var(--font-mono, monospace)",
                color: "var(--text-secondary, #5B6270)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
              }}
            >
              {edgeData?.label && <span>{edgeData.label}</span>}

              {edgeData?.isEditMode && edgeData?.onDeleteLink && (
                <button
                  type="button"
                  title="Hapus hubungan link"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (edgeData?.id) {
                      edgeData.onDeleteLink?.(edgeData.id);
                    }
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "var(--accent-red, #C8372D)",
                    cursor: "pointer",
                    padding: "0 2px",
                    fontWeight: 700,
                    fontSize: "11px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
