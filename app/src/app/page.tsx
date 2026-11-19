"use client";

import { useEffect, useState, memo, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { useCurrentUser } from "@/components/UserProvider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NocSummaryWidgets, NocRingkasanData } from "@/components/peta/NocSummaryWidgets";
import { NodeDetailDrawer } from "@/components/peta/NodeDetailDrawer";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { ChartSummaryMetrics, HourlyBucketData } from "@shared/monitoring";

// Dynamic import dengan SSR skeleton agar First Load JS bundle tetap kecil (< 100 KB)
const HourlyActivityChart = dynamic(
  () => import("@/components/HourlyActivityChart").then((m) => m.HourlyActivityChart),
  {
    ssr: true,
    loading: () => (
      <div
        style={{
          height: "140px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: "12px",
          backgroundColor: "#FAFAF8",
          borderRadius: "4px",
          border: "1px dashed var(--border-color)",
        }}
      >
        Memuat komponen grafik aktivitas volume log...
      </div>
    ),
  }
);

const DASHBOARD_CLIENT_CACHE_KEY = "jagalog_dashboard_cached_data_v1";

interface DashboardData {
  status?: {
    devices?: "ok" | "basi" | "gagal";
    incidents?: "ok" | "basi" | "gagal";
    hourlyChart?: "ok" | "basi" | "gagal";
    ai?: "ok" | "basi" | "gagal";
    areas?: "ok" | "basi" | "gagal";
    isStale?: boolean;
  };
  sectionErrors?: Record<string, { message: string; code: string }>;
  isFastPath?: boolean;
  refreshedAt?: string;
  summary: {
    onlineDevicesCount: number;
    offlineDevicesCount: number;
    logStoppedDevicesCount?: number;
    unknownDevicesCount?: number;
    totalDevicesCount: number;
    incidentsBySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      total: number;
    };
    totalLogs24h: number;
    latestAiAnalysis: {
      id: string;
      riskLevel: string;
      summary: string;
      suspectedAttack: string | null;
      createdAt: string;
      deviceName: string | null;
    } | null;
  };
  hourlyChart: HourlyBucketData[];
  chartSummary?: ChartSummaryMetrics;
  devices: Array<{
    id: string;
    name: string;
    type: string;
    ipAddress: string | null;
    isOnline: boolean;
    status?: "online" | "log_stopped" | "offline" | "rto" | "unknown" | string;
    statusChangedAt?: string | null;
    lastSeenAt: string | null;
    logCount24h: number;
    openIncidentCount: number;
    sparkline: number[];
  }>;
  recentIncidents: Array<{
    id: string;
    deviceId: string;
    deviceName: string | null;
    deviceType: string | null;
    ruleKey: string;
    severity: string;
    title: string;
    mainEntity: string | null;
    count: number;
    status: string;
    lastSeen: string;
  }>;
  currentUser?: {
    username: string;
    role: "admin" | "viewer";
  };
  areaSummary?: Array<{
    id: string;
    nama: string;
    warnaGaris: string;
    totalDevices: number;
    onlineCount: number;
    logStoppedCount: number;
    offlineCount: number;
    unknownCount: number;
    openIncidentCount: number;
  }>;
}

