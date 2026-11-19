"use client";

import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TopologyCanvasErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("TopologyCanvasErrorBoundary caught an error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            minHeight: "400px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "var(--bg-app, #FAFAF8)",
            padding: "24px",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-panel, #FFFFFF)",
              border: "1px solid var(--accent-red, #C8372D)",
              borderRadius: "8px",
              padding: "24px 28px",
              maxWidth: "480px",
              width: "100%",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "20px",
                backgroundColor: "rgba(200, 55, 45, 0.1)",
                color: "var(--accent-red, #C8372D)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px auto",
                fontSize: "18px",
                fontWeight: 700,
              }}
            >
              !
            </div>
            <h4
              style={{
                margin: "0 0 8px 0",
                fontSize: "16px",
                fontWeight: 700,
                color: "var(--text-main, #1F2430)",
              }}
            >
              Gagal Memuat Kanvas Peta
            </h4>
            <p
              style={{
                margin: "0 0 16px 0",
                fontSize: "12px",
                color: "var(--text-secondary, #5B6270)",
                lineHeight: 1.5,
              }}
            >
              Terjadi kesalahan saat merender elemen topologi jaringan.
              {this.state.error?.message ? ` (${this.state.error.message})` : ""}
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "var(--accent-blue, #1F5FBF)",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Muat Ulang Peta
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

