"use client";

import React from "react";

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  isDanger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = "Konfirmasi",
  cancelLabel = "Batal",
  isDanger = false,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(31, 36, 48, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: "100%",
          maxWidth: "460px",
          backgroundColor: "var(--bg-panel)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          padding: "24px",
          boxShadow: "0 10px 25px rgba(31, 36, 48, 0.12)",
        }}
      >
        <div
          style={{
            height: "2px",
            backgroundColor: isDanger ? "var(--accent-red)" : "var(--accent-blue)",
            margin: "-24px -24px 20px -24px",
            borderRadius: "var(--radius-md) var(--radius-md) 0 0",
          }}
        />

        <h3
          style={{
            fontSize: "15px",
            fontWeight: 700,
            color: "var(--text-main)",
            marginBottom: "10px",
          }}
        >
          {title}
        </h3>

        <div
          style={{
            fontSize: "13px",
            color: "var(--text-secondary)",
            lineHeight: "1.5",
            marginBottom: "24px",
          }}
        >
          {message}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCancel}
            style={{
              padding: "7px 14px",
              fontSize: "12px",
              fontWeight: 500,
              backgroundColor: "transparent",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-secondary)",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            style={{
              padding: "7px 16px",
              fontSize: "12px",
              fontWeight: 600,
              backgroundColor: isDanger ? "var(--accent-red)" : "var(--accent-blue)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              color: "#FFFFFF",
              cursor: isLoading ? "not-allowed" : "pointer",
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? "Memproses..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