export default function DashboardOverviewPage() {
  const router = useRouter();
  const { currentUser } = useCurrentUser();
  const [data, setData] = useState<DashboardData | null>(null);
  const [petaRingkasan, setPetaRingkasan] = useState<NocRingkasanData | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isStaleData, setIsStaleData] = useState(false);
  const [circuitCountdown, setCircuitCountdown] = useState<number>(0);
  const [lastRefreshed, setLastRefreshed] = useState<string>("");
  const isMountedRef = useRef(true);
  const lastFetchTimeRef = useRef<number>(0);
  const lastResyncTimeRef = useRef<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  const circuitBreakerUntilRef = useRef<number>(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const slowWatchdogTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Timer hitung mundur circuit breaker
  useEffect(() => {
    const timer = setInterval(() => {
      if (circuitBreakerUntilRef.current > Date.now()) {
        const remaining = Math.ceil((circuitBreakerUntilRef.current - Date.now()) / 1000);
        setCircuitCountdown(remaining);
      } else if (circuitCountdown > 0) {
        setCircuitCountdown(0);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [circuitCountdown]);

  useEffect(() => {
    isMountedRef.current = true;

    // SWR Klien: Tampilkan data instan dari sessionStorage (< 5 ms) saat reload tanpa layar kosong
    try {
      const cached = typeof window !== "undefined" ? sessionStorage.getItem(DASHBOARD_CLIENT_CACHE_KEY) : null;
      if (cached) {
        const parsed = JSON.parse(cached);
        setData(parsed);
        if (parsed.ringkasanNoc) setPetaRingkasan(parsed.ringkasanNoc);
        setLastRefreshed(new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }) + " (Tersimpan)");
      } else {
        setIsLoading(true);
      }
    } catch {
      setIsLoading(true);
    }

    return () => {
      isMountedRef.current = false;
      if (slowWatchdogTimerRef.current) clearTimeout(slowWatchdogTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const fetchDashboardData = async (isManual = false) => {
    // 1. Circuit breaker check: jika dalam masa pendinginan 30s dan bukan manual, tahan
    if (!isManual && Date.now() < circuitBreakerUntilRef.current) {
      return;
    }

    if (isManual) {
      setIsLoading(true);
      consecutiveFailuresRef.current = 0;
      circuitBreakerUntilRef.current = 0;
      setCircuitCountdown(0);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    }

    // Watchdog 3 detik: jika data belum siap setelah 3 detik, tampilkan tombol Coba Lagi
    if (slowWatchdogTimerRef.current) clearTimeout(slowWatchdogTimerRef.current);
    slowWatchdogTimerRef.current = setTimeout(() => {
      if (isMountedRef.current && !data) {
        setIsSlowLoading(true);
      }
    }, 3000);

    try {
      const resDash = await fetch("/api/stats/dashboard");
      lastFetchTimeRef.current = Date.now();

      if (resDash.status === 401) {
        router.push("/login");
        return;
      }

      if (resDash.ok) {
        const json = await resDash.json();
        if (!isMountedRef.current) return;
        setData(json);
        consecutiveFailuresRef.current = 0;
        circuitBreakerUntilRef.current = 0;
        setCircuitCountdown(0);
        setIsSlowLoading(false);
        setIsStaleData(!!json.status?.isStale || Object.values(json.status || {}).some((s) => s === "basi"));
        setLoadError(null);
        if (json.ringkasanNoc) {
          setPetaRingkasan(json.ringkasanNoc);
        }
        setLastRefreshed(new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" }));

        // Simpan snapshot untuk SWR klien
        try {
          sessionStorage.setItem(DASHBOARD_CLIENT_CACHE_KEY, JSON.stringify(json));
        } catch {}
      } else {
        let errDesc = `HTTP ${resDash.status}`;
        try {
          const errBody = await resDash.json();
          if (errBody?.error) errDesc = errBody.error;
        } catch {}
        if (resDash.status === 403) errDesc = "Tidak punya izin untuk mengakses ringkasan dashboard.";
        else if (resDash.status === 429) errDesc = "Terlalu banyak permintaan (Rate limit). Coba lagi dalam beberapa saat.";
        else if (resDash.status >= 500) errDesc = "Server terlalu sibuk atau database sedang memproses data.";
        throw new Error(errDesc);
      }
    } catch (err: any) {
      console.warn("[Dashboard] Gagal memuat data:", err);
      lastFetchTimeRef.current = Date.now();
      consecutiveFailuresRef.current += 1;
      const errorMsg = err?.message || "Gagal memuat data ringkasan dashboard.";

      // Jika sudah ada data sebelumnya, pertahankan data lama (Stale-While-Revalidate)
      if (data) {
        setIsStaleData(true);
        setLoadError(`Data mungkin tidak terbaru (${errorMsg})`);
      } else {
        setLoadError(errorMsg);
      }

      // Circuit breaker: jika gagal 3x berturut-turut, hentikan permintaan otomatis 30 detik
      if (consecutiveFailuresRef.current >= 3) {
        circuitBreakerUntilRef.current = Date.now() + 30000;
        setCircuitCountdown(30);
      } else if (!isManual) {
        // Retry terbatas: maksimal 2x dengan backoff eksponensial (1s, 3s) + jitter
        const backoffDelays = [1000, 3000];
        const baseDelay = backoffDelays[consecutiveFailuresRef.current - 1] || 3000;
        const jitter = Math.random() * 300;
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            fetchDashboardData(false);
          }
        }, baseDelay + jitter);
      }
    } finally {
      if (slowWatchdogTimerRef.current) {
        clearTimeout(slowWatchdogTimerRef.current);
        slowWatchdogTimerRef.current = null;
      }
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const { status: liveStatus, subscribe } = useLiveUpdates();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const debouncedFetch = useCallback((originEventType?: string) => {
    // 1. Cek circuit breaker
    if (Date.now() < circuitBreakerUntilRef.current) {
      return;
    }

    // 2. Batasi event resync maksimal 1x per 30 detik per tampilan
    if (originEventType === "resync") {
      if (Date.now() - lastResyncTimeRef.current < 30000) {
        return;
      }
      lastResyncTimeRef.current = Date.now();
    }

    // 3. Hindari refetch terlalu rapat (< 5 detik)
    if (Date.now() - lastFetchTimeRef.current < 5000) {
      return;
    }

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchDashboardData(false);
    }, 400);
  }, []);

  useEffect(() => {
    fetchDashboardData(false);

    // Berlangganan event pembaruan langsung (tanpa polling ganda saat SSE aktif)
    const unsubStatus = subscribe("perangkat.status", () => debouncedFetch("perangkat.status"));
    const unsubDevice = subscribe("perangkat.diubah", () => debouncedFetch("perangkat.diubah"));
    const unsubGroup = subscribe("grup.berubah", () => debouncedFetch("grup.berubah"));
    const unsubIncident = subscribe("insiden.berubah", () => debouncedFetch("insiden.berubah"));
    const unsubStats = subscribe("statistik.diperbarui", () => debouncedFetch("statistik.diperbarui"));
    const unsubResync = subscribe("resync", () => debouncedFetch("resync"));

    // 16. Pembaruan langsung: jam berjalan diperbarui lewat SSE yang sudah ada
    // (hanya batang terakhir dan kartu ringkasan, tanpa memuat ulang seluruh grafik).
    const unsubLog = subscribe("log.baru", (evt) => {
      setData((prev) => {
        if (!prev || !prev.hourlyChart || prev.hourlyChart.length === 0) return prev;
        const addCount = evt?.data_ringkas?.jumlah || 1;
        const lastIdx = prev.hourlyChart.length - 1;
        const lastBar = prev.hourlyChart[lastIdx];
        const updatedLastBar = {
          ...lastBar,
          jumlah_log: (lastBar.jumlah_log || lastBar.count || 0) + addCount,
          count: (lastBar.jumlah_log || lastBar.count || 0) + addCount,
        };
        const updatedHourly = [...prev.hourlyChart];
        updatedHourly[lastIdx] = updatedLastBar;

        const updatedSummary = prev.chartSummary
          ? {
              ...prev.chartSummary,
              total_24j: prev.chartSummary.total_24j + addCount,
            }
          : undefined;

        return {
          ...prev,
          summary: {
            ...prev.summary,
            totalLogs24h: prev.summary.totalLogs24h + addCount,
          },
          hourlyChart: updatedHourly,
          chartSummary: updatedSummary,
        };
      });
    });

    return () => {
      unsubStatus();
      unsubDevice();
      unsubGroup();
      unsubIncident();
      unsubStats();
      unsubResync();
      unsubLog();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [subscribe, debouncedFetch]);

  // Hitung nilai maksimum chart
  const maxHourlyCount = Math.max(...(data?.hourlyChart.map((h) => h.count) || [10]), 10);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Header Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: "var(--text-main)",
                letterSpacing: "-0.3px",
              }}
            >
              Ringkasan Operasional & Keamanan Jaringan
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
              Pemantauan log real-time dan deteksi anomali pada seluruh perangkat jaringan aktif (WIB).
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {lastRefreshed && (
              <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Pembaruan: {lastRefreshed} WIB
              </span>
            )}
            {isStaleData && (
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "#92400E",
                  backgroundColor: "#FEF3C7",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  border: "1px solid #FCD34D",
                }}
              >
                Data mungkin tidak terbaru
              </span>
            )}
            <button
              onClick={() => {
                fetchDashboardData(true);
              }}
              className="touch-target"
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--text-main)",
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Segarkan
            </button>
          </div>
        </div>

        {/* Banner Peringatan Pemuatan Lambat (> 3 detik) */}
        {isSlowLoading && !data && (
          <div
            role="alert"
            style={{
              backgroundColor: "#FEFCE8",
              border: "1px solid #FDE047",
              borderLeft: "4px solid #CA8A04",
              borderRadius: "var(--radius-sm)",
              padding: "12px 16px",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
              fontSize: "13px",
              color: "#854D0E",
            }}
          >
            <span>Memuat data dashboard membutuhkan waktu lebih lama dari biasa...</span>
            <button
              onClick={() => fetchDashboardData(true)}
              style={{
                padding: "4px 12px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: "#CA8A04",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Coba Lagi
            </button>
          </div>
        )}

        {loadError && (!data || Object.values(data.status || {}).every((s) => s === "gagal")) && (
          <div
            role="alert"
            style={{
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              borderLeft: "4px solid #DC2626",
              borderRadius: "var(--radius-sm)",
              padding: "12px 16px",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "10px",
              fontSize: "13px",
              color: "#991B1B",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 700 }}>⚠</span>
              <span>
                {loadError}
                {circuitCountdown > 0 && (
                  <span style={{ fontWeight: 600, marginLeft: "6px" }}>
                    Permintaan otomatis dihentikan sementara (sisa {circuitCountdown} detik) demi stabilitas sistem.
                  </span>
                )}
              </span>
            </div>
            <button
              onClick={() => fetchDashboardData(true)}
              style={{
                padding: "6px 14px",
                fontSize: "12px",
                fontWeight: 600,
                backgroundColor: "#DC2626",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* Banner Peringatan Parsial (Hanya jika sebagian seksi gagal/basi tetapi sebagian lain berhasil) */}
        {data && Object.values(data.status || {}).some((s) => s === "gagal" || s === "basi") && !loadError && (
          <div
            style={{
              backgroundColor: "#FFFBEB",
              border: "1px solid #FDE68A",
              borderLeft: "4px solid #D97706",
              borderRadius: "var(--radius-sm)",
              padding: "10px 14px",
              marginBottom: "20px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "12px",
              color: "#92400E",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span>ℹ</span>
              <span>
                Beberapa bagian ringkasan menggunakan data tersimpan atau sedang disinkronkan.
              </span>
            </div>
            <button
              onClick={() => fetchDashboardData(true)}
              style={{
                padding: "3px 10px",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "#FFFFFF",
                color: "#92400E",
                border: "1px solid #FCD34D",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              Segarkan Sekarang
            </button>
          </div>
        )}

        {/* 4 Kartu Metrik Utama */}
        <SectionErrorBoundary sectionName="Ringkasan Status & NOC">
        <div
          className="grid-2-mobile mobile-gap-8"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          {/* Kartu 1: Status Perangkat */}
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid var(--accent-blue)",
              borderRadius: "var(--radius-sm)",
              padding: "16px 20px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
              PERANGKAT TERPANTAU
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
              <span style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-main)" }}>
                {data && data.status?.devices !== "gagal" ? data.summary.totalDevicesCount : "-"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                total terdaftar
              </span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "8px", fontSize: "11px" }}>
              <span style={{ color: "#15803D", fontWeight: 600 }}>
                ● {data && data.status?.devices !== "gagal" ? data.summary.onlineDevicesCount : "-"} Online
              </span>
              <span style={{ color: "#B45309", fontWeight: 600 }}>
                ◐ {data && data.status?.devices !== "gagal" ? (data.summary.logStoppedDevicesCount ?? 0) : "-"} Log Berhenti
              </span>
              <span style={{ color: "#B91C1C", fontWeight: 600 }}>
                ○ {data && data.status?.devices !== "gagal" ? data.summary.offlineDevicesCount : "-"} Offline
              </span>
            </div>
          </div>

          {/* Kartu 2: Insiden Keamanan Terbuka */}
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-sm)",
              padding: "16px 20px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
                INSIDEN KEAMANAN TERBUKA
              </span>
              <Link href="/insiden" prefetch={false} style={{ fontSize: "11px", color: "var(--accent-blue)", fontWeight: 600 }}>
                Lihat Semua →
              </Link>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
              <span
                style={{
                  fontSize: "24px",
                  fontWeight: 700,
                  color: (data?.summary.incidentsBySeverity.total || 0) > 0 ? "var(--accent-red)" : "var(--text-main)",
                }}
              >
                {data && data.status?.incidents !== "gagal" ? data.summary.incidentsBySeverity.total : "-"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                membutuhkan perhatian
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "8px", fontSize: "11px" }}>
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: "3px",
                  backgroundColor: "rgba(200, 55, 45, 0.1)",
                  color: "var(--accent-red)",
                  fontWeight: 600,
                }}
              >
                {data && data.status?.incidents !== "gagal" ? data.summary.incidentsBySeverity.critical : "-"} Kritis
              </span>
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: "3px",
                  backgroundColor: "rgba(230, 81, 0, 0.1)",
                  color: "#E65100",
                  fontWeight: 600,
                }}
              >
                {data && data.status?.incidents !== "gagal" ? data.summary.incidentsBySeverity.high : "-"} Tinggi
              </span>
              <span
                style={{
                  padding: "2px 6px",
                  borderRadius: "3px",
                  backgroundColor: "rgba(245, 127, 23, 0.1)",
                  color: "#826B00",
                  fontWeight: 600,
                }}
              >
                {data && data.status?.incidents !== "gagal" ? data.summary.incidentsBySeverity.medium : "-"} Sedang
              </span>
            </div>
          </div>

          {/* Kartu 3: Total Log 24 Jam */}
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid #2E7D32",
              borderRadius: "var(--radius-sm)",
              padding: "16px 20px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
              VOLUME LOG (24 JAM)
            </span>
            <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "8px" }}>
              <span style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-main)" }}>
                {data && data.status?.hourlyChart !== "gagal" ? data.summary.totalLogs24h.toLocaleString("id-ID") : "-"}
              </span>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                event log
              </span>
            </div>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "8px", display: "block" }}>
              Ingest UDP, TCP 5514 & HTTP
            </span>
          </div>

          {/* Kartu 4: Analisa AI Terakhir */}
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid #6A1B9A",
              borderRadius: "var(--radius-sm)",
              padding: "16px 20px",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>
              STATUS ANALISA AI
            </span>
            {data?.summary.latestAiAnalysis ? (
              <div style={{ marginTop: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "2px 6px",
                      borderRadius: "3px",
                      backgroundColor:
                        data.summary.latestAiAnalysis.riskLevel === "critical"
                          ? "rgba(200, 55, 45, 0.15)"
                          : "rgba(230, 81, 0, 0.15)",
                      color:
                        data.summary.latestAiAnalysis.riskLevel === "critical"
                          ? "var(--accent-red)"
                          : "#E65100",
                    }}
                  >
                    RISIKO {data.summary.latestAiAnalysis.riskLevel.toUpperCase()}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                    {data.summary.latestAiAnalysis.deviceName || "Perangkat"}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-main)",
                    marginTop: "6px",
                    lineHeight: "1.4",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  {data.summary.latestAiAnalysis.summary}
                </p>
              </div>
            ) : (
              <div style={{ marginTop: "12px" }}>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                  Belum ada analisa insiden terbaru.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Section NOC Overview: Heatmap, Donut, Tabel Jenis & Pratinjau Peta */}
        {petaRingkasan && (
          <div style={{ marginBottom: "28px" }}>
            <NocSummaryWidgets
              ringkasan={petaRingkasan}
              showMiniMapLink={true}
              onSelectNode={(nodeId) => setSelectedNodeId(nodeId)}
            />
          </div>
        )}

        {/* Widget Status Per Area Jaringan */}
        {data?.areaSummary && data.areaSummary.length > 0 && (
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              padding: "18px 20px",
              marginBottom: "24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", margin: 0 }}>
                  Status Per Area Jaringan
                </h2>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  ({data.areaSummary.length} area)
                </span>
              </div>
              <Link
                href="/grup"
                prefetch={false}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "var(--accent-blue)",
                  textDecoration: "none",
                }}
              >
                Kelola Semua Area →
              </Link>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "10px",
              }}
            >
              {data.areaSummary.map((area) => (
                <Link
                  key={area.id}
                  href={`/perangkat?group=${area.id}`}
                  prefetch={false}
                  style={{
                    display: "block",
                    padding: "12px 14px",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid var(--border-color)",
                    borderRadius: "4px",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "2px",
                          backgroundColor:
                            area.warnaGaris === "merah"
                              ? "#C8372D"
                              : area.warnaGaris === "abu"
                              ? "#5B6270"
                              : "#1F5FBF",
                        }}
                      />
                      <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
                        {area.nama}
                      </span>
                    </div>

                    {area.openIncidentCount > 0 ? (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "1px 6px",
                          borderRadius: "10px",
                          backgroundColor: "rgba(200, 55, 45, 0.1)",
                          color: "#C8372D",
                        }}
                      >
                        {area.openIncidentCount} insiden
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                        Normal
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      height: "5px",
                      borderRadius: "2.5px",
                      backgroundColor: "#E6E4DF",
                      overflow: "hidden",
                      display: "flex",
                      margin: "6px 0",
                    }}
                  >
                    {area.totalDevices > 0 && (
                      <>
                        <div style={{ width: `${(area.onlineCount / area.totalDevices) * 100}%`, backgroundColor: "#1F5FBF" }} />
                        <div style={{ width: `${(area.logStoppedCount / area.totalDevices) * 100}%`, backgroundColor: "#D97706" }} />
                        <div style={{ width: `${(area.offlineCount / area.totalDevices) * 100}%`, backgroundColor: "#C8372D" }} />
                        <div style={{ width: `${(area.unknownCount / area.totalDevices) * 100}%`, backgroundColor: "#5B6270" }} />
                      </>
                    )}
                  </div>

                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", display: "flex", justifyContent: "space-between" }}>
                    <span>{area.onlineCount} dari {area.totalDevices} online</span>
                    {area.offlineCount > 0 && (
                      <span style={{ color: "#C8372D", fontWeight: 600 }}>
                        {area.offlineCount} offline
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
        </SectionErrorBoundary>

        {/* Section 1: Grafik Volume Log per Jam (24 Jam) */}
        <SectionErrorBoundary sectionName="Grafik Aktivitas Log">
        <div
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "20px 24px",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-main)" }}>
                Aktivitas Volume Log per Jam (24 Jam Terakhir)
              </h2>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Distribusi agregat jumlah event log masuk ke sistem JagaLog (WIB).
              </span>
            </div>
          </div>

          {/* SVG Bar Chart Memoized & Ringan */}
          <div style={{ width: "100%", position: "relative" }}>
            <HourlyActivityChart
              chartData={data?.hourlyChart || []}
              summaryMetrics={data?.chartSummary}
              isError={data?.status?.hourlyChart === "gagal"}
              onRetry={() => fetchDashboardData(true)}
            />
          </div>
        </div>
        </SectionErrorBoundary>

        {/* Section 2: Grid Kartu Perangkat */}
        <SectionErrorBoundary sectionName="Daftar Perangkat & Insiden Terbuka">
        <div style={{ marginBottom: "28px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-main)" }}>
                Status Perangkat Jaringan Terdaftar
              </h2>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Konektivitas dan ringkasan metrik masing-masing perangkat.
              </span>
            </div>
            <Link
              href="/perangkat"
              prefetch={false}
              style={{
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--accent-blue)",
              }}
            >
              Kelola Perangkat →
            </Link>
          </div>

          <div
            className="grid-1-mobile mobile-gap-12"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: "16px",
            }}
          >
            {data?.devices.map((dev) => (
              <Link
                key={dev.id}
                href={`/perangkat/${dev.id}`}
                prefetch={false}
                style={{
                  display: "block",
                  backgroundColor: "var(--bg-panel)",
                  border: "1px solid var(--border-color)",
                  borderRadius: "var(--radius-sm)",
                  padding: "16px 18px",
                  transition: "border-color 0.15s ease",
                  textDecoration: "none",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {(() => {
                        const st = dev.status || (dev.isOnline ? "online" : "unknown");
                        const dotColor =
                          st === "online"
                            ? "#22C55E"
                            : st === "log_stopped"
                            ? "#EAB308"
                            : st === "offline" || st === "rto"
                            ? "#EF4444"
                            : "#94A3B8";
                        return (
                          <span
                            style={{
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              backgroundColor: dotColor,
                              flexShrink: 0,
                            }}
                          />
                        );
                      })()}
                      <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-main)" }}>
                        {dev.name}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "12px",
                          color: "var(--text-muted)",
                        }}
                      >
                        {dev.ipAddress || "Token-based (HTTP)"}
                      </span>
                      {(() => {
                        const st = (dev.status || (dev.isOnline ? "online" : "unknown")) as string;
                        const statusConfig =
                          ({
                            online: { label: "Online", color: "#15803D", bg: "#F0FDF4" },
                            log_stopped: { label: "Log berhenti", color: "#B45309", bg: "#FEFCE8" },
                            offline: { label: "Offline", color: "#B91C1C", bg: "#FEF2F2" },
                            rto: { label: "RTO / Down", color: "#B91C1C", bg: "#FEF2F2" },
                            unknown: { label: "Belum ada data", color: "#64748B", bg: "#F1F5F9" },
                          } as Record<string, { label: string; color: string; bg: string }>)[st] || {
                            label: st || "Belum ada data",
                            color: "#64748B",
                            bg: "#F1F5F9",
                          };
                        return (
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "1px 5px",
                              borderRadius: "3px",
                              fontWeight: 600,
                              color: statusConfig.color,
                              backgroundColor: statusConfig.bg,
                            }}
                          >
                            {statusConfig.label}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: "11px",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "3px",
                      backgroundColor: "var(--bg-app)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-color)",
                    }}
                  >
                    {dev.type}
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "16px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--border-color)",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>
                    Log 24 Jam:{" "}
                    <strong style={{ color: "var(--text-main)" }}>
                      {dev.logCount24h.toLocaleString("id-ID")}
                    </strong>
                  </span>

                  {dev.openIncidentCount > 0 ? (
                    <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>
                      {dev.openIncidentCount} Insiden Terbuka
                    </span>
                  ) : (
                    <span style={{ color: "#2E7D32", fontWeight: 500 }}>Aman</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Section 3: Daftar Insiden Terbaru */}
        <div
          style={{
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-sm)",
            padding: "20px 24px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-main)" }}>
                Insiden Keamanan Terbaru
              </h2>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Peringatan deteksi otomatis yang memerlukan investigasi administrator.
              </span>
            </div>
            <Link href="/insiden" prefetch={false} style={{ fontSize: "12px", color: "var(--accent-blue)", fontWeight: 600 }}>
              Lihat Semua Insiden ({data?.summary.incidentsBySeverity.total || 0}) →
            </Link>
          </div>

          {data?.recentIncidents && data.recentIncidents.length > 0 ? (
            <>
              <div className="desktop-only" style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border-color)", textAlign: "left" }}>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>SEVERITY</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>PERANGKAT</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>JUDUL INSIDEN</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>ENTITAS / IP</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>FREKUENSI</th>
                      <th style={{ padding: "8px 12px", fontWeight: 600, color: "var(--text-muted)" }}>WAKTU TERAKHIR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentIncidents.map((inc) => {
                      const isCrit = inc.severity === "critical";
                      const isHigh = inc.severity === "high";

                      return (
                        <tr
                          key={inc.id}
                          style={{
                            borderBottom: "1px solid var(--border-color)",
                            borderLeft: isCrit
                              ? "3px solid var(--accent-red)"
                              : isHigh
                              ? "3px solid #E65100"
                              : "3px solid transparent",
                          }}
                        >
                          <td style={{ padding: "10px 12px" }}>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 700,
                                textTransform: "uppercase",
                                padding: "2px 6px",
                                borderRadius: "3px",
                                backgroundColor: isCrit
                                  ? "rgba(200, 55, 45, 0.1)"
                                  : isHigh
                                  ? "rgba(230, 81, 0, 0.1)"
                                  : "rgba(245, 127, 23, 0.1)",
                                color: isCrit
                                  ? "var(--accent-red)"
                                  : isHigh
                                  ? "#E65100"
                                  : "#826B00",
                              }}
                            >
                              {inc.severity}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-main)", fontWeight: 500 }}>
                            {inc.deviceName || "Perangkat"}
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>
                            {inc.title}
                          </td>
                          <td
                            style={{
                              padding: "10px 12px",
                              fontFamily: "var(--font-mono)",
                              fontSize: "12px",
                              color: "var(--text-secondary)",
                            }}
                          >
                            {inc.mainEntity || "-"}
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-main)" }}>
                            {inc.count}x
                          </td>
                          <td style={{ padding: "10px 12px", color: "var(--text-muted)", fontSize: "12px" }}>
                            {new Date(inc.lastSeen).toLocaleTimeString("id-ID", {
                              timeZone: "Asia/Jakarta",
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}{" "}
                            WIB
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List */}
              <div className="mobile-only" style={{ display: "none" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {data.recentIncidents.map((inc) => {
                    const isCrit = inc.severity === "critical";
                    const isHigh = inc.severity === "high";

                    return (
                      <Link
                        key={inc.id}
                        href="/insiden"
                        prefetch={false}
                        style={{
                          display: "block",
                          backgroundColor: "var(--bg-app)",
                          border: "1px solid var(--border-color)",
                          borderLeft: isCrit
                            ? "4px solid var(--accent-red)"
                            : isHigh
                            ? "4px solid #E65100"
                            : "4px solid #F57F17",
                          borderRadius: "var(--radius-sm)",
                          padding: "12px 14px",
                          textDecoration: "none",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              backgroundColor: isCrit
                                ? "rgba(200, 55, 45, 0.1)"
                                : isHigh
                                ? "rgba(230, 81, 0, 0.1)"
                                : "rgba(245, 127, 23, 0.1)",
                              color: isCrit
                                ? "var(--accent-red)"
                                : isHigh
                                ? "#E65100"
                                : "#826B00",
                            }}
                          >
                            {inc.severity}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {new Date(inc.lastSeen).toLocaleTimeString("id-ID", {
                              timeZone: "Asia/Jakarta",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                            WIB
                          </span>
                        </div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)", marginTop: "6px" }}>
                          {inc.title}
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", fontSize: "12px" }}>
                          <span style={{ color: "var(--text-secondary)" }}>
                            {inc.deviceName || "Perangkat"}
                          </span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                            {inc.mainEntity || "-"} • {inc.count}x
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "28px 0", color: "var(--text-muted)", fontSize: "13px" }}>
              Tidak ada insiden keamanan terbuka saat ini.
            </div>
          )}
        </div>
        </SectionErrorBoundary>

        {/* Drawer Detail Saat Node Heatmap Diklik */}
        <NodeDetailDrawer
          nodeId={selectedNodeId}
          onClose={() => setSelectedNodeId(null)}
          currentUserRole={currentUser?.role || "viewer"}
        />
      </main>
    </div>
  );
}
