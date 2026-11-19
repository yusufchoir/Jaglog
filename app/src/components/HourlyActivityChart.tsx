"use client";

import React, { useState, useMemo, useEffect, useRef, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  HourlyBucketData,
  ChartSummaryMetrics,
  formatHourRangeIndonesian,
} from "@shared/monitoring";

interface HourlyActivityChartProps {
  chartData: HourlyBucketData[];
  summaryMetrics?: ChartSummaryMetrics | null;
  deviceId?: string; // Jika diberikan, klik batang mengarah ke log perangkat ini
  deviceName?: string;
  onHourClick?: (bucket: HourlyBucketData) => void;
  isError?: boolean;
  onRetry?: () => void;
}

export const HourlyActivityChart = memo(function HourlyActivityChart({
  chartData,
  summaryMetrics,
  deviceId,
  deviceName,
  onHourClick,
  isError = false,
  onRetry,
}: HourlyActivityChartProps) {
  const router = useRouter();

  // Mode Tampilan: "Semua" vs "Per tingkat keparahan"
  const [viewMode, setViewMode] = useState<"semua" | "keparahan">("semua");

  // Mode Tampilan Aksesibilitas: Grafik vs Tabel
  const [showTable, setShowTable] = useState(false);

  // Status Buka/Tutup Blok "Cara Membaca Grafik" (disimpan di LocalStorage)
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isClientLoaded, setIsClientLoaded] = useState(false);

  useEffect(() => {
    setIsClientLoaded(true);
    const saved = localStorage.getItem("jagalog_chart_guide_open");
    if (saved !== null) {
      setIsGuideOpen(saved === "true");
    }
  }, []);

  const toggleGuide = () => {
    const next = !isGuideOpen;
    setIsGuideOpen(next);
    localStorage.setItem("jagalog_chart_guide_open", String(next));
  };

  // State Item Aktif (Hover / Tap / Keyboard Focus)
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  // Ambil metrik dasar dan normalisasi aman (selalu dipanggil di atas sebelum early return)
  const buckets = useMemo(() => {
    if (!Array.isArray(chartData)) return [];
    return chartData.map((b) => {
      const rawCount = b.jumlah_log ?? b.count ?? 0;
      const numCount = typeof rawCount === "number" ? rawCount : parseInt(String(rawCount), 10);
      const safeCount = Number.isFinite(numCount) && numCount >= 0 ? numCount : 0;
      return {
        ...b,
        jumlah_log: safeCount,
        count: safeCount,
        labelWib: b.labelWib || "00.00",
        rentangWib: b.rentangWib || "00.00-01.00 WIB",
        jumlah_per_severity: {
          critical: Number(b.jumlah_per_severity?.critical) || 0,
          error: Number(b.jumlah_per_severity?.error) || 0,
          warning: Number(b.jumlah_per_severity?.warning) || 0,
          notice: Number(b.jumlah_per_severity?.notice) || 0,
          info: Number(b.jumlah_per_severity?.info) || 0,
          debug: Number(b.jumlah_per_severity?.debug) || 0,
        },
        top_perangkat: Array.isArray(b.top_perangkat) ? b.top_perangkat : [],
      };
    });
  }, [chartData]);

  const totalLogs = useMemo(
    () => summaryMetrics?.total_24j ?? buckets.reduce((s, b) => s + (b.jumlah_log || b.count || 0), 0),
    [buckets, summaryMetrics]
  );

  // Jam penuh saja untuk kalkulasi rata-rata lokal jika summaryMetrics belum tersedia
  const fullHourBuckets = useMemo(() => buckets.filter((b) => !b.parsial), [buckets]);
  const avgHourly = useMemo(() => {
    if (summaryMetrics?.rata_rata_per_jam !== undefined) return summaryMetrics.rata_rata_per_jam;
    if (fullHourBuckets.length === 0) return 0;
    const sum = fullHourBuckets.reduce((s, b) => s + (b.jumlah_log || b.count || 0), 0);
    return Math.round(sum / fullHourBuckets.length);
  }, [summaryMetrics, fullHourBuckets]);

  // Cari nilai maksimum untuk skala sumbu Y
  const maxCount = useMemo(() => {
    const maxVal = Math.max(...buckets.map((b) => b.jumlah_log || b.count || 0), 0);
    if (maxVal === 0) return 10;
    // Bulatkan ke atas kelipatan 5, 10, atau 100 agar sumbu Y rapi
    const magnitude = Math.pow(10, Math.floor(Math.log10(maxVal)));
    return Math.ceil(maxVal / magnitude) * magnitude;
  }, [buckets]);

  // Cari indeks puncak (tertinggi)
  const peakIdx = useMemo(() => {
    let bestIdx = -1;
    let bestVal = -1;
    buckets.forEach((b, idx) => {
      const val = b.jumlah_log || b.count || 0;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = idx;
      }
    });
    return bestVal > 0 ? bestIdx : -1;
  }, [buckets]);

  // Jika kondisi error, tampilkan pesan gagal dengan tombol Coba Lagi (setelah seluruh hook selesai dieksekusi)
  if (isError) {
    return (
      <div
        style={{
          height: "180px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "10px",
          color: "var(--accent-red)",
          fontSize: "13px",
          backgroundColor: "rgba(200, 55, 45, 0.04)",
          border: "1px dashed rgba(200, 55, 45, 0.3)",
          borderRadius: "var(--radius-sm)",
          padding: "20px",
        }}
      >
        <span style={{ fontWeight: 600 }}>Gagal memuat grafik aktivitas log.</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              padding: "6px 14px",
              backgroundColor: "#FFFFFF",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              color: "var(--text-main)",
            }}
          >
            Coba Lagi
          </button>
        )}
      </div>
    );
  }

  // Navigasi Keyboard antar batang
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (buckets.length === 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveIdx((prev) => (prev === null || prev >= buckets.length - 1 ? 0 : prev + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveIdx((prev) => (prev === null || prev <= 0 ? buckets.length - 1 : prev - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (activeIdx !== null && buckets[activeIdx]) {
        handleBarClick(buckets[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setActiveIdx(null);
    }
  };

  const handleBarClick = (bucket: HourlyBucketData) => {
    if (onHourClick) {
      onHourClick(bucket);
      return;
    }
    const targetUrl = deviceId
      ? `/perangkat/${deviceId}?tab=log&rentang=kustom&dari=${encodeURIComponent(bucket.mulai)}&sampai=${encodeURIComponent(bucket.selesai)}`
      : `/perangkat?tab=log&dari=${encodeURIComponent(bucket.mulai)}&sampai=${encodeURIComponent(bucket.selesai)}`;
    router.push(targetUrl);
  };

  // Nilai aktif saat ini
  const activeBucket = activeIdx !== null && buckets[activeIdx] ? buckets[activeIdx] : null;

  // Format ringkas angka Sumbu Y Indonesia
  const formatCompactY = (val: number) => {
    if (val >= 1000000) return `${(val / 1000000).toFixed(1).replace(".", ",")} jt`;
    if (val >= 1000) return `${Math.round(val / 1000)} rb`;
    return String(val);
  };

  // Ticks sumbu Y: 0, 33%, 66%, 100%
  const yTicks = [
    { value: maxCount, y: 15 },
    { value: Math.round((maxCount * 2) / 3), y: 48 },
    { value: Math.round(maxCount / 3), y: 82 },
    { value: 0, y: 115 },
  ];

  // Garis rata-rata Y coordinate
  const avgY = maxCount > 0 ? 115 - (avgHourly / maxCount) * 100 : 115;

  return (
    <div
      ref={chartContainerRef}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Grafik interaktif aktivitas volume log per jam dalam 24 jam terakhir"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        outline: "none",
        position: "relative",
      }}
    >
      {/* 1. Header Kontrol & Segmented Button */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
            Tampilan:
          </span>
          <div
            role="radiogroup"
            aria-label="Pilihan tampilan grafik"
            style={{
              display: "inline-flex",
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "2px",
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "semua"}
              onClick={() => setViewMode("semua")}
              style={{
                fontSize: "11px",
                fontWeight: viewMode === "semua" ? 700 : 500,
                padding: "3px 10px",
                borderRadius: "3px",
                border: "none",
                backgroundColor: viewMode === "semua" ? "#1F5FBF" : "transparent",
                color: viewMode === "semua" ? "#FFFFFF" : "var(--text-main)",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
              }}
            >
              Semua
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={viewMode === "keparahan"}
              onClick={() => setViewMode("keparahan")}
              style={{
                fontSize: "11px",
                fontWeight: viewMode === "keparahan" ? 700 : 500,
                padding: "3px 10px",
                borderRadius: "3px",
                border: "none",
                backgroundColor: viewMode === "keparahan" ? "#1F5FBF" : "transparent",
                color: viewMode === "keparahan" ? "#FFFFFF" : "var(--text-main)",
                cursor: "pointer",
                transition: "background-color 0.15s ease",
              }}
            >
              Per tingkat keparahan
            </button>
          </div>
        </div>

        {/* Tombol Aksesibilitas: Alternatif Tabel & Panduan */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            type="button"
            onClick={() => setShowTable(!showTable)}
            style={{
              fontSize: "11px",
              color: "#1F5FBF",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
              fontWeight: 600,
            }}
          >
            {showTable ? "Lihat sebagai grafik" : "Lihat sebagai tabel"}
          </button>
          <button
            type="button"
            onClick={toggleGuide}
            style={{
              fontSize: "11px",
              color: "var(--text-secondary)",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            <span>{isGuideOpen ? "Sembunyikan panduan" : "Cara membaca grafik"}</span>
            <span style={{ fontSize: "9px" }}>{isGuideOpen ? "▲" : "▼"}</span>
          </button>
        </div>
      </div>

      {/* 2. Blok Panduan "Cara Membaca Grafik" (Bisa Dilipat) */}
      {isGuideOpen && (
        <div
          style={{
            backgroundColor: "#F8FAFC",
            border: "1px solid var(--border-color)",
            borderLeft: "3px solid #1F5FBF",
            borderRadius: "var(--radius-sm)",
            padding: "10px 14px",
            fontSize: "12px",
            lineHeight: "1.5",
            color: "var(--text-main)",
          }}
        >
          Setiap batang adalah jumlah log yang diterima JagaLog dari semua perangkat dalam satu jam.
          Batang yang jauh lebih tinggi dari rata-rata bisa berarti ada aktivitas tidak biasa atau perangkat
          yang membanjir log. Batang yang sangat rendah atau kosong bisa berarti perangkat berhenti mengirim log.
        </div>
      )}

      {/* 3. Kartu Ringkasan (4 Angka di Atas Grafik) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "10px",
        }}
      >
        {/* Total 24 Jam */}
        <div
          style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
            Total 24 Jam
          </div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)", marginTop: "2px" }}>
            {totalLogs.toLocaleString("id-ID")} log
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
            {summaryMetrics?.persen_perubahan !== null && summaryMetrics?.persen_perubahan !== undefined
              ? `${summaryMetrics.persen_perubahan >= 0 ? "naik" : "turun"} ${Math.abs(
                  summaryMetrics.persen_perubahan
                ).toString().replace(".", ",")}% dari kemarin`
              : "-"}
          </div>
        </div>

        {/* Rata-rata per Jam */}
        <div
          style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
            Rata-rata per Jam
          </div>
          <div style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)", marginTop: "2px" }}>
            {avgHourly.toLocaleString("id-ID")} log
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
            Dihitung dari jam penuh
          </div>
        </div>

        {/* Puncak */}
        <div
          style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
            Puncak
          </div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--text-main)",
              marginTop: "2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={summaryMetrics?.puncak?.label || "-"}
          >
            {summaryMetrics?.puncak?.label || "-"}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
            Volume tertinggi
          </div>
        </div>

        {/* Terendah Jam Penuh */}
        <div
          style={{
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
          }}
        >
          <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 500 }}>
            Terendah (Jam Penuh)
          </div>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color: "var(--text-main)",
              marginTop: "2px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={summaryMetrics?.terendah_jam_penuh?.label || "-"}
          >
            {summaryMetrics?.terendah_jam_penuh?.label || "-"}
          </div>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
            Tidak termasuk jam parsial
          </div>
        </div>
      </div>

      {/* Legenda Mode Keparahan */}
      {viewMode === "keparahan" && !showTable && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "12px",
            fontSize: "11px",
            color: "var(--text-secondary)",
            padding: "4px 8px",
            backgroundColor: "#F8FAFC",
            borderRadius: "4px",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#C8372D", borderRadius: "2px" }} />
            Critical
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#EA580C", borderRadius: "2px" }} />
            Error
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#CA8A04", borderRadius: "2px" }} />
            Warning
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#2563EB", borderRadius: "2px" }} />
            Notice/Low
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#6B7280", borderRadius: "2px" }} />
            Info
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "10px", height: "10px", backgroundColor: "#9CA3AF", borderRadius: "2px" }} />
            Debug
          </span>
        </div>
      )}

      {/* 4. Tampilan Tabel Alternatif (Aksesibilitas) */}
      {showTable ? (
        <div
          style={{
            maxHeight: "300px",
            overflowY: "auto",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "11px",
              textAlign: "left",
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                <th style={{ padding: "8px 12px" }}>Jam (WIB)</th>
                <th style={{ padding: "8px 12px" }}>Jumlah Log</th>
                <th style={{ padding: "8px 12px" }}>Critical</th>
                <th style={{ padding: "8px 12px" }}>Error</th>
                <th style={{ padding: "8px 12px" }}>Warning</th>
                <th style={{ padding: "8px 12px" }}>Notice</th>
                <th style={{ padding: "8px 12px" }}>Info</th>
                <th style={{ padding: "8px 12px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: "1px solid #F1F5F9",
                    backgroundColor: b.parsial ? "#FAFAFA" : "#FFFFFF",
                  }}
                >
                  <td style={{ padding: "6px 12px", fontWeight: 600 }}>{b.rentangWib}</td>
                  <td style={{ padding: "6px 12px" }}>{(b.jumlah_log || b.count || 0).toLocaleString("id-ID")}</td>
                  <td style={{ padding: "6px 12px", color: "#C8372D" }}>{b.jumlah_per_severity?.critical ?? 0}</td>
                  <td style={{ padding: "6px 12px", color: "#EA580C" }}>{b.jumlah_per_severity?.error ?? 0}</td>
                  <td style={{ padding: "6px 12px", color: "#CA8A04" }}>{b.jumlah_per_severity?.warning ?? 0}</td>
                  <td style={{ padding: "6px 12px", color: "#2563EB" }}>{b.jumlah_per_severity?.notice ?? 0}</td>
                  <td style={{ padding: "6px 12px", color: "#6B7280" }}>{b.jumlah_per_severity?.info ?? 0}</td>
                  <td style={{ padding: "6px 12px" }}>
                    {b.parsial ? `Parsial (${b.menitBerjalan} mnt)` : "Penuh"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* 5. Tampilan Grafik SVG Interaktif */
        <div style={{ position: "relative", width: "100%", height: "180px", userSelect: "none" }}>
          {totalLogs === 0 ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "var(--text-muted)",
                fontSize: "13px",
                border: "1px dashed var(--border-color)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              <span>Belum ada log pada 24 jam terakhir.</span>
              <Link
                href="/perangkat"
                style={{ fontSize: "11px", color: "#1F5FBF", textDecoration: "underline", fontWeight: 600 }}
              >
                Cara mengirim log
              </Link>
            </div>
          ) : (
            <>
              {/* Tooltip Dinamis Berformat Bahasa Indonesia */}
              {activeBucket && (
                <div
                  style={{
                    position: "absolute",
                    top: "-8px",
                    left: `${Math.min(
                      Math.max(((activeIdx ?? 0) / Math.max(buckets.length, 1)) * 100, 18),
                      82
                    )}%`,
                    transform: "translate(-50%, -100%)",
                    backgroundColor: "#1E293B",
                    color: "#FFFFFF",
                    fontSize: "11px",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    zIndex: 20,
                    pointerEvents: "auto",
                    minWidth: "220px",
                    lineHeight: "1.4",
                  }}
                >
                  <div style={{ fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: "4px" }}>
                    {activeBucket.tanggalWib}, {activeBucket.rentangWib}
                  </div>
                  <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 600 }}>
                    {(activeBucket.jumlah_log || activeBucket.count || 0).toLocaleString("id-ID")} log{" "}
                    <span style={{ fontSize: "10px", fontWeight: 400, color: "#94A3B8" }}>
                      ({Math.round((activeBucket.jumlah_log || activeBucket.count || 0) / 3600)} log/detik)
                    </span>
                  </div>
                  {activeBucket.parsial && (
                    <div style={{ color: "#FBBF24", fontSize: "10px", marginTop: "2px" }}>
                      ⚠️ Jam belum penuh (baru {activeBucket.menitBerjalan} menit)
                    </div>
                  )}
                  <div style={{ fontSize: "10px", color: "#CBD5E1", marginTop: "3px" }}>
                    Critical {activeBucket.jumlah_per_severity?.critical ?? 0} &bull; Error{" "}
                    {activeBucket.jumlah_per_severity?.error ?? 0} &bull; Warning{" "}
                    {activeBucket.jumlah_per_severity?.warning ?? 0} &bull; Info{" "}
                    {activeBucket.jumlah_per_severity?.info ?? 0}
                  </div>
                  <div style={{ fontSize: "10px", color: "#94A3B8", marginTop: "2px" }}>
                    {avgHourly > 0
                      ? `${(((activeBucket.jumlah_log || activeBucket.count || 0) / avgHourly)).toFixed(1).replace(".", ",")}x rata-rata`
                      : "-"}
                    {" \u2022 "}
                    {totalLogs > 0
                      ? `${((((activeBucket.jumlah_log || activeBucket.count || 0) / totalLogs) * 100)).toFixed(1).replace(".", ",")}% dari total 24 jam`
                      : "-"}
                  </div>
                  {activeBucket.top_perangkat && activeBucket.top_perangkat.length > 0 && (
                    <div style={{ fontSize: "10px", color: "#E2E8F0", marginTop: "2px" }}>
                      Terbanyak: {activeBucket.top_perangkat[0].name} (
                      {activeBucket.top_perangkat[0].count.toLocaleString("id-ID")})
                    </div>
                  )}
                  <div style={{ marginTop: "6px", textAlign: "right" }}>
                    <button
                      type="button"
                      onClick={() => handleBarClick(activeBucket)}
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        backgroundColor: "#1F5FBF",
                        color: "#FFFFFF",
                        border: "none",
                        padding: "3px 8px",
                        borderRadius: "3px",
                        cursor: "pointer",
                      }}
                    >
                      Lihat log jam ini →
                    </button>
                  </div>
                </div>
              )}

              <svg
                width="100%"
                height="100%"
                viewBox="0 0 1000 160"
                preserveAspectRatio="none"
                style={{ touchAction: "pan-y", overflow: "visible" }}
              >
                <defs>
                  {/* Pola Garis Miring untuk Jam Parsial */}
                  <pattern
                    id="partial-stripes"
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#1F5FBF" strokeWidth="2.5" opacity="0.4" />
                    <line x1="0" y1="0" x2="6" y2="0" stroke="#E2E8F0" strokeWidth="2" />
                  </pattern>
                </defs>

                {/* Garis Grid Horizontal dan Ticks Sumbu Y */}
                {yTicks.map((tick, i) => (
                  <g key={i}>
                    <line x1="45" y1={tick.y} x2="995" y2={tick.y} stroke="#E2E8F0" strokeWidth="1" strokeDasharray={tick.value === 0 ? "none" : "3 3"} />
                    <text
                      x="40"
                      y={tick.y + 3}
                      textAnchor="end"
                      fontSize="9"
                      fill="#64748B"
                      fontFamily="inherit"
                    >
                      {formatCompactY(tick.value)}
                    </text>
                  </g>
                ))}

                {/* Garis Rata-rata Putus-putus Tipis */}
                {avgHourly > 0 && avgY > 15 && avgY < 115 && (
                  <g>
                    <line
                      x1="45"
                      y1={avgY}
                      x2="995"
                      y2={avgY}
                      stroke="#1F5FBF"
                      strokeWidth="1.2"
                      strokeDasharray="4 3"
                    />
                    <text
                      x="990"
                      y={avgY - 4}
                      textAnchor="end"
                      fontSize="9"
                      fontWeight="600"
                      fill="#1F5FBF"
                      fontFamily="inherit"
                    >
                      Rata-rata {avgHourly.toLocaleString("id-ID")} log/jam
                    </text>
                  </g>
                )}

                {/* Batang-batang Jam (24 Batang) */}
                {buckets.map((item, idx) => {
                  const totalBars = Math.max(buckets.length, 1);
                  const availableWidth = 950;
                  const barSlotWidth = availableWidth / totalBars;
                  const barWidth = Math.max(barSlotWidth - 4, 3);
                  const x = 45 + idx * barSlotWidth + 2;

                  const countVal = item.jumlah_log || item.count || 0;
                  const isZero = countVal === 0;
                  const isPeak = idx === peakIdx && countVal > 0;
                  const isSpike = avgHourly > 0 && countVal >= 2 * avgHourly;
                  const isSelected = activeIdx === idx;

                  // Tinggi batang
                  const barHeight = isZero ? 2 : Math.max(4, (countVal / maxCount) * 100);
                  const y = 115 - barHeight;

                  return (
                    <g
                      key={item.fullTime || idx}
                      style={{ cursor: "pointer" }}
                      tabIndex={0}
                      role="button"
                      aria-label={`${item.rentangWib}: ${countVal} log`}
                      onClick={() => {
                        setActiveIdx(idx);
                        handleBarClick(item);
                      }}
                      onTouchStart={() => setActiveIdx(idx)}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onFocus={() => setActiveIdx(idx)}
                    >
                      {/* Batang Kosong Garis Tipis atau Batang Penuh */}
                      {isZero ? (
                        <rect
                          x={x}
                          y={114}
                          width={barWidth}
                          height={2}
                          fill="#CBD5E1"
                          rx="1"
                        />
                      ) : item.parsial ? (
                        /* Jam Parsial (Arsiran Garis Miring) */
                        <rect
                          x={x}
                          y={y}
                          width={barWidth}
                          height={barHeight}
                          fill="url(#partial-stripes)"
                          stroke={isSelected ? "#0F172A" : isSpike ? "#C8372D" : "#1F5FBF"}
                          strokeWidth={isSpike ? "1.5" : "1"}
                          rx="2"
                        />
                      ) : viewMode === "keparahan" && item.jumlah_per_severity ? (
                        /* Batang Bertumpuk Sesuai Severity */
                        (() => {
                          const sev = item.jumlah_per_severity;
                          const totalSev =
                            (sev.critical || 0) +
                            (sev.error || 0) +
                            (sev.warning || 0) +
                            (sev.notice || 0) +
                            (sev.info || 0) +
                            (sev.debug || 0);

                          if (totalSev === 0) {
                            return (
                              <rect
                                x={x}
                                y={y}
                                width={barWidth}
                                height={barHeight}
                                fill="#1F5FBF"
                                rx="2"
                              />
                            );
                          }

                          let currentY = 115;
                          const layers = [
                            { count: sev.debug || 0, color: "#9CA3AF" },
                            { count: sev.info || 0, color: "#6B7280" },
                            { count: sev.notice || 0, color: "#2563EB" },
                            { count: sev.warning || 0, color: "#CA8A04" },
                            { count: sev.error || 0, color: "#EA580C" },
                            { count: sev.critical || 0, color: "#C8372D" },
                          ];

                          return (
                            <g>
                              {layers.map((l, lIdx) => {
                                if (l.count === 0) return null;
                                const hLayer = (l.count / countVal) * barHeight;
                                currentY -= hLayer;
                                return (
                                  <rect
                                    key={lIdx}
                                    x={x}
                                    y={currentY}
                                    width={barWidth}
                                    height={Math.max(hLayer, 1)}
                                    fill={l.color}
                                    opacity={isSelected ? 1 : 0.9}
                                  />
                                );
                              })}
                            </g>
                          );
                        })()
                      ) : (
                        /* Batang Biru Standar */
                        <rect
                          x={x}
                          y={y}
                          width={barWidth}
                          height={barHeight}
                          fill={
                            isSelected
                              ? "#0F172A"
                              : isSpike
                              ? "#C8372D" // Aksen merah tipis hanya untuk lonjakan > 2x rata-rata
                              : "#1F5FBF"
                          }
                          rx="2"
                          opacity={isSelected ? 1 : 0.88}
                        />
                      )}

                      {/* Penanda Puncak & Label Puncak */}
                      {isPeak && !isZero && (
                        <g>
                          <text
                            x={x + barWidth / 2}
                            y={Math.max(y - 6, 12)}
                            textAnchor="middle"
                            fontSize="8.5"
                            fontWeight="700"
                            fill={isSpike ? "#C8372D" : "#1F5FBF"}
                            fontFamily="inherit"
                          >
                            {isSpike ? "Lonjakan" : "Puncak"}
                          </text>
                        </g>
                      )}

                      {/* Angka di atas batang terpilih / hover */}
                      {isSelected && !isPeak && !isZero && (
                        <text
                          x={x + barWidth / 2}
                          y={Math.max(y - 6, 12)}
                          textAnchor="middle"
                          fontSize="8.5"
                          fontWeight="700"
                          fill="#0F172A"
                          fontFamily="inherit"
                        >
                          {countVal.toLocaleString("id-ID")}
                        </text>
                      )}

                      {/* Label Sumbu X (Jam WIB tiap 3 jam / 6 jam) */}
                      {(idx % 3 === 0 || idx === buckets.length - 1) && (
                        <g>
                          <text
                            x={x + barWidth / 2}
                            y="132"
                            textAnchor="middle"
                            fontSize="8.5"
                            fill={item.gantiHari ? "#0F172A" : "#64748B"}
                            fontWeight={item.gantiHari ? "700" : "500"}
                            fontFamily="inherit"
                          >
                            {item.labelWib}
                          </text>
                          {/* Label Tanggal Pergantian Hari */}
                          {item.gantiHari && (
                            <text
                              x={x + barWidth / 2}
                              y="144"
                              textAnchor="middle"
                              fontSize="7.5"
                              fill="#1E293B"
                              fontWeight="600"
                              fontFamily="inherit"
                            >
                              {item.tanggalWib}
                            </text>
                          )}
                        </g>
                      )}
                    </g>
                  );
                })}

                {/* Label Judul Sumbu X */}
                <text x="520" y="156" textAnchor="middle" fontSize="9" fill="#94A3B8" fontFamily="inherit">
                  Jam (WIB)
                </text>
              </svg>
            </>
          )}
        </div>
      )}

      {/* 6. Penjelasan Otomatis Satu Kalimat di Bawah Grafik (Aturan Terpusat, Bukan AI) */}
      <div
        style={{
          fontSize: "12px",
          color: "var(--text-secondary)",
          padding: "6px 10px",
          backgroundColor: "#F8FAFC",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-sm)",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span style={{ color: "#1F5FBF", fontWeight: 700 }}>•</span>
        <span>
          {summaryMetrics?.penjelasan_otomatis ||
            (totalLogs === 0
              ? "Belum ada log pada 24 jam terakhir."
              : `Volume stabil, tertinggi pukul ${summaryMetrics?.puncak?.jam?.split("-")[0] || "00.00"} (${(
                  summaryMetrics?.puncak?.count || 0
                ).toLocaleString("id-ID")} log).`)}
        </span>
      </div>
    </div>
  );
});

