"use client";

import React, { useEffect, useState } from "react";

interface TopPatternItem {
  normalizedMessage: string;
  exampleMessage: string;
  count: number;
  percentage: number;
}

interface TopPatternsCardProps {
  deviceId: string;
  onIgnorePattern?: (pattern: string) => void;
}

export function TopPatternsCard({ deviceId, onIgnorePattern }: TopPatternsCardProps) {
  const [patterns, setPatterns] = useState<TopPatternItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadTopPatterns() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/devices/${deviceId}/top-patterns`);
        const data = await res.json();
        if (isMounted && res.ok) {
          setPatterns(data.patterns || []);
          setTotalCount(data.totalCount || 0);
        }
      } catch {
        // Abaikan error jaringan
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    loadTopPatterns();
    return () => {
      isMounted = false;
    };
  }, [deviceId]);

  return (
    <div
      style={{
        backgroundColor: "var(--bg-panel)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        padding: "18px 20px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
            Pesan Paling Sering (Top 5 Pola 24 Jam)
          </h3>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Frekuensi pesan teratas dari data teragregasi. Membantu mengidentifikasi lonjakan atau pengulangan log.
          </p>
        </div>
        {totalCount > 0 && (
          <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)" }}>
            Total Sampel: {totalCount.toLocaleString("id-ID")} log
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)", fontSize: "12px" }}>
          Memuat pola pesan teratas...
        </div>
      ) : patterns.length === 0 ? (
        <div style={{ padding: "20px", textAlign: "center", color: "var(--text-secondary)", fontSize: "12px" }}>
          Belum ada rekaman pola pesan dalam 24 jam terakhir untuk perangkat ini.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {patterns.map((item, idx) => {
            const isDominant = item.percentage >= 50;

            return (
              <div
                key={idx}
                style={{
                  padding: "10px 12px",
                  backgroundColor: isDominant ? "#FEF2F2" : "#F8FAFC",
                  border: isDominant ? "1px solid #FECACA" : "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="font-mono"
                      title={item.exampleMessage}
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: isDominant ? "#991B1B" : "var(--text-main)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.exampleMessage}
                    </div>
                    {item.normalizedMessage !== item.exampleMessage && (
                      <div
                        style={{
                          fontSize: "10px",
                          color: "var(--text-secondary)",
                          marginTop: "2px",
                          fontFamily: "monospace",
                        }}
                      >
                        Pola: {item.normalizedMessage}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
                    <div style={{ textAlign: "right" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          color: isDominant ? "#991B1B" : "var(--text-main)",
                        }}
                      >
                        {item.count.toLocaleString("id-ID")}x
                      </span>
                      <span
                        style={{
                          fontSize: "11px",
                          color: isDominant ? "#DC2626" : "var(--text-secondary)",
                          marginLeft: "4px",
                        }}
                      >
                        ({item.percentage}%)
                      </span>
                    </div>

                    {onIgnorePattern && (
                      <button
                        type="button"
                        onClick={() => onIgnorePattern(item.exampleMessage)}
                        style={{
                          padding: "3px 8px",
                          fontSize: "10px",
                          fontWeight: 600,
                          backgroundColor: "#FFFFFF",
                          border: "1px solid var(--border-color)",
                          borderRadius: "3px",
                          cursor: "pointer",
                        }}
                      >
                        Abaikan
                      </button>
                    )}
                  </div>
                </div>

                {/* Progress bar persentase */}
                <div
                  style={{
                    width: "100%",
                    height: "4px",
                    backgroundColor: "#E2E8F0",
                    borderRadius: "2px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(item.percentage, 100)}%`,
                      height: "100%",
                      backgroundColor: isDominant ? "#EF4444" : "var(--accent-blue)",
                      borderRadius: "2px",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
