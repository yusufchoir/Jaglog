"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";
import { reportClientError, handleChunkLoadRecovery } from "@/lib/client-logger";

interface Props {
  sectionName: string;
  children: ReactNode;
  fallbackAction?: ReactNode;
  onReset?: () => void;
  compact?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorRefId: string | null;
  retryCount: number;
}

export class SectionErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorRefId: null,
    retryCount: 0,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    return {
      hasError: true,
      error,
      errorRefId: `RND-${Date.now().toString(36).toUpperCase()}-${randomSuffix}`,
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // 1. Cek ChunkLoadError recovery
    if (handleChunkLoadRecovery(error)) {
      return;
    }

    // 2. Laporkan ke server
    reportClientError(error, {
      komponen: this.props.sectionName,
      path: typeof window !== "undefined" ? window.location.pathname : "/",
    });

    console.error(`[SectionErrorBoundary:${this.props.sectionName}] caught an error:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState((prev) => ({
      hasError: false,
      error: null,
      retryCount: prev.retryCount + 1,
    }));

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      const { sectionName, compact, fallbackAction } = this.props;

      if (compact) {
        return (
          <div
            style={{
              padding: "12px 16px",
              backgroundColor: "var(--bg-panel, #FFFFFF)",
              border: "1px solid var(--accent-red, #C8372D)",
              borderRadius: "6px",
              fontSize: "12px",
              color: "var(--text-secondary, #5B6270)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "8px",
            }}
          >
            <span>Gagal memuat bagian <strong>{sectionName}</strong>.</span>
            <button
              onClick={this.handleRetry}
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--accent-blue, #1D4ED8)",
                backgroundColor: "transparent",
                border: "1px solid var(--border-subtle, #D1D5DB)",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Coba lagi
            </button>
          </div>
        );
      }

      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            minHeight: "220px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--bg-app, #FAFAF8)",
            padding: "24px",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-panel, #FFFFFF)",
              border: "1px solid var(--accent-red, #C8372D)",
              borderRadius: "8px",
              padding: "24px 28px",
              maxWidth: "460px",
              width: "100%",
              boxShadow: "0 2px 12px rgba(0, 0, 0, 0.05)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "18px",
                backgroundColor: "rgba(200, 55, 45, 0.1)",
                color: "var(--accent-red, #C8372D)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px auto",
                fontSize: "16px",
                fontWeight: 700,
              }}
            >
              !
            </div>

            <h4
              style={{
                margin: "0 0 8px 0",
                fontSize: "15px",
                fontWeight: 700,
                color: "var(--text-main, #1F2430)",
              }}
            >
              Gagal Memuat {sectionName}
            </h4>

            <p
              style={{
                margin: "0 0 16px 0",
                fontSize: "12px",
                color: "var(--text-secondary, #5B6270)",
                lineHeight: 1.5,
              }}
            >
              Terjadi kesalahan saat merender bagian ini{this.state.errorRefId ? ` (Ref: ${this.state.errorRefId})` : ""}. Bagian lain aplikasi tetap berfungsi normal.
            </p>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={this.handleRetry}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#FFFFFF",
                  backgroundColor: "var(--accent-blue, #1D4ED8)",
                  border: "none",
                  borderRadius: "5px",
                  cursor: "pointer",
                }}
              >
                Coba lagi
              </button>

              {fallbackAction}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

