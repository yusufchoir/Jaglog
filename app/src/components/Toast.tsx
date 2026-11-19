"use client";

import React, { useEffect } from "react";

export interface ToastProps {
  message: string;
  type?: "success" | "error" | "info";
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = "success", onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const borderColor =
    type === "error"
      ? "var(--accent-red)"
      : type === "info"
      ? "var(--text-secondary)"
      : "var(--accent-blue)";

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        bottom: "24px",
        right: "24px",
        zIndex: 9999,
        backgroundColor: "#FFFFFF",
        border: "1px solid var(--border-color)",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: "var(--radius-sm)",
        boxShadow: "0 4px 14px rgba(31, 36, 48, 0.08)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        maxWidth: "400px",
        fontSize: "13px",
        color: "var(--text-main)",
        animation: "fadeIn 0.15s ease-out",
      }}
    >
      <div style={{ flex: 1, lineHeight: "1.4" }}>{message}</div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Tutup notifikasi"
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: "16px",
          padding: "0 4px",
          lineHeight: "1",
        }}
      >
        &times;
      </button>
    </div>
  );
}
