"use client";

import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useLiveUpdates } from "@/components/LiveUpdateProvider";
import { DeviceConfigGuide } from "@/components/DeviceConfigGuide";
import { UnknownSourcesPanel, UnknownSourceEntry } from "@/components/UnknownSourcesPanel";
import { Toast } from "@/components/Toast";
import { ConfirmModal } from "@/components/ConfirmModal";
import { LogFilterManager } from "@/components/LogFilterManager";
import { TopPatternsCard } from "@/components/TopPatternsCard";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { HourlyActivityChart } from "@/components/HourlyActivityChart";
import { getSafeTimelineOptions, setSafeTimelineOptions } from "@/lib/safe-storage";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { formatClockSkewDescription } from "@shared/time";

interface DeviceIngestDiagnostics {
  lastPacket: {
    timestamp: string;
    sourceIp: string;
    transport: "syslog" | "http";
    accepted: boolean;
    reason?: string;
    reasonLabel?: string;
  } | null;
  rejections24h: {
    nonaktif: number;
    ip_tidak_terdaftar: number;
    token_salah: number;
    rate_limit: number;
    ukuran: number;
    tidak_terbaca: number;
  };
  totalRejected24h: number;
}

interface DeviceDetail {
  id: string;
  name: string;
  type: string;
  ipAddress: string | null;
  location: string | null;
  groupId?: string | null;
  groupName?: string | null;
  groupWarnaGaris?: string | null;
  notes: string | null;
  isActive: boolean;
  timezone?: string;
  status?: "online" | "log_stopped" | "offline" | "rto" | "unknown";
  statusChangedAt?: string | null;
  offlineAfterMinutes?: number;
  pingEnabled?: boolean;
  pingFailureThreshold?: number;
  notifyOnRto?: boolean;
  lastPingAt?: string | null;
  lastPingOk?: boolean | null;
  lastPingRtt?: number | null;
  lastSeenAt: string | null;
  createdAt: string;
  isOnline: boolean;
  logCount24h: number;
  openIncidentCount: number;
  hasIngestToken?: boolean;
}

interface LogEventItem {
  id: string | number;
  receivedAt?: string;
  eventTime: string;
  facility: number;
  severity: number;
  sourceApp: string | null;
  category: string;
  message: string;
  raw?: string;
  parsed: Record<string, any> | null;
  rawMessage: string | null;
  repeatCount?: number;
  firstEventTime?: string;
}

interface IncidentItem {
  id: string;
  ruleKey: string;
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  firstSeen: string;
  lastSeen: string;
  count: number;
  status: "open" | "ack" | "closed";
  mainEntity: string | null;
  evidence: any[] | null;
}

interface StatsData {
  device: DeviceDetail;
  uptime?: {
    uptime24h: number;
    uptime7d: number;
  };
  statusTimeline?: Array<{
    start: string;
    end: string;
    status: "online" | "log_stopped" | "offline" | "rto" | "unknown";
  }>;
  rtoHistory?: Array<{
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
  }>;
  serverConfig: { syslogUdpPort: number; syslogTcpPort: number };
  hourlyVolume: Array<{ hour: string; count: number }>;
  hourlyChart?: any[];
  chartSummary?: any;
  severityBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  topIp: Array<{ ip: string; count: number }>;
  topAccounts: Array<{ account: string; count: number }>;
  latestDailyAnalysis: any | null;
}

import {
  RentangOption,
  SkalaOption,
  ConcreteSkalaOption,
  StatusSlot,
  PingServerSlot,
  LogDeliverySlot,
  TimelineRingkasan,
  TimelineResponse,
  VALID_RENTANG_SKALA,
  SCALE_LABEL_MAP,
  getWibDateString,
  resolveDateRange,
  getValidScalesForRange,
} from "@shared/monitoring/timeline_utils";

const RENTANG_LABEL_MAP: Record<RentangOption, string> = {
  "24j": "24 Jam",
  "7h": "7 Hari",
  "30h": "30 Hari",
  "90h": "90 Hari",
  "1t": "1 Tahun",
  kustom: "Kustom",
};

function formatDurationHuman(seconds: number): string {
  if (seconds <= 0) return "0 detik";
  if (seconds < 60) return `${Math.round(seconds)} detik`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} menit`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours} jam ${remMinutes} menit` : `${hours} jam`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} hari ${remHours} jam` : `${days} hari`;
}


function formatSlotTooltip(slot: StatusSlot): string {
  const mulaiDate = new Date(slot.mulai);
  const selesaiDate = new Date(slot.selesai);
  const formatTime = (d: Date) =>
    d.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const formatDate = (d: Date) =>
    d.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const isSameDay = mulaiDate.toDateString() === selesaiDate.toDateString();
  const timeRange = isSameDay
    ? `${formatDate(mulaiDate)} ${formatTime(mulaiDate)} - ${formatTime(selesaiDate)} WIB`
    : `${formatDate(mulaiDate)} ${formatTime(mulaiDate)} - ${formatDate(selesaiDate)} ${formatTime(selesaiDate)} WIB`;

  const statusLabel =
    slot.status === "online"
      ? "Online"
      : slot.status === "log_stopped"
      ? "Layanan Log Berhenti"
      : slot.status === "offline"
      ? "Offline"
      : "Belum Ada Data";

  const uptimeStr = `${(slot.uptime_persen ?? 100).toFixed(1).replace(".", ",")}%`;
  const parts = [
    timeRange,
    `Status: ${statusLabel}`,
    `Uptime: ${uptimeStr}`,
  ];

  if (slot.detik_online > 0) parts.push(`Online: ${formatDurationHuman(slot.detik_online)}`);
  if (slot.detik_offline > 0) parts.push(`Offline: ${formatDurationHuman(slot.detik_offline)}`);
  if (slot.detik_log_berhenti > 0) parts.push(`Log Berhenti: ${formatDurationHuman(slot.detik_log_berhenti)}`);
  if (slot.detik_tanpa_data > 0) parts.push(`Belum Ada Data: ${formatDurationHuman(slot.detik_tanpa_data)}`);
  if (slot.jumlah_gangguan > 0) parts.push(`Gangguan: ${slot.jumlah_gangguan} kali`);

  return parts.join("\n");
}

function formatPingSlotTooltip(slot: PingServerSlot): string {
  const mulaiDate = new Date(slot.mulai);
  const selesaiDate = new Date(slot.selesai);
  const formatTime = (d: Date) =>
    d.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const formatDate = (d: Date) =>
    d.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  const isSameDay = mulaiDate.toDateString() === selesaiDate.toDateString();
  const timeRange = isSameDay
    ? `${formatDate(mulaiDate)} ${formatTime(mulaiDate)}-${formatTime(selesaiDate)} WIB`
    : `${formatDate(mulaiDate)} ${formatTime(mulaiDate)} - ${formatDate(selesaiDate)} ${formatTime(selesaiDate)} WIB`;

  const statusLabel =
    slot.status === "up"
      ? "Up"
      : slot.status === "sebagian"
      ? "Sebagian"
      : slot.status === "down"
      ? "Down"
      : "Belum Ada Data";

  let detail = "";
  if (slot.status === "unknown") {
    detail = slot.cek_total === 0 ? "Tidak ada cek ping" : `${slot.cek_total} cek`;
  } else if (slot.status === "up") {
    detail = `${slot.cek_total} cek sukses (100%)${slot.rtt_rata_ms ? `, RTT rata-rata ${slot.rtt_rata_ms}ms` : ""}`;
  } else {
    detail = `${slot.cek_gagal} dari ${slot.cek_total} cek gagal${
      slot.gagal_terpanjang_detik > 0
        ? ` (RTO terpanjang ${formatDurationHuman(slot.gagal_terpanjang_detik)})`
        : ""
    }`;
  }

  const parts = [timeRange, statusLabel, detail];
  if (slot.sebagian_slot) {
    parts.push("(sebagian slot)");
  }
  return parts.join(" - ");
}

function formatLogSlotTooltip(slot: LogDeliverySlot): string {
  const mulaiDate = new Date(slot.mulai);
  const selesaiDate = new Date(slot.selesai);
  const formatTime = (d: Date) =>
    d.toLocaleTimeString("id-ID", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const formatDate = (d: Date) =>
    d.toLocaleDateString("id-ID", {
      timeZone: "Asia/Jakarta",
      weekday: "short",
      day: "numeric",
      month: "short",
    });

  const isSameDay = mulaiDate.toDateString() === selesaiDate.toDateString();
  const timeRange = isSameDay
    ? `${formatDate(mulaiDate)} ${formatTime(mulaiDate)}-${formatTime(selesaiDate)} WIB`
    : `${formatDate(mulaiDate)} ${formatTime(mulaiDate)} - ${formatDate(selesaiDate)} ${formatTime(selesaiDate)} WIB`;

  const statusLabel =
    slot.status === "mengirim"
      ? "Mengirim"
      : slot.status === "sebagian"
      ? "Sebagian"
      : slot.status === "tidak_mengirim"
      ? "Tidak Mengirim"
      : "Belum Ada Data";

  let detail = "";
  if (slot.status === "unknown") {
    detail = "Belum ada rekaman data log";
  } else if (slot.status === "mengirim") {
    detail = `${slot.jumlah_log.toLocaleString("id-ID")} log diterima`;
  } else if (slot.status === "sebagian") {
    detail = `${slot.jumlah_log.toLocaleString("id-ID")} log diterima (celah ${formatDurationHuman(slot.celah_terpanjang_detik)})`;
  } else {
    detail = "0 log diterima";
  }

  const parts = [timeRange, statusLabel, detail];
  if (slot.sebagian_slot) {
    parts.push("(sebagian slot)");
  }
  return parts.join(" - ");
}

function getRelativeTimeString(dateInput: Date | string): string {
  const d = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const now = new Date();
  const diffSec = Math.round((now.getTime() - d.getTime()) / 1000);

  if (diffSec < 5 && diffSec >= -5) return "baru saja";
  if (diffSec < 0) {
    const abs = Math.abs(diffSec);
    if (abs < 60) return `${abs} detik mendatang`;
    return `${Math.floor(abs / 60)} menit mendatang`;
  }
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} jam lalu`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} hari lalu`;
  return `${Math.floor(diffDays / 30)} bulan lalu`;
}

function formatLogRowTime(isoDate: string) {
  const d = new Date(isoDate);
  const currentYear = new Date().getFullYear();
  const isCurYear = d.getFullYear() === currentYear;

  const dateStr = d.toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    ...(isCurYear ? {} : { year: "numeric" }),
  });

  const timeStr = d.toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return { dateStr, timeStr };
}

function getDateDividerLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("id-ID", {
    timeZone: "Asia/Jakarta",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const SEVERITY_NAMES: Record<number, { label: string; bg: string; text: string }> = {
  0: { label: "EMERG", bg: "#FEF2F2", text: "#7F1D1D" },
  1: { label: "ALERT", bg: "#FEF2F2", text: "#991B1B" },
  2: { label: "CRIT", bg: "#FEF2F2", text: "#B91C1C" },
  3: { label: "ERR", bg: "#FEE2F2", text: "#DC2626" },
  4: { label: "WARN", bg: "#FEFCE8", text: "#854D0E" },
  5: { label: "NOTICE", bg: "#EFF6FF", text: "#1E40AF" },
  6: { label: "INFO", bg: "#F0FDF4", text: "#166534" },
  7: { label: "DEBUG", bg: "#F1F5F9", text: "#475569" },
};

export default function DeviceDetailPage() {
  const router = useRouter();
  const routeParams = useParams();
  const deviceId = (routeParams?.id as string) || "";

  // Active tab: 'ringkasan' | 'log' | 'insiden' | 'konfigurasi'
  const [activeTab, setActiveTab] = useState<"ringkasan" | "log" | "insiden" | "konfigurasi">("ringkasan");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("tab") || window.location.hash.replace("#", "");
      if (t && ["ringkasan", "log", "insiden", "konfigurasi"].includes(t)) {
        setActiveTab(t as any);
      }
    }
  }, []);

  // Core data
  const [device, setDevice] = useState<DeviceDetail | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [serverConfig, setServerConfig] = useState({ syslogUdpPort: 5514, syslogTcpPort: 5514 });
  const [isLoading, setIsLoading] = useState(true);
  const [deviceFetchStatus, setDeviceFetchStatus] = useState<"loading" | "ok" | "not_found" | "error">("loading");
  const [deviceFetchError, setDeviceFetchError] = useState<{ message: string; refId?: string } | null>(null);
  const statsCircuitBreakerRef = useRef<{ failureCount: number; openUntil: number }>({ failureCount: 0, openUntil: 0 });
  const timelineCircuitBreakerRef = useRef<{ failureCount: number; openUntil: number }>({ failureCount: 0, openUntil: 0 });
  const sseDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [isRegeneratingToken, setIsRegeneratingToken] = useState(false);
  const [isTokenConfirmModalOpen, setIsTokenConfirmModalOpen] = useState(false);
  const [isPinging, setIsPinging] = useState(false);
  const [ingestDiagnostics, setIngestDiagnostics] = useState<DeviceIngestDiagnostics | null>(null);
  const [unknownSources, setUnknownSources] = useState<UnknownSourceEntry[]>([]);
  const [hasLogsOutsideFilter, setHasLogsOutsideFilter] = useState(false);
  const [isEditIpModalOpen, setIsEditIpModalOpen] = useState(false);
  const [editIpValue, setEditIpValue] = useState("");
  const [isSavingIp, setIsSavingIp] = useState(false);

  // Tab Log state
  const [logs, setLogs] = useState<LogEventItem[]>([]);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [logTotalCount, setLogTotalCount] = useState<number | null>(null);
  const [isLogEstimated, setIsLogEstimated] = useState(false);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [logSearch, setLogSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [logRentang, setLogRentang] = useState<"15m" | "1j" | "6j" | "24j" | "7h" | "30h" | "kustom">("24j");
  const [customLogDari, setCustomLogDari] = useState("");
  const [customLogSampai, setCustomLogSampai] = useState("");
  const [logSeverities, setLogSeverities] = useState<number[]>([]); // kosong = semua
  const [logCategory, setLogCategory] = useState("all");
  const [logApp, setLogApp] = useState("");
  const [logSrcIp, setLogSrcIp] = useState("");
  const [logActor, setLogActor] = useState("");
  const [logOrder, setLogOrder] = useState<"desc" | "asc">("desc");
  const [logCursor, setLogCursor] = useState<string | null>(null);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const topLogRef = useRef<LogEventItem | null>(null);
  topLogRef.current = logs[0] || null;
  const [selectedLog, setSelectedLog] = useState<LogEventItem | null>(null);
  const [isSeverityDropdownOpen, setIsSeverityDropdownOpen] = useState(false);
  const [hideRepeatedLogs, setHideRepeatedLogs] = useState(true);
  const [mergedOrDroppedCount, setMergedOrDroppedCount] = useState(0);
  const [unseenLogCount, setUnseenLogCount] = useState(0);
  const pendingLogsRef = useRef<LogEventItem[]>([]);

  const applyPendingLogs = useCallback(() => {
    if (pendingLogsRef.current.length > 0) {
      setLogs((prev) => {
        const existingIds = new Set(prev.map((l) => String(l.id)));
        const uniqueNew = pendingLogsRef.current.filter((l) => !existingIds.has(String(l.id)));
        pendingLogsRef.current = [];
        setUnseenLogCount(0);
        return [...uniqueNew, ...prev].slice(0, 200);
      });
      window.scrollTo({ top: 380, behavior: "smooth" });
    }
  }, []);

  const [filterPrefillPattern, setFilterPrefillPattern] = useState<string | null>(null);

  // Lazy-load detail raw & parsed saat modal log dibuka
  useEffect(() => {
    if (selectedLog && (!selectedLog.raw || !selectedLog.parsed || Object.keys(selectedLog.parsed).length === 0)) {
      fetch(`/api/devices/${deviceId}/logs/${selectedLog.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (d?.log) {
            setSelectedLog((prev) => (prev && prev.id === d.log.id ? { ...prev, ...d.log } : prev));
          }
        })
        .catch(() => {});
    }
  }, [selectedLog?.id, deviceId]);

  // Tab Insiden state
  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [isIncidentsLoading, setIsIncidentsLoading] = useState(false);
  const [incidentFilterStatus, setIncidentFilterStatus] = useState("all");
  const [selectedIncident, setSelectedIncident] = useState<IncidentItem | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<any | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Daily AI state
  const [dailyAiResult, setDailyAiResult] = useState<any | null>(null);
  const [isDailyAiLoading, setIsDailyAiLoading] = useState(false);

  // Token Modal
  const [newToken, setNewToken] = useState<string | null>(null);

  // Timeline State
  const [timelineRentang, setTimelineRentang] = useState<RentangOption>("7h");
  const [timelineSkala, setTimelineSkala] = useState<SkalaOption>("otomatis");
  const [customDari, setCustomDari] = useState<string>("");
  const [customSampai, setCustomSampai] = useState<string>("");
  const [timelineData, setTimelineData] = useState<TimelineResponse | null>(null);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<{
    message: string;
    isRetryable: boolean;
  } | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<StatusSlot | null>(null);
  const [selectedPingSlot, setSelectedPingSlot] = useState<PingServerSlot | null>(null);
  const [selectedLogSlot, setSelectedLogSlot] = useState<LogDeliverySlot | null>(null);

  // Inisialisasi dari URL / LocalStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const urlRentang = sp.get("rentang") as RentangOption | null;
      const urlSkala = sp.get("skala") as SkalaOption | null;
      const urlDari = sp.get("dari") || "";
      const urlSampai = sp.get("sampai") || "";

      const savedOptions = getSafeTimelineOptions();
      const savedRentang = (savedOptions.rentang as RentangOption) || "7h";
      const savedSkala = (savedOptions.skala as SkalaOption) || "otomatis";

      const initRentang = urlRentang || savedRentang;
      const initSkala = urlSkala || savedSkala;

      if (["24j", "7h", "30h", "90h", "1t", "kustom"].includes(initRentang)) {
        setTimelineRentang(initRentang);
      }
      if (["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"].includes(initSkala)) {
        setTimelineSkala(initSkala);
      }
      if (urlDari) setCustomDari(urlDari);
      if (urlSampai) setCustomSampai(urlSampai);
    }
  }, []);

  const todayWibStr = useMemo(() => getWibDateString(new Date()), []);
  const deviceCreatedAtStr = useMemo(() => {
    if (!device?.createdAt) return "2020-01-01";
    return getWibDateString(new Date(device.createdAt));
  }, [device?.createdAt]);

  const customValidationError = useMemo(() => {
    if (timelineRentang !== "kustom") return null;
    if (!customDari || !customSampai) {
      return "Pilih tanggal awal dan akhir.";
    }
    if (customDari > customSampai) {
      return "Tanggal akhir harus sama dengan atau setelah tanggal awal.";
    }
    const s = new Date(`${customDari}T00:00:00+07:00`).getTime();
    const e = new Date(`${customSampai}T23:59:59+07:00`).getTime();
    const diffDays = (e - s) / (1000 * 3600 * 24);
    if (diffDays > 400) {
      return "Rentang maksimal 400 hari. Persempit pilihan tanggalnya.";
    }
    return null;
  }, [timelineRentang, customDari, customSampai]);

  const isApplyDisabled = Boolean(customValidationError) || isTimelineLoading;

  const dynamicValidScales = useMemo<SkalaOption[]>(() => {
    try {
      if (timelineRentang === "kustom" && (!customDari || !customSampai || customDari > customSampai)) {
        return ["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"];
      }
      const { start, end } = resolveDateRange(timelineRentang, customDari, customSampai);
      const validConcrete = getValidScalesForRange(timelineRentang, start, end);
      return ["otomatis", ...validConcrete];
    } catch {
      return ["otomatis", "15m", "30m", "1j", "4j", "6j", "1h", "1m", "1b"];
    }
  }, [timelineRentang, customDari, customSampai]);

  const timelineFetchRef = useRef<number>(0);

  const fetchTimeline = useCallback(
    async (
      targetRentang = timelineRentang,
      targetSkala = timelineSkala,
      targetDari = customDari,
      targetSampai = customSampai,
      isManual = false
    ) => {
      if (!deviceId) return;
      if (targetRentang === "kustom") {
        if (!targetDari || !targetSampai || targetDari > targetSampai) {
          return;
        }
      }

      // Circuit breaker: jika sudah 3 kali gagal berturut-turut, tahan request otomatis selama 30 detik
      const now = Date.now();
      if (!isManual && now < timelineCircuitBreakerRef.current.openUntil) {
        return;
      }

      if (isManual) {
        timelineCircuitBreakerRef.current.failureCount = 0;
        timelineCircuitBreakerRef.current.openUntil = 0;
      }

      const seq = ++timelineFetchRef.current;
      setIsTimelineLoading(true);
      setTimelineError(null);

      const maxAttempts = isManual ? 2 : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const sp = new URLSearchParams();
          sp.set("rentang", targetRentang);
          sp.set("skala", targetSkala);
          if (targetRentang === "kustom") {
            if (targetDari) sp.set("dari", targetDari);
            if (targetSampai) sp.set("sampai", targetSampai);
          }

          const res = await fetch(`/api/devices/${deviceId}/riwayat-status?${sp.toString()}`);
          const data = await res.json();

          if (seq !== timelineFetchRef.current) return;

          if (!res.ok) {
            // 4xx tidak di-retry
            if (res.status < 500) {
              setTimelineError({
                message: data.error || "Parameter riwayat status tidak valid.",
                isRetryable: false,
              });
              return;
            }

            // Jika masih ada percobaan retry
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
              continue;
            }

            // Kegagalan pada batas attempt
            timelineCircuitBreakerRef.current.failureCount++;
            if (timelineCircuitBreakerRef.current.failureCount >= 3) {
              timelineCircuitBreakerRef.current.openUntil = Date.now() + 30000;
            }

            setTimelineError({
              message: data.error || "Gagal memuat riwayat status.",
              isRetryable: true,
            });
            return;
          }

          // Sukses: reset circuit breaker
          timelineCircuitBreakerRef.current.failureCount = 0;
          timelineCircuitBreakerRef.current.openUntil = 0;
          setTimelineData(data);
          setTimelineError(null);
          return;
        } catch (err) {
          if (seq !== timelineFetchRef.current) return;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
            continue;
          }
          timelineCircuitBreakerRef.current.failureCount++;
          if (timelineCircuitBreakerRef.current.failureCount >= 3) {
            timelineCircuitBreakerRef.current.openUntil = Date.now() + 30000;
          }
          setTimelineError({
            message: "Gagal memuat riwayat status. Coba lagi.",
            isRetryable: true,
          });
        } finally {
          if (seq === timelineFetchRef.current) {
            setIsTimelineLoading(false);
          }
        }
      }
    },
    [deviceId, timelineRentang, timelineSkala, customDari, customSampai]
  );

  useEffect(() => {
    fetchTimeline(timelineRentang, timelineSkala, customDari, customSampai);
  }, [timelineRentang, timelineSkala]);

  const handleRentangChange = (newRentang: RentangOption) => {
    setTimelineRentang(newRentang);
    setSelectedSlot(null);
    setTimelineError(null);

    let nextSkala = timelineSkala;
    let d = customDari;
    let s = customSampai;

    if (newRentang === "kustom") {
      if (!d || !s) {
        const todayStr = getWibDateString();
        d = todayStr;
        s = todayStr;
        setCustomDari(d);
        setCustomSampai(s);
      }
    }

    // Periksa apakah skala manual masih valid untuk rentang baru
    if (timelineSkala !== "otomatis") {
      const { start, end } = resolveDateRange(newRentang, d, s);
      const validScales = getValidScalesForRange(newRentang, start, end);
      if (!validScales.includes(timelineSkala as any)) {
        nextSkala = "otomatis";
        setTimelineSkala("otomatis");
        setToast({
          message: "Skala disesuaikan ke Otomatis karena rentang berubah.",
          type: "info",
        });
      }
    }

    if (typeof window !== "undefined") {
      setSafeTimelineOptions({ rentang: newRentang, skala: nextSkala });
      const url = new URL(window.location.href);
      url.searchParams.set("rentang", newRentang);
      url.searchParams.set("skala", nextSkala);
      if (newRentang === "kustom") {
        if (d) url.searchParams.set("dari", d);
        if (s) url.searchParams.set("sampai", s);
      } else {
        url.searchParams.delete("dari");
        url.searchParams.delete("sampai");
      }
      window.history.replaceState({}, "", url.toString());
    }

    fetchTimeline(newRentang, nextSkala, d, s);
  };

  const handleApplyCustom = () => {
    if (isApplyDisabled) return;
    setSelectedSlot(null);
    setTimelineError(null);

    let nextSkala = timelineSkala;
    if (timelineSkala !== "otomatis") {
      const { start, end } = resolveDateRange("kustom", customDari, customSampai);
      const validScales = getValidScalesForRange("kustom", start, end);
      if (!validScales.includes(timelineSkala as any)) {
        nextSkala = "otomatis";
        setTimelineSkala("otomatis");
        setToast({
          message: "Skala disesuaikan ke Otomatis karena rentang berubah.",
          type: "info",
        });
      }
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("rentang", "kustom");
      url.searchParams.set("skala", nextSkala);
      url.searchParams.set("dari", customDari);
      url.searchParams.set("sampai", customSampai);
      setSafeTimelineOptions({ skala: nextSkala });
      window.history.replaceState({}, "", url.toString());
    }

    fetchTimeline("kustom", nextSkala, customDari, customSampai);
  };

  const handleSkalaChange = (newSkala: SkalaOption) => {
    setTimelineSkala(newSkala);
    setSelectedSlot(null);
    setTimelineError(null);
    if (typeof window !== "undefined") {
      setSafeTimelineOptions({ skala: newSkala });
      const url = new URL(window.location.href);
      url.searchParams.set("skala", newSkala);
      window.history.replaceState({}, "", url.toString());
    }
    fetchTimeline(timelineRentang, newSkala, customDari, customSampai);
  };


  // 1. Fetch Stats & Device Detail dengan Circuit Breaker dan batas retry
  const fetchStats = useCallback(
    async (isManual = false) => {
      const now = Date.now();
      if (!isManual && now < statsCircuitBreakerRef.current.openUntil) {
        return;
      }

      if (isManual) {
        statsCircuitBreakerRef.current.failureCount = 0;
        statsCircuitBreakerRef.current.openUntil = 0;
      }

      const maxAttempts = isManual ? 2 : 1;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const res = await fetch(`/api/devices/${deviceId}/stats`);
          const data = await res.json();
          if (!res.ok) {
            if (res.status === 404) {
              setDeviceFetchStatus("not_found");
              setErrorMessage(data.error || "Perangkat tidak ditemukan.");
              return;
            }

            // Status 4xx tidak di-retry
            if (res.status < 500) {
              setDeviceFetchStatus("error");
              setDeviceFetchError({
                message: data.error || "Gagal memuat data perangkat.",
                refId: data.ref_id,
              });
              setErrorMessage(data.error || "Gagal memuat data perangkat.");
              return;
            }

            // Jika masih ada percobaan retry
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
              continue;
            }

            // Gagal mencapai batas retry: catat circuit breaker
            statsCircuitBreakerRef.current.failureCount++;
            if (statsCircuitBreakerRef.current.failureCount >= 3) {
              statsCircuitBreakerRef.current.openUntil = Date.now() + 30000;
            }

            // Upayakan ambil data dasar perangkat agar header tetap tampil walau statistik gagal
            try {
              const devFallbackRes = await fetch(`/api/devices/${deviceId}`);
              if (devFallbackRes.ok) {
                const devFallbackData = await devFallbackRes.json();
                if (devFallbackData?.device) {
                  setDevice(devFallbackData.device);
                }
              }
            } catch {
              // Abaikan jika fallback jaringan juga gagal
            }

            setDeviceFetchStatus("error");
            setDeviceFetchError({
              message: data.error || "Gagal memuat statistik perangkat.",
              refId: data.ref_id,
            });
            setErrorMessage(data.error || "Gagal memuat statistik perangkat.");
            return;
          }

          // Sukses: reset circuit breaker
          statsCircuitBreakerRef.current.failureCount = 0;
          statsCircuitBreakerRef.current.openUntil = 0;

          setDevice(data.device);
          setStats(data);
          setDeviceFetchStatus("ok");
          setDeviceFetchError(null);
          if (data.serverConfig) setServerConfig(data.serverConfig);
          if (data.latestDailyAnalysis) setDailyAiResult(data.latestDailyAnalysis);
          if (data.ingestDiagnostics) setIngestDiagnostics(data.ingestDiagnostics);
          if (Array.isArray(data.unknownSources)) setUnknownSources(data.unknownSources);
          return;
        } catch (err: any) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 600 + Math.random() * 300));
            continue;
          }

          statsCircuitBreakerRef.current.failureCount++;
          if (statsCircuitBreakerRef.current.failureCount >= 3) {
            statsCircuitBreakerRef.current.openUntil = Date.now() + 30000;
          }

          // Upayakan ambil data dasar perangkat agar header tetap tampil walau statistik gagal
          try {
            const devFallbackRes = await fetch(`/api/devices/${deviceId}`);
            if (devFallbackRes.ok) {
              const devFallbackData = await devFallbackRes.json();
              if (devFallbackData?.device) {
                setDevice(devFallbackData.device);
              }
            }
          } catch {
            // Abaikan jika fallback jaringan juga gagal
          }

          console.error("fetchStats error:", err);
          setDeviceFetchStatus("error");
          setDeviceFetchError({ message: "Tidak dapat terhubung ke server." });
          setErrorMessage("Tidak dapat terhubung ke server.");
        } finally {
          setIsLoading(false);
        }
      }
    },
    [deviceId]
  );

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Debounce input pencarian teks 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(logSearch);
    }, 400);
    return () => clearTimeout(timer);
  }, [logSearch]);

  // Validasi rentang kustom log
  const customLogValidationError = useMemo(() => {
    if (logRentang !== "kustom") return null;
    if (!customLogDari || !customLogSampai) {
      return "Pilih waktu awal dan akhir (WIB).";
    }
    const s = new Date(customLogDari).getTime();
    const e = new Date(customLogSampai).getTime();
    if (isNaN(s) || isNaN(e)) {
      return "Format tanggal & waktu tidak valid.";
    }
    if (s > e) {
      return "Waktu awal harus sebelum atau sama dengan waktu akhir.";
    }
    return null;
  }, [logRentang, customLogDari, customLogSampai]);

  // Hitung rentang waktu log (from - to)
  const getLogTimeRange = useCallback(() => {
    if (logRentang === "kustom") {
      return {
        from: customLogDari ? new Date(customLogDari).toISOString() : undefined,
        to: customLogSampai ? new Date(customLogSampai).toISOString() : undefined,
      };
    }
    const now = Date.now();
    let ms = 24 * 60 * 60 * 1000;
    if (logRentang === "15m") ms = 15 * 60 * 1000;
    else if (logRentang === "1j") ms = 60 * 60 * 1000;
    else if (logRentang === "6j") ms = 6 * 60 * 60 * 1000;
    else if (logRentang === "24j") ms = 24 * 60 * 60 * 1000;
    else if (logRentang === "7h") ms = 7 * 24 * 60 * 60 * 1000;
    else if (logRentang === "30h") ms = 30 * 24 * 60 * 60 * 1000;

    return {
      from: new Date(now - ms).toISOString(),
      to: undefined,
    };
  }, [logRentang, customLogDari, customLogSampai]);

  // Inisialisasi filter dari URL saat pertama kali load
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const r = sp.get("rentang");
    if (r && ["15m", "1j", "6j", "24j", "7h", "30h", "kustom"].includes(r)) {
      setLogRentang(r as any);
    }
    const d = sp.get("dari");
    const s = sp.get("sampai");
    if (d) setCustomLogDari(d);
    if (s) setCustomLogSampai(s);
    const sev = sp.get("severity");
    if (sev) {
      const parsed = sev.split(",").map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 7);
      if (parsed.length > 0) setLogSeverities(parsed);
    }
    const kat = sp.get("kategori") || sp.get("category");
    if (kat) setLogCategory(kat);
    const q = sp.get("q") || sp.get("search");
    if (q) {
      setLogSearch(q);
      setDebouncedSearch(q);
    }
    const app = sp.get("app");
    if (app) setLogApp(app);
    const ip = sp.get("ip") || sp.get("srcIp");
    if (ip) setLogSrcIp(ip);
    const act = sp.get("actor");
    if (act) setLogActor(act);
    const ord = sp.get("order");
    if (ord === "asc" || ord === "desc") setLogOrder(ord);
  }, []);

  // Sinkronisasi state filter log ke URL query params
  useEffect(() => {
    if (typeof window === "undefined" || activeTab !== "log") return;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", "log");
    if (logRentang) url.searchParams.set("rentang", logRentang);
    if (logRentang === "kustom") {
      if (customLogDari) url.searchParams.set("dari", customLogDari);
      if (customLogSampai) url.searchParams.set("sampai", customLogSampai);
    } else {
      url.searchParams.delete("dari");
      url.searchParams.delete("sampai");
    }
    if (logSeverities.length > 0) {
      url.searchParams.set("severity", logSeverities.join(","));
    } else {
      url.searchParams.delete("severity");
    }
    if (logCategory !== "all") {
      url.searchParams.set("kategori", logCategory);
    } else {
      url.searchParams.delete("kategori");
    }
    if (debouncedSearch) {
      url.searchParams.set("q", debouncedSearch);
    } else {
      url.searchParams.delete("q");
    }
    if (logApp) url.searchParams.set("app", logApp);
    else url.searchParams.delete("app");
    if (logSrcIp) url.searchParams.set("ip", logSrcIp);
    else url.searchParams.delete("ip");
    if (logActor) url.searchParams.set("actor", logActor);
    else url.searchParams.delete("actor");
    if (logOrder !== "desc") url.searchParams.set("order", logOrder);
    else url.searchParams.delete("order");

    window.history.replaceState({}, "", url.toString());
  }, [
    activeTab,
    logRentang,
    customLogDari,
    customLogSampai,
    logSeverities,
    logCategory,
    debouncedSearch,
    logApp,
    logSrcIp,
    logActor,
    logOrder,
  ]);

  // 2. Fetch Logs
  const fetchLogs = useCallback(
    async (cursor?: string | null, append = false) => {
      if (logRentang === "kustom" && customLogValidationError) {
        return;
      }
      setIsLogsLoading(true);
      try {
        const query = new URLSearchParams();
        if (debouncedSearch) query.append("search", debouncedSearch);
        if (logSeverities.length > 0) {
          query.append("severity", logSeverities.join(","));
        }
        if (logCategory !== "all") query.append("category", logCategory);
        if (logApp) query.append("app", logApp);
        if (logSrcIp) query.append("srcIp", logSrcIp);
        if (logActor) query.append("actor", logActor);
        query.append("order", logOrder);

        if (!isLiveMode) {
          const { from, to } = getLogTimeRange();
          if (from) query.append("from", from);
          if (to) query.append("to", to);
        }

        if (cursor) query.append("cursor", cursor);
        query.append("limit", "50");

        const res = await fetch(`/api/devices/${deviceId}/logs?${query.toString()}`);
        const data = await res.json();

        if (res.ok) {
          if (append) {
            setLogs((prev) => [...prev, ...(data.logs || [])]);
          } else {
            setLogs(data.logs || []);
          }
          setLogCursor(data.nextCursor || null);
          setHasMoreLogs(Boolean(data.nextCursor));
          if (typeof data.totalCount === "number") {
            setLogTotalCount(data.totalCount);
            setIsLogEstimated(Boolean(data.isEstimated));
          }
          setSearchWarning(data.searchWarning || null);
          if (typeof data.mergedOrDroppedCount === "number") {
            setMergedOrDroppedCount(data.mergedOrDroppedCount);
          }
          if (typeof data.hasLogsOutsideFilter === "boolean") {
            setHasLogsOutsideFilter(data.hasLogsOutsideFilter);
          }
          if (data.ingestDiagnostics) {
            setIngestDiagnostics(data.ingestDiagnostics);
          }
        }
      } catch (err) {
        console.error("Gagal memuat log:", err);
      } finally {
        setIsLogsLoading(false);
      }
    },
    [
      deviceId,
      debouncedSearch,
      logSeverities,
      logCategory,
      logApp,
      logSrcIp,
      logActor,
      logOrder,
      isLiveMode,
      getLogTimeRange,
      logRentang,
      customLogValidationError,
    ]
  );

  // Trigger logs on tab change or filter change (non-append)
  useEffect(() => {
    if (activeTab === "log") {
      fetchLogs(null, false);
    }
  }, [
    activeTab,
    debouncedSearch,
    logSeverities,
    logCategory,
    logApp,
    logSrcIp,
    logActor,
    logRentang,
    customLogDari,
    customLogSampai,
    logOrder,
  ]);

  // Ambil log baru dengan kursor since saat ada event log.baru
  const fetchNewLogsCursor = useCallback(async () => {
    if (activeTab !== "log" || !isLiveMode) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const topLog = topLogRef.current;
    const sinceParam = topLog ? `${topLog.eventTime}|${topLog.id}` : null;

    const query = new URLSearchParams();
    if (debouncedSearch) query.append("search", debouncedSearch);
    if (logSeverities.length > 0) query.append("severity", logSeverities.join(","));
    if (logCategory !== "all") query.append("category", logCategory);
    if (logApp) query.append("app", logApp);
    if (logSrcIp) query.append("srcIp", logSrcIp);
    if (logActor) query.append("actor", logActor);
    if (sinceParam) query.append("since", sinceParam);
    query.append("order", "desc");
    query.append("limit", "50");

    try {
      const res = await fetch(`/api/devices/${deviceId}/logs?${query.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const incoming: LogEventItem[] = data.logs || [];
        if (incoming.length > 0) {
          const isScrolledDown = typeof window !== "undefined" && window.scrollY > 350;
          const isCurrentTime = logRentang !== "kustom" || !customLogSampai;

          if (isScrolledDown || !isCurrentTime) {
            // Pengguna sedang scroll ke bawah atau filter di masa lalu: jangan ganggu posisi pengguna
            const existingPendingIds = new Set(pendingLogsRef.current.map((l) => String(l.id)));
            const newForPending = incoming.filter((l) => !existingPendingIds.has(String(l.id)));
            if (newForPending.length > 0) {
              pendingLogsRef.current = [...newForPending, ...pendingLogsRef.current];
              setUnseenLogCount((c) => c + newForPending.length);
            }
          } else {
            // Pengguna di bagian atas & waktu terkini: sisipkan baris baru di atas
            setLogs((prev) => {
              const existingIds = new Set(prev.map((l) => String(l.id)));
              const uniqueNew = incoming.filter((l) => !existingIds.has(String(l.id)));
              if (uniqueNew.length === 0) return prev;
              return [...uniqueNew, ...prev].slice(0, 200);
            });
          }

          if (typeof data.totalCount === "number") {
            setLogTotalCount(data.totalCount);
          }
        }
      }
    } catch (err) {
      console.warn("Live fetch cursor error:", err);
    }
  }, [
    activeTab,
    isLiveMode,
    deviceId,
    debouncedSearch,
    logSeverities,
    logCategory,
    logApp,
    logSrcIp,
    logActor,
    logRentang,
    customLogSampai,
  ]);

  // 3. Fetch Incidents for this device
  const fetchIncidents = useCallback(async () => {
    setIsIncidentsLoading(true);
    try {
      const query = new URLSearchParams({ deviceId });
      if (incidentFilterStatus !== "all") query.append("status", incidentFilterStatus);

      const res = await fetch(`/api/incidents?${query.toString()}`);
      const data = await res.json();
      if (res.ok && data.incidents) {
        setIncidents(data.incidents);
      }
    } catch (err) {
      console.error("Gagal memuat insiden:", err);
    } finally {
      setIsIncidentsLoading(false);
    }
  }, [deviceId, incidentFilterStatus]);

  useEffect(() => {
    if (activeTab === "insiden") {
      fetchIncidents();
    }
  }, [activeTab, fetchIncidents]);

  const { status: liveStatus, subscribe } = useLiveUpdates();

  // Berlangganan event SSE untuk detail perangkat ini
  useEffect(() => {
    // 1. Log baru masuk
    const unsubLog = subscribe("log.baru", (evt) => {
      if (evt.perangkat_id === deviceId) {
        fetchNewLogsCursor();
      }
    });

    // 2. Perubahan status perangkat
    const unsubStatus = subscribe("perangkat.status", (evt) => {
      if (evt.perangkat_id === deviceId) {
        setDevice((prev) =>
          prev
            ? {
                ...prev,
                status: (evt.data_ringkas?.status_perangkat as any) ?? prev.status,
                lastPingOk: evt.data_ringkas?.ping_ok ?? prev.lastPingOk,
                lastPingRtt:
                  evt.data_ringkas?.ping_rtt !== undefined
                    ? evt.data_ringkas.ping_rtt
                    : prev.lastPingRtt,
                statusChangedAt: evt.waktu || prev.statusChangedAt,
              }
            : prev
        );
        if (activeTab === "ringkasan") {
          fetchTimeline();
        }
      }
    });

    // 3. Update ping RTT
    const unsubPing = subscribe("perangkat.ping", (evt) => {
      if (evt.perangkat_id === deviceId) {
        setDevice((prev) =>
          prev
            ? {
                ...prev,
                lastPingOk: evt.data_ringkas?.ping_ok ?? prev.lastPingOk,
                lastPingRtt:
                  evt.data_ringkas?.ping_rtt !== undefined
                    ? evt.data_ringkas.ping_rtt
                    : prev.lastPingRtt,
                lastPingAt: evt.waktu || prev.lastPingAt,
              }
            : prev
        );
      }
    });

    // 4. Perangkat diubah atau dihapus
    const unsubDevice = subscribe("perangkat.diubah", (evt) => {
      if (evt.perangkat_id === deviceId) {
        if (evt.data_ringkas?.deleted) {
          router.push("/perangkat");
        } else {
          fetchStats();
        }
      }
    });

    // 5. Insiden dibuat/diubah
    const unsubIncident = subscribe("insiden.berubah", (evt) => {
      if (evt.perangkat_id === deviceId) {
        if (activeTab === "insiden") {
          fetchIncidents();
        }
        fetchStats();
      }
    });

    // 6. Analisa AI selesai
    const unsubAi = subscribe("analisa.selesai", (evt) => {
      if (evt.perangkat_id === deviceId) {
        fetchStats();
      }
    });

    // 7. Statistik & baris pengiriman log per jam diperbarui (dengan debounce 600ms)
    const fetchTimelineDebounced = () => {
      if (sseDebounceTimerRef.current) clearTimeout(sseDebounceTimerRef.current);
      sseDebounceTimerRef.current = setTimeout(() => {
        fetchTimeline();
      }, 600);
    };

    const unsubHourly = subscribe("statistik.diperbarui", (evt) => {
      if (evt.perangkat_id === deviceId && activeTab === "ringkasan") {
        fetchTimelineDebounced();
      }
    });
    const unsubLogShip = subscribe("pengiriman_log.berubah", (evt) => {
      if (evt.perangkat_id === deviceId && activeTab === "ringkasan") {
        fetchTimelineDebounced();
      }
    });

    // 8. Resync penuh
    const unsubResync = subscribe("resync", () => {
      fetchStats();
      if (activeTab === "log") fetchLogs();
      if (activeTab === "ringkasan") fetchTimelineDebounced();
      if (activeTab === "insiden") fetchIncidents();
    });

    return () => {
      if (sseDebounceTimerRef.current) clearTimeout(sseDebounceTimerRef.current);
      unsubLog();
      unsubStatus();
      unsubPing();
      unsubDevice();
      unsubIncident();
      unsubAi();
      unsubHourly();
      unsubLogShip();
      unsubResync();
    };
  }, [
    deviceId,
    subscribe,
    activeTab,
    fetchNewLogsCursor,
    fetchTimeline,
    fetchIncidents,
    fetchStats,
    fetchLogs,
    router,
  ]);

  // Fallback polling Tab Log: HANYA jika mode Live aktif dan status koneksi fallback_polling
  useEffect(() => {
    if (activeTab === "log" && isLiveMode && liveStatus === "fallback_polling") {
      liveIntervalRef.current = setInterval(() => {
        fetchNewLogsCursor();
      }, 15000);
    } else {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [activeTab, isLiveMode, liveStatus, fetchNewLogsCursor]);

  // AI Analysis for Incident
  const handleAnalyzeIncident = async (incidentId: string, force = false) => {
    setIsAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, force }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || "Gagal memproses analisa AI.");
        return;
      }
      setAiAnalysis(data.analysis);
    } catch (err) {
      console.error(err);
      setAiError("Terjadi kesalahan jaringan.");
    } finally {
      setIsAiLoading(false);
    }
  };

  // AI Daily Summary Trigger
  const handleRunDailyAi = async () => {
    setIsDailyAiLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, mode: "daily" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Gagal membuat ringkasan AI harian.");
        return;
      }
      setDailyAiResult(data.analysis);
      setSuccessMessage("Ringkasan analisa AI harian berhasil dibuat.");
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan saat analisa harian.");
    } finally {
      setIsDailyAiLoading(false);
    }
  };

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeletingDevice, setIsDeletingDevice] = useState(false);

  // Status Change for Incident
  const handleUpdateIncidentStatus = async (id: string, newStatus: "open" | "ack" | "closed") => {
    try {
      const res = await fetch("/api/incidents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || "Gagal mengubah status insiden.", type: "error" });
        return;
      }
      fetchIncidents();
      if (selectedIncident && selectedIncident.id === id) {
        setSelectedIncident({ ...selectedIncident, status: newStatus });
      }
      setToast({ message: `Status insiden berhasil diubah ke '${newStatus}'.`, type: "success" });
    } catch (err) {
      console.error("handleUpdateIncidentStatus error:", err);
      setToast({ message: "Terjadi kesalahan jaringan.", type: "error" });
    }
  };

  // Delete device via modal
  const handleExecuteDeleteDevice = async () => {
    if (!device || isDeletingDevice) return;
    setIsDeletingDevice(true);

    try {
      const res = await fetch(`/api/devices/${deviceId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal menghapus perangkat.",
          type: "error",
        });
        setIsDeleteModalOpen(false);
        return;
      }

      setToast({
        message: `Perangkat '${device.name}' berhasil dihapus.`,
        type: "success",
      });
      setIsDeleteModalOpen(false);
      setTimeout(() => {
        router.push("/perangkat");
      }, 500);
    } catch (err) {
      console.error("handleDeleteDevice error:", err);
      setToast({
        message: "Terjadi kesalahan jaringan saat menghapus perangkat.",
        type: "error",
      });
      setIsDeleteModalOpen(false);
    } finally {
      setIsDeletingDevice(false);
    }
  };

  // Execute Regenerate Token via modal
  const handleExecuteRegenerateToken = async () => {
    if (!device) return;
    setIsRegeneratingToken(true);

    try {
      const res = await fetch(`/api/devices/${deviceId}/token`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal membuat ulang token perangkat.",
          type: "error",
        });
        setIsTokenConfirmModalOpen(false);
        return;
      }

      setIsTokenConfirmModalOpen(false);
      if (data.ingestToken) {
        setNewToken(data.ingestToken);
        setToast({
          message: `Token ingest baru untuk '${device.name}' berhasil dibuat.`,
          type: "success",
        });
      }
    } catch (err) {
      console.error("handleRegenerateToken error:", err);
      setToast({
        message: "Terjadi kesalahan jaringan saat membuat token.",
        type: "error",
      });
      setIsTokenConfirmModalOpen(false);
    } finally {
      setIsRegeneratingToken(false);
    }
  };

  // Toggle active status (Optimistic update < 10ms)
  const handleToggleStatus = async () => {
    if (!device || isTogglingStatus) return;
    const nextActive = !device.isActive;
    const actionVerb = nextActive ? "diaktifkan" : "dinonaktifkan";

    // 1. Optimistic update
    setDevice((prev) =>
      prev
        ? {
            ...prev,
            isActive: nextActive,
            status: nextActive ? prev.status : "unknown",
            isOnline: nextActive ? prev.isOnline : false,
            lastPingOk: nextActive ? prev.lastPingOk : null,
            lastPingRtt: nextActive ? prev.lastPingRtt : null,
          }
        : null
    );
    setIsTogglingStatus(true);

    try {
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });

      const data = await res.json();
      if (!res.ok) {
        // Rollback
        setDevice((prev) => (prev ? { ...prev, isActive: !nextActive } : null));
        setToast({
          message: data.error || `Gagal ${actionVerb} perangkat '${device.name}'.`,
          type: "error",
        });
        return;
      }

      setToast({
        message: `Perangkat '${device.name}' berhasil ${actionVerb}.`,
        type: "success",
      });
      fetchStats(true);
      if (activeTab === "log") {
        fetchLogs(null, false);
      }
    } catch (err) {
      console.error("handleToggleStatus error:", err);
      // Rollback
      setDevice((prev) => (prev ? { ...prev, isActive: !nextActive } : null));
      setToast({
        message: "Terjadi kesalahan jaringan saat memperbarui status.",
        type: "error",
      });
    } finally {
      setIsTogglingStatus(false);
    }
  };

  // Ping device on-demand
  const handlePingDevice = async () => {
    if (!device?.isActive) {
      setToast({
        message: "Perangkat berstatus Nonaktif. Aktifkan perangkat terlebih dahulu untuk melakukan tes ping.",
        type: "error",
      });
      return;
    }
    if (!device?.ipAddress) {
      setToast({
        message: "Perangkat ini tidak memiliki alamat IP terdaftar untuk diping.",
        type: "error",
      });
      return;
    }
    setIsPinging(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/ping`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal melakukan tes ping.",
          type: "error",
        });
        return;
      }
      setToast({
        message:
          data.message ||
          (data.isAlive ? "Ping berhasil: Perangkat UP" : "Ping gagal: Perangkat DOWN"),
        type: data.isAlive ? "success" : "error",
      });
      fetchStats();
    } catch (err) {
      console.error("handlePingDevice error:", err);
      setToast({
        message: "Gagal menghubungi server untuk melakukan tes ping.",
        type: "error",
      });
    } finally {
      setIsPinging(false);
    }
  };

  // Simpan IP Perangkat dari Modal Edit IP
  const handleSaveDeviceIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device || isSavingIp) return;
    setIsSavingIp(true);
    try {
      const trimmedIp = editIpValue.trim() || null;
      const res = await fetch(`/api/devices/${deviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ipAddress: trimmedIp }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({
          message: data.error || "Gagal memperbarui alamat IP perangkat.",
          type: "error",
        });
        return;
      }
      setDevice((prev) => (prev ? { ...prev, ipAddress: trimmedIp } : prev));
      setIsEditIpModalOpen(false);
      setToast({
        message: trimmedIp
          ? `Alamat IP sumber perangkat berhasil diatur ke ${trimmedIp}.`
          : "Alamat IP sumber perangkat dihapus.",
        type: "success",
      });
      fetchStats(true);
      if (activeTab === "log") {
        fetchLogs(null, false);
      }
    } catch {
      setToast({
        message: "Terjadi kesalahan jaringan saat menyimpan alamat IP.",
        type: "error",
      });
    } finally {
      setIsSavingIp(false);
    }
  };


  const maxHourly = stats?.hourlyVolume?.reduce((m, d) => Math.max(m, d.count), 1) || 1;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1200px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Breadcrumb */}
        <div style={{ marginBottom: "16px", fontSize: "13px", color: "var(--text-secondary)" }}>
          <Link href="/perangkat" style={{ color: "var(--accent-blue)", textDecoration: "none" }}>
            &larr; Kembali ke Daftar Perangkat
          </Link>
        </div>

        {errorMessage && deviceFetchStatus !== "error" && deviceFetchStatus !== "not_found" && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#FEF2F2",
              border: "1px solid #FCA5A5",
              borderLeft: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              color: "#991B1B",
            }}
          >
            {errorMessage}
          </div>
        )}

        {successMessage && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#F0FDF4",
              border: "1px solid #86EFAC",
              borderLeft: "3px solid #16A34A",
              borderRadius: "var(--radius-sm)",
              fontSize: "13px",
              color: "#166534",
            }}
          >
            {successMessage}
          </div>
        )}

        {isLoading ? (
          <div
            style={{
              padding: "48px",
              textAlign: "center",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            Memuat detail dan statistik perangkat...
          </div>
        ) : deviceFetchStatus === "not_found" ? (
          <div
            style={{
              padding: "48px",
              textAlign: "center",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: "13px",
            }}
          >
            Perangkat tidak ditemukan.
          </div>
        ) : deviceFetchStatus === "error" && !device ? (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-main)",
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>
              Gagal Memuat Data Perangkat
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              {deviceFetchError?.message || "Terjadi kesalahan pada server saat mengambil data perangkat."}
              {deviceFetchError?.refId && (
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  ID Referensi: {deviceFetchError.refId}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setIsLoading(true);
                fetchStats(true);
              }}
              style={{
                padding: "8px 18px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "var(--accent-blue)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Coba Lagi
            </button>
          </div>
        ) : !device ? (
          <div
            style={{
              padding: "40px 24px",
              textAlign: "center",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderTop: "3px solid var(--accent-red)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-main)",
            }}
          >
            <div style={{ fontSize: "15px", fontWeight: 700, marginBottom: "8px" }}>
              Gagal Memuat Data Perangkat
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              {deviceFetchError?.message || "Data perangkat tidak dapat dimuat saat ini."}
              {deviceFetchError?.refId && (
                <span style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                  ID Referensi: {deviceFetchError.refId}
                </span>
              )}
            </div>
            <button
              onClick={() => {
                setIsLoading(true);
                fetchStats(true);
              }}
              style={{
                padding: "8px 18px",
                fontSize: "12px",
                fontWeight: 600,
                color: "#FFFFFF",
                backgroundColor: "var(--accent-blue)",
                border: "none",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              Coba Lagi
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Header Perangkat Banner */}
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                borderTop: "3px solid var(--accent-blue)",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.4px" }}>
                      {device.name}
                    </h1>
                    <span
                      style={{
                        fontSize: "11px",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        backgroundColor: "#F1F5F9",
                        color: "#334155",
                        fontWeight: 600,
                        textTransform: "uppercase",
                      }}
                    >
                      {device.type}
                    </span>
                    {(() => {
                      if (!device.isActive) {
                        return (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                fontSize: "12px",
                                fontWeight: 700,
                                color: "#991B1B",
                                backgroundColor: "#FEF2F2",
                                border: "1px solid #FECACA",
                                borderRadius: "4px",
                                padding: "2px 8px",
                              }}
                            >
                              <span
                                style={{
                                  width: "7px",
                                  height: "7px",
                                  borderRadius: "50%",
                                  backgroundColor: "#EF4444",
                                }}
                              />
                              Nonaktif
                            </span>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                              (Tidak menerima log & tidak diping)
                            </span>
                          </div>
                        );
                      }

                      const st = device.status || (device.isOnline ? "online" : "unknown");
                      const config = {
                        online: { label: "UP • Online", color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0", dot: "#22C55E" },
                        log_stopped: { label: "UP • Log Berhenti", color: "#B45309", bg: "#FEFCE8", border: "#FEF08A", dot: "#EAB308" },
                        offline: { label: "DOWN • Offline", color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", dot: "#EF4444" },
                        rto: { label: "RTO", color: "#B91C1C", bg: "#FEF2F2", border: "#FECACA", dot: "#EF4444" },
                        unknown: { label: "Menunggu Data", color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0", dot: "#94A3B8" },
                      }[st] || { label: st, color: "#64748B", bg: "#F1F5F9", border: "#E2E8F0", dot: "#94A3B8" };

                      const diffMs = device.statusChangedAt ? Date.now() - new Date(device.statusChangedAt).getTime() : 0;
                      const diffMins = Math.floor(diffMs / 60000);
                      const timeStr = diffMins < 1 ? "baru saja" : diffMins < 60 ? `${diffMins} menit lalu` : `${Math.floor(diffMins / 60)} jam lalu`;
                      const labelText = st === "rto" ? `RTO sejak ${timeStr}` : config.label;

                      return (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "6px",
                              fontSize: "12px",
                              fontWeight: 700,
                              color: config.color,
                              backgroundColor: config.bg,
                              border: `1px solid ${config.border}`,
                              borderRadius: "4px",
                              padding: "2px 8px",
                            }}
                          >
                            <span
                              style={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                backgroundColor: config.dot,
                              }}
                            />
                            {labelText}
                          </span>
                          {device.lastPingRtt !== null && device.lastPingRtt !== undefined && (
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                              ({device.lastPingRtt} ms)
                            </span>
                          )}
                          {device.statusChangedAt && st !== "rto" && (
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                              (sejak {timeStr})
                            </span>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "6px" }}>
                    Metode Penerimaan:{" "}
                    {device.ipAddress ? (
                      <strong className="font-mono" style={{ color: "var(--text-main)" }}>
                        Syslog dari IP {device.ipAddress}
                      </strong>
                    ) : device.type === "windows" ? (
                      <strong style={{ color: "var(--text-main)" }}>HTTP Ingest dengan token</strong>
                    ) : device.hasIngestToken ? (
                      <strong style={{ color: "var(--text-main)" }}>
                        Belum dikonfigurasi IP Syslog (HTTP Ingest dengan token tersedia)
                      </strong>
                    ) : (
                      <strong style={{ color: "var(--accent-red)" }}>Belum dikonfigurasi</strong>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditIpValue(device.ipAddress || "");
                        setIsEditIpModalOpen(true);
                      }}
                      style={{
                        marginLeft: "6px",
                        padding: "1px 6px",
                        fontSize: "11px",
                        fontWeight: 600,
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color)",
                        borderRadius: "3px",
                        color: "var(--accent-blue)",
                        cursor: "pointer",
                      }}
                    >
                      Edit IP
                    </button>{" "}
                    &bull; Lokasi:{" "}
                    <strong>{device.location || "-"}</strong>
                    {device.groupName && (
                      <span style={{ marginLeft: "8px" }}>
                        &bull; Grup:{" "}
                        <Link
                          href={`/grup/${device.groupId}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "1px 6px",
                            borderRadius: "3px",
                            fontSize: "11px",
                            fontWeight: 600,
                            color:
                              device.groupWarnaGaris === "merah"
                                ? "#C8372D"
                                : device.groupWarnaGaris === "abu"
                                ? "#5B6270"
                                : "#1F5FBF",
                            backgroundColor:
                              device.groupWarnaGaris === "merah"
                                ? "rgba(200, 55, 45, 0.08)"
                                : device.groupWarnaGaris === "abu"
                                ? "rgba(91, 98, 112, 0.08)"
                                : "rgba(31, 95, 191, 0.08)",
                            textDecoration: "none",
                            border: `1px solid ${
                              device.groupWarnaGaris === "merah"
                                ? "rgba(200, 55, 45, 0.25)"
                                : device.groupWarnaGaris === "abu"
                                ? "rgba(91, 98, 112, 0.25)"
                                : "rgba(31, 95, 191, 0.25)"
                            }`,
                          }}
                        >
                          {device.groupName}
                        </Link>
                      </span>
                    )}
                    {" "}&bull; Status:{" "}
                    <strong style={{ color: device.isActive ? "#166534" : "var(--accent-red)" }}>
                      {device.isActive ? "Aktif" : "Nonaktif"}
                    </strong>
                    {device.isActive && device.pingEnabled && (
                      <span style={{ marginLeft: "8px" }}>
                        &bull; Ping Server:{" "}
                        {device.lastPingAt ? (
                          device.lastPingOk ? (
                            <span style={{ color: "#15803D", fontWeight: 700 }}>UP • Terhubung</span>
                          ) : (
                            <span style={{ color: "var(--accent-red)", fontWeight: 700 }}>DOWN • RTO</span>
                          )
                        ) : (
                          <span style={{ color: "var(--text-secondary)" }}>Menunggu pengecekan</span>
                        )}
                        {device.lastPingAt && (
                          <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "4px" }}>
                            ({new Date(device.lastPingAt).toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" })})
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {device.ipAddress && device.isActive && (
                    <button
                      type="button"
                      disabled={isPinging}
                      onClick={handlePingDevice}
                      title="Tes konektivitas Ping ICMP/TCP dari server JagaLog"
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        backgroundColor: "#FFFFFF",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        cursor: isPinging ? "wait" : "pointer",
                        color: "var(--accent-blue)",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: isPinging ? "#EAB308" : "#22C55E",
                          display: "inline-block",
                        }}
                      />
                      {isPinging ? "Memeriksa Ping..." : "Tes Ping Sekarang"}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isRegeneratingToken}
                    onClick={() => setIsTokenConfirmModalOpen(true)}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#FFFFFF",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      cursor: isRegeneratingToken ? "not-allowed" : "pointer",
                      color: "var(--text-main)",
                      opacity: isRegeneratingToken ? 0.6 : 1,
                    }}
                  >
                    {isRegeneratingToken ? "Memproses..." : "Buat Ulang Token"}
                  </button>
                  <button
                    type="button"
                    disabled={isTogglingStatus}
                    onClick={handleToggleStatus}
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "transparent",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      cursor: isTogglingStatus ? "not-allowed" : "pointer",
                      color: device.isActive ? "var(--accent-red)" : "var(--accent-blue)",
                      opacity: isTogglingStatus ? 0.6 : 1,
                    }}
                  >
                    {isTogglingStatus
                      ? "Memproses..."
                      : device.isActive
                      ? "Nonaktifkan"
                      : "Aktifkan"}
                  </button>
                </div>
              </div>

              {/* Navigation Tabs Bar */}
              <div
                style={{
                  display: "flex",
                  gap: "20px",
                  marginTop: "20px",
                  borderBottom: "1px solid var(--border-color)",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                  WebkitOverflowScrolling: "touch",
                  scrollbarWidth: "none",
                }}
              >
                {[
                  { key: "ringkasan", label: "Ringkasan" },
                  { key: "log", label: "Event Log" },
                  { key: "insiden", label: `Insiden (${device?.openIncidentCount ?? 0})` },
                  { key: "konfigurasi", label: "Konfigurasi Perangkat" },
                ].map((t) => (
                  <button
                    key={t.key}
                    id={`tab-btn-${t.key}`}
                    onClick={() => {
                      setActiveTab(t.key as any);
                      if (typeof window !== "undefined") {
                        const url = new URL(window.location.href);
                        url.searchParams.set("tab", t.key);
                        window.history.replaceState({}, "", url.toString());
                      }
                    }}
                    className="touch-target"
                    style={{
                      padding: "10px 8px",
                      fontSize: "13px",
                      fontWeight: activeTab === t.key ? 700 : 500,
                      color: activeTab === t.key ? "var(--accent-blue)" : "var(--text-secondary)",
                      border: "none",
                      borderBottom: activeTab === t.key ? "2px solid var(--accent-blue)" : "2px solid transparent",
                      backgroundColor: "transparent",
                      cursor: "pointer",
                      marginBottom: "-1px",
                      transition: "all 0.15s ease",
                      flexShrink: 0,
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* TAB 1: RINGKASAN */}
            {activeTab === "ringkasan" && (
              <SectionErrorBoundary sectionName="Ringkasan Perangkat">
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                {/* Visualisasi Status & Ketersediaan Berdasarkan Rentang & Skala */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "18px 20px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                    position: "relative",
                  }}
                >
                  {/* Loading indicator bar */}
                  {isTimelineLoading && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "2px",
                        backgroundColor: "var(--accent-blue)",
                        opacity: 0.8,
                        borderRadius: "var(--radius-md) var(--radius-md) 0 0",
                      }}
                    />
                  )}

                  {/* Header: Title, Controls, and Metrics */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                      gap: "16px",
                      marginBottom: "14px",
                    }}
                  >
                    <div>
                      <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
                        Ketersediaan & Riwayat Status
                      </h3>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                        {timelineData?.slots ? (
                          `${timelineData.slots.length} slot waktu (interval ${SCALE_LABEL_MAP[timelineData.skala_terpilih || timelineData.slot_terpilih_skala] || timelineData.skala_terpilih || timelineData.slot_terpilih_skala}) berdasarkan log syslog & ping server.`
                        ) : (
                          "Belum ada rentang valid"
                        )}
                      </p>
                    </div>

                    {/* Ringkasan Uptime & Gangguan Kanan Atas */}
                    <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block" }}>
                          Uptime ({timelineData ? (RENTANG_LABEL_MAP[timelineData.rentang] || timelineData.rentang) : (RENTANG_LABEL_MAP[timelineRentang] || "7 Hari")})
                        </span>
                        <strong
                          style={{
                            fontSize: "15px",
                            color:
                              timelineData?.ringkasan?.uptime_persen === null || timelineData?.ringkasan?.uptime_persen === undefined
                                ? "var(--text-secondary)"
                                : timelineData.ringkasan.uptime_persen >= 99
                                ? "#15803D"
                                : timelineData.ringkasan.uptime_persen >= 95
                                ? "#B45309"
                                : "#B91C1C",
                          }}
                        >
                          {timelineData?.ringkasan?.uptime_persen !== null && timelineData?.ringkasan?.uptime_persen !== undefined
                            ? `${String(timelineData.ringkasan.uptime_persen).replace(".", ",")}%`
                            : "-"}
                        </strong>
                        {timelineData?.ringkasan?.keterangan_cakupan && (
                          <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block" }}>
                            {timelineData.ringkasan.keterangan_cakupan}
                          </span>
                        )}
                      </div>

                      <div style={{ height: "24px", width: "1px", backgroundColor: "var(--border-color)" }} />

                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block" }}>
                          Total Gangguan
                        </span>
                        <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>
                          {timelineData ? `${timelineData.ringkasan.jumlah_gangguan} kali` : "-"}
                        </strong>
                        <span style={{ fontSize: "10px", color: "var(--text-secondary)", display: "block" }}>
                          {!timelineData
                            ? "-"
                            : timelineData.ringkasan.jumlah_gangguan > 0
                            ? formatDurationHuman(timelineData.ringkasan.total_downtime_detik)
                            : "Tidak ada gangguan"}
                        </span>
                      </div>

                      <div style={{ height: "24px", width: "1px", backgroundColor: "var(--border-color)" }} />

                      <div style={{ textAlign: "right" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block" }}>
                          Gangguan Terlama
                        </span>
                        <strong style={{ fontSize: "13px", color: "var(--text-main)" }}>
                          {!timelineData
                            ? "-"
                            : timelineData.ringkasan.gangguan_terlama_detik > 0
                            ? formatDurationHuman(timelineData.ringkasan.gangguan_terlama_detik)
                            : "-"}
                        </strong>
                      </div>

                      {timelineRentang !== "24j" && (
                        <>
                          <div style={{ height: "24px", width: "1px", backgroundColor: "var(--border-color)" }} />
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block" }}>
                              Uptime 24 Jam
                            </span>
                            <strong style={{ fontSize: "13px", color: "#15803D" }}>
                              {stats?.uptime?.uptime24h !== undefined ? `${String(stats.uptime.uptime24h).replace(".", ",")}%` : "-"}
                            </strong>
                          </div>
                        </>
                      )}

                      {timelineRentang !== "7h" && (
                        <>
                          <div style={{ height: "24px", width: "1px", backgroundColor: "var(--border-color)" }} />
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: "11px", color: "var(--text-secondary)", display: "block" }}>
                              Uptime 7 Hari
                            </span>
                            <strong style={{ fontSize: "13px", color: "#15803D" }}>
                              {stats?.uptime?.uptime7d !== undefined ? `${String(stats.uptime.uptime7d).replace(".", ",")}%` : "-"}
                            </strong>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Filter Kontrol: Segmen Rentang & Dropdown Skala */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      flexWrap: "wrap",
                      marginBottom: "14px",
                      paddingBottom: "10px",
                      borderBottom: "1px solid var(--border-color)",
                    }}
                  >
                    {/* Segmented Buttons: Rentang */}
                    <div
                      style={{
                        display: "inline-flex",
                        backgroundColor: "#F1F5F9",
                        padding: "2px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                      }}
                    >
                      {[
                        { key: "24j", label: "24 Jam" },
                        { key: "7h", label: "7 Hari" },
                        { key: "30h", label: "30 Hari" },
                        { key: "90h", label: "90 Hari" },
                        { key: "1t", label: "1 Tahun" },
                        { key: "kustom", label: "Kustom" },
                      ].map((r) => (
                        <button
                          key={r.key}
                          type="button"
                          onClick={() => handleRentangChange(r.key as any)}
                          style={{
                            padding: "4px 10px",
                            fontSize: "12px",
                            fontWeight: timelineRentang === r.key ? 600 : 500,
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            backgroundColor: timelineRentang === r.key ? "#FFFFFF" : "transparent",
                            color: timelineRentang === r.key ? "var(--text-main)" : "var(--text-secondary)",
                            boxShadow: timelineRentang === r.key ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                            cursor: "pointer",
                          }}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>

                    {/* Dropdown Skala */}
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <label style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
                        Skala:
                      </label>
                      <select
                        value={dynamicValidScales.includes(timelineSkala) ? timelineSkala : "otomatis"}
                        onChange={(e) => handleSkalaChange(e.target.value as any)}
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-color)",
                          backgroundColor: "#FFFFFF",
                          color: "var(--text-main)",
                          cursor: "pointer",
                        }}
                      >
                        <option value="otomatis">
                          Otomatis{timelineData?.skala_terpilih || timelineData?.slot_terpilih_skala ? ` (${SCALE_LABEL_MAP[timelineData.skala_terpilih || timelineData.slot_terpilih_skala] || timelineData.skala_terpilih || timelineData.slot_terpilih_skala})` : ""}
                        </option>
                        {dynamicValidScales
                          .filter((s: SkalaOption) => s !== "otomatis")
                          .map((s: SkalaOption) => (
                            <option key={s} value={s}>
                              {SCALE_LABEL_MAP[s] || s}
                            </option>
                          ))}
                      </select>
                    </div>

                    {/* Input Rentang Kustom (dari & sampai) */}
                    {timelineRentang === "kustom" && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                          <input
                            type="date"
                            min={deviceCreatedAtStr}
                            max={todayWibStr}
                            value={customDari}
                            onChange={(e) => setCustomDari(e.target.value)}
                            style={{
                              padding: "3px 6px",
                              fontSize: "12px",
                              border: customValidationError && (!customDari || customDari > customSampai) ? "1px solid #DC2626" : "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                          <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>s/d</span>
                          <input
                            type="date"
                            min={deviceCreatedAtStr}
                            max={todayWibStr}
                            value={customSampai}
                            onChange={(e) => setCustomSampai(e.target.value)}
                            style={{
                              padding: "3px 6px",
                              fontSize: "12px",
                              border: customValidationError && (!customSampai || customDari > customSampai) ? "1px solid #DC2626" : "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                          <button
                            type="button"
                            disabled={isApplyDisabled}
                            onClick={handleApplyCustom}
                            style={{
                              padding: "4px 10px",
                              fontSize: "12px",
                              fontWeight: 600,
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: isApplyDisabled ? "#94A3B8" : "var(--accent-blue)",
                              color: "#FFFFFF",
                              cursor: isApplyDisabled ? "not-allowed" : "pointer",
                              opacity: isApplyDisabled ? 0.7 : 1,
                            }}
                          >
                            Terapkan
                          </button>
                        </div>
                        {customValidationError && (
                          <div style={{ fontSize: "11px", color: "#DC2626", marginTop: "2px" }}>
                            {customValidationError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Pesan Error */}
                  {timelineError && (
                    <div
                      style={{
                        padding: "8px 12px",
                        marginBottom: "12px",
                        backgroundColor: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "12px",
                        color: "#991B1B",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>{timelineError.message}</span>
                      {timelineError.isRetryable && (
                        <button
                          type="button"
                          onClick={() => fetchTimeline(timelineRentang, timelineSkala, customDari, customSampai, true)}
                          style={{
                            padding: "2px 8px",
                            fontSize: "11px",
                            fontWeight: 600,
                            backgroundColor: "#FFFFFF",
                            border: "1px solid #FECACA",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                            color: "#991B1B",
                          }}
                        >
                          Muat Ulang
                        </button>
                      )}
                    </div>
                  )}

                  {/* Timeline Slots Bar */}
                  {!timelineData ? (
                    <div
                      style={{
                        height: "28px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--text-secondary)",
                        fontSize: "12px",
                        backgroundColor: "#F8F8F6",
                        border: "1px dashed var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        width: "100%",
                      }}
                    >
                      Belum ada rentang valid
                    </div>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        gap: "2px",
                        height: "28px",
                        width: "100%",
                        backgroundColor: "#F8F8F6",
                        padding: "3px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        overflowX: "auto",
                      }}
                      role="group"
                      aria-label={`Riwayat Ketersediaan ${timelineData.slots.length} slot`}
                    >
                      {timelineData.slots.map((slot, idx) => {
                        const color =
                          slot.status === "online"
                            ? "#22C55E"
                            : slot.status === "log_stopped"
                            ? "#EAB308"
                            : slot.status === "offline"
                            ? "#EF4444"
                            : "#CBD5E1";

                        const tooltipText = slot.mulai ? formatSlotTooltip(slot) : "Memuat status slot...";
                        const isSelected = selectedSlot === slot;

                        return (
                          <div
                            key={idx}
                            role="button"
                            tabIndex={0}
                            title={tooltipText}
                            aria-label={tooltipText}
                            onClick={() => setSelectedSlot(isSelected ? null : slot)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedSlot(isSelected ? null : slot);
                              }
                            }}
                            style={{
                              flex: 1,
                              minWidth: "8px",
                              backgroundColor: color,
                              borderRadius: "2px",
                              transition: "all 0.15s ease",
                              cursor: "pointer",
                              outline: isSelected ? "2px solid #1F2430" : "none",
                              outlineOffset: isSelected ? "1px" : "0",
                            }}
                          />
                        );
                      })}
                    </div>
                  )}


                  {/* Panel Detail Gangguan Slot Terpilih (Muncul saat slot diklik) */}
                  {selectedSlot && (
                    <div
                      style={{
                        marginTop: "12px",
                        padding: "12px 14px",
                        backgroundColor: "#F8FAFC",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontWeight: 700, color: "var(--text-main)" }}>
                            Detail Slot Waktu:
                          </span>
                          <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                            {new Date(selectedSlot.mulai).toLocaleDateString("id-ID", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              timeZone: "Asia/Jakarta",
                            })}{" "}
                            {new Date(selectedSlot.mulai).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Asia/Jakarta",
                            })}{" "}
                            -{" "}
                            {new Date(selectedSlot.selesai).toLocaleTimeString("id-ID", {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Asia/Jakarta",
                            })}{" "}
                            WIB
                          </span>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("log");
                              if (typeof window !== "undefined") {
                                const url = new URL(window.location.href);
                                url.searchParams.set("tab", "log");
                                window.history.replaceState({}, "", url.toString());
                              }
                            }}
                            style={{
                              padding: "3px 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                              backgroundColor: "var(--accent-blue)",
                              color: "#FFFFFF",
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                            }}
                          >
                            Lihat Log di Tab Log
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectedSlot(null)}
                            style={{
                              border: "none",
                              backgroundColor: "transparent",
                              cursor: "pointer",
                              color: "var(--text-secondary)",
                              fontSize: "14px",
                              lineHeight: 1,
                            }}
                            title="Tutup detail slot"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "10px", marginBottom: "10px" }}>
                        <div>
                          <span style={{ color: "var(--text-secondary)", display: "block" }}>Status Dominan:</span>
                          <strong style={{ textTransform: "capitalize", color: selectedSlot.status === "online" ? "#15803D" : selectedSlot.status === "log_stopped" ? "#B45309" : selectedSlot.status === "offline" ? "#B91C1C" : "#64748B" }}>
                            {selectedSlot.status === "online" ? "Online" : selectedSlot.status === "log_stopped" ? "Log Berhenti" : selectedSlot.status === "offline" ? "Offline" : "Belum Ada Data"}
                          </strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)", display: "block" }}>Uptime Slot:</span>
                          <strong>{selectedSlot.uptime_persen !== null ? `${String(selectedSlot.uptime_persen).replace(".", ",")}%` : "-"}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)", display: "block" }}>Total Gangguan:</span>
                          <strong>{selectedSlot.jumlah_gangguan} kejadian</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-secondary)", display: "block" }}>Durasi Offline:</span>
                          <strong>{selectedSlot.detik_offline > 0 ? formatDurationHuman(selectedSlot.detik_offline) : "0 detik"}</strong>
                        </div>
                      </div>

                      {/* Tabel Gangguan di Slot Ini */}
                      {selectedSlot.gangguan && selectedSlot.gangguan.length > 0 ? (
                        <div style={{ marginTop: "8px", borderTop: "1px solid var(--border-color)", paddingTop: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px", display: "block" }}>
                            Daftar Kejadian Gangguan pada Slot Ini:
                          </span>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {selectedSlot.gangguan.map((g, gIdx) => (
                              <div
                                key={gIdx}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  padding: "4px 8px",
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "var(--radius-sm)",
                                  fontSize: "11px",
                                }}
                              >
                                <span>
                                  <strong style={{ color: g.status === "offline" ? "#B91C1C" : "#B45309", textTransform: "uppercase", marginRight: "6px" }}>
                                    {g.status === "offline" ? "OFFLINE" : "LOG BERHENTI"}
                                  </strong>
                                  {new Date(g.mulai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} -{" "}
                                  {new Date(g.selesai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} WIB
                                </span>
                                <span style={{ fontWeight: 600 }}>Durasi: {formatDurationHuman(g.durasi_detik)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontStyle: "italic" }}>
                          Tidak ada catatan gangguan pada interval slot waktu ini.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Baris 1: Ping Server */}
                  {timelineData && (
                    <div style={{ marginTop: "16px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "4px",
                          fontSize: "11px",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                          Ping Server
                        </span>
                        <span
                          style={{
                            color: "var(--text-secondary)",
                            fontFamily: timelineData.ping?.ringkasan?.persen_up !== null && timelineData.ping?.ringkasan?.persen_up !== undefined ? "var(--font-mono)" : "inherit",
                          }}
                        >
                          {timelineData.ping?.aktif === false
                            ? "Nonaktif"
                            : timelineData.ping?.ringkasan?.persen_up !== null && timelineData.ping?.ringkasan?.persen_up !== undefined
                            ? `Up ${String(timelineData.ping.ringkasan.persen_up).replace(".", ",")}%`
                            : "-"}
                        </span>
                      </div>

                      {timelineData.ping?.aktif === false ? (
                        <div
                          style={{
                            height: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: "#F1F5F9",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "11px",
                            color: "var(--text-secondary)",
                            gap: "6px",
                            width: "100%",
                          }}
                        >
                          <span>Ping belum diaktifkan untuk perangkat ini</span>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTab("konfigurasi");
                              if (typeof window !== "undefined") {
                                const url = new URL(window.location.href);
                                url.searchParams.set("tab", "konfigurasi");
                                window.history.replaceState({}, "", url.toString());
                              }
                            }}
                            style={{
                              background: "none",
                              border: "none",
                              padding: 0,
                              fontSize: "11px",
                              color: "var(--color-primary, #3B82F6)",
                              textDecoration: "underline",
                              cursor: "pointer",
                              fontWeight: 600,
                            }}
                          >
                            Konfigurasi Perangkat &rarr;
                          </button>
                        </div>
                      ) : (
                        <div>
                          <div
                            style={{
                              display: "flex",
                              gap: "2px",
                              height: "20px",
                              width: "100%",
                              backgroundColor: "#F8F8F6",
                              padding: "2px",
                              borderRadius: "var(--radius-sm)",
                              border: "1px solid var(--border-color)",
                              overflowX: "auto",
                            }}
                            role="group"
                            aria-label={`Riwayat Ping Server ${timelineData.ping?.slot?.length || 0} slot`}
                          >
                            {timelineData.ping?.slot?.map((pSlot, pIdx) => {
                              const color =
                                pSlot.status === "up"
                                  ? "#22C55E"
                                  : pSlot.status === "sebagian"
                                  ? "#EAB308"
                                  : pSlot.status === "down"
                                  ? "#EF4444"
                                  : "#CBD5E1";
                              const tooltip = formatPingSlotTooltip(pSlot);
                              const isSelected = selectedPingSlot === pSlot;

                              return (
                                <div
                                  key={pIdx}
                                  role="button"
                                  tabIndex={0}
                                  title={tooltip}
                                  aria-label={tooltip}
                                  onClick={() => setSelectedPingSlot(isSelected ? null : pSlot)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      setSelectedPingSlot(isSelected ? null : pSlot);
                                    }
                                  }}
                                  style={{
                                    flex: 1,
                                    minWidth: "8px",
                                    backgroundColor: color,
                                    borderRadius: "2px",
                                    transition: "all 0.15s ease",
                                    cursor: "pointer",
                                    outline: isSelected ? "2px solid #1F2430" : "none",
                                    outlineOffset: isSelected ? "1px" : "0",
                                  }}
                                />
                              );
                            })}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              justifyContent: "flex-end",
                              gap: "10px",
                              marginTop: "4px",
                              fontSize: "10px",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#22C55E" }} />
                              Up
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#EAB308" }} />
                              Sebagian
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#EF4444" }} />
                              Down
                            </span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                              <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#CBD5E1" }} />
                              Belum Ada Data
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Panel Detail Kejadian Down Ping Slot Terpilih */}
                      {selectedPingSlot && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "10px 12px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "12px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontWeight: 700, color: "var(--text-main)" }}>
                                Detail Ping Slot:
                              </span>
                              <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                                {new Date(selectedPingSlot.mulai).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jakarta",
                                })}{" "}
                                -{" "}
                                {new Date(selectedPingSlot.selesai).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jakarta",
                                })}{" "}
                                WIB
                              </span>
                            </div>
                            <span
                              style={{
                                fontWeight: 700,
                                textTransform: "capitalize",
                                color:
                                  selectedPingSlot.status === "up"
                                    ? "#15803D"
                                    : selectedPingSlot.status === "sebagian"
                                    ? "#B45309"
                                    : selectedPingSlot.status === "down"
                                    ? "#B91C1C"
                                    : "#64748B",
                              }}
                            >
                              {selectedPingSlot.status === "up"
                                ? "Up"
                                : selectedPingSlot.status === "sebagian"
                                ? "Sebagian"
                                : selectedPingSlot.status === "down"
                                ? "Down"
                                : "Belum Ada Data"}
                            </span>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "8px", marginBottom: "6px" }}>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>Total Cek:</span>
                              <strong>{selectedPingSlot.cek_total} kali</strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>Cek Gagal:</span>
                              <strong style={{ color: selectedPingSlot.cek_gagal > 0 ? "#B91C1C" : "inherit" }}>
                                {selectedPingSlot.cek_gagal} kali
                              </strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>RTO Terpanjang:</span>
                              <strong>{selectedPingSlot.gagal_terpanjang_detik > 0 ? formatDurationHuman(selectedPingSlot.gagal_terpanjang_detik) : "-"}</strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>RTT Rata-rata:</span>
                              <strong>{selectedPingSlot.rtt_rata_ms !== null ? `${selectedPingSlot.rtt_rata_ms} ms` : "-"}</strong>
                            </div>
                          </div>

                          {selectedPingSlot.kejadian_down && selectedPingSlot.kejadian_down.length > 0 ? (
                            <div style={{ marginTop: "6px", borderTop: "1px solid var(--border-color)", paddingTop: "6px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px", display: "block" }}>
                                Daftar Kejadian Down pada Slot Ini:
                              </span>
                              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                {selectedPingSlot.kejadian_down.map((kd, kdIdx) => (
                                  <div
                                    key={kdIdx}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      padding: "3px 6px",
                                      backgroundColor: "#FFFFFF",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "var(--radius-sm)",
                                      fontSize: "11px",
                                    }}
                                  >
                                    <span style={{ color: "#B91C1C", fontWeight: 600 }}>
                                      {new Date(kd.mulai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} -{" "}
                                      {new Date(kd.selesai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} WIB
                                    </span>
                                    <span>Durasi: {formatDurationHuman(kd.durasi_detik)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Baris 2: Pengiriman Log */}
                  {timelineData && (
                    <div style={{ marginTop: "14px" }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "4px",
                          fontSize: "11px",
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "var(--text-main)" }}>
                          Pengiriman Log
                        </span>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {timelineData.pengiriman_log?.ringkasan?.log_terakhir_pada
                            ? `Log terakhir ${getRelativeTimeString(timelineData.pengiriman_log.ringkasan.log_terakhir_pada)}`
                            : "Belum pernah mengirim log"}
                        </span>
                      </div>

                      <div
                        style={{
                          display: "flex",
                          gap: "2px",
                          height: "20px",
                          width: "100%",
                          backgroundColor: "#F8F8F6",
                          padding: "2px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-color)",
                          overflowX: "auto",
                        }}
                        role="group"
                        aria-label={`Riwayat Pengiriman Log ${timelineData.pengiriman_log?.slot?.length || 0} slot`}
                      >
                        {timelineData.pengiriman_log?.slot?.map((lSlot, lIdx) => {
                          const color =
                            lSlot.status === "mengirim"
                              ? "#22C55E"
                              : lSlot.status === "sebagian"
                              ? "#EAB308"
                              : lSlot.status === "tidak_mengirim"
                              ? "#EF4444"
                              : "#CBD5E1";
                          const tooltip = formatLogSlotTooltip(lSlot);
                          const isSelected = selectedLogSlot === lSlot;

                          return (
                            <div
                              key={lIdx}
                              role="button"
                              tabIndex={0}
                              title={tooltip}
                              aria-label={tooltip}
                              onClick={() => setSelectedLogSlot(isSelected ? null : lSlot)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedLogSlot(isSelected ? null : lSlot);
                                }
                              }}
                              style={{
                                flex: 1,
                                minWidth: "8px",
                                backgroundColor: color,
                                borderRadius: "2px",
                                transition: "all 0.15s ease",
                                cursor: "pointer",
                                outline: isSelected ? "2px solid #1F2430" : "none",
                                outlineOffset: isSelected ? "1px" : "0",
                              }}
                            />
                          );
                        })}
                      </div>

                      <div
                        style={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: "10px",
                          marginTop: "4px",
                          fontSize: "10px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#22C55E" }} />
                          Mengirim
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#EAB308" }} />
                          Sebagian
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#EF4444" }} />
                          Tidak Mengirim
                        </span>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                          <span style={{ width: "6px", height: "6px", borderRadius: "2px", backgroundColor: "#CBD5E1" }} />
                          Belum Ada Data
                        </span>
                      </div>

                      {/* Panel Detail Log Slot Terpilih */}
                      {selectedLogSlot && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "10px 12px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "12px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span style={{ fontWeight: 700, color: "var(--text-main)" }}>
                                Detail Pengiriman Log:
                              </span>
                              <span style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                                {new Date(selectedLogSlot.mulai).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jakarta",
                                })}{" "}
                                -{" "}
                                {new Date(selectedLogSlot.selesai).toLocaleTimeString("id-ID", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jakarta",
                                })}{" "}
                                WIB
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab("log");
                                if (typeof window !== "undefined") {
                                  const url = new URL(window.location.href);
                                  url.searchParams.set("tab", "log");
                                  window.history.replaceState({}, "", url.toString());
                                }
                              }}
                              style={{
                                padding: "2px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                backgroundColor: "#FFFFFF",
                                border: "1px solid var(--border-color)",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                                color: "var(--text-main)",
                              }}
                            >
                              Buka Event Log pada rentang ini &rarr;
                            </button>
                          </div>

                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "8px", marginBottom: "6px" }}>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>Status:</span>
                              <strong
                                style={{
                                  textTransform: "capitalize",
                                  color:
                                    selectedLogSlot.status === "mengirim"
                                      ? "#15803D"
                                      : selectedLogSlot.status === "sebagian"
                                      ? "#B45309"
                                      : selectedLogSlot.status === "tidak_mengirim"
                                      ? "#B91C1C"
                                      : "#64748B",
                                }}
                              >
                                {selectedLogSlot.status === "mengirim"
                                  ? "Mengirim"
                                  : selectedLogSlot.status === "sebagian"
                                  ? "Sebagian"
                                  : selectedLogSlot.status === "tidak_mengirim"
                                  ? "Tidak Mengirim"
                                  : "Belum Ada Data"}
                              </strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>Jumlah Log:</span>
                              <strong>{selectedLogSlot.jumlah_log.toLocaleString("id-ID")} pesan</strong>
                            </div>
                            <div>
                              <span style={{ color: "var(--text-secondary)", display: "block" }}>Celah Terpanjang:</span>
                              <strong>{selectedLogSlot.celah_terpanjang_detik > 0 ? formatDurationHuman(selectedLogSlot.celah_terpanjang_detik) : "0 detik"}</strong>
                            </div>
                          </div>

                          {selectedLogSlot.periode_tidak_mengirim && selectedLogSlot.periode_tidak_mengirim.length > 0 ? (
                            <div style={{ marginTop: "6px", borderTop: "1px solid var(--border-color)", paddingTop: "6px" }}>
                              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px", display: "block" }}>
                                Daftar Periode Tidak Mengirim:
                              </span>
                              <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                                {selectedLogSlot.periode_tidak_mengirim.map((ptm, ptmIdx) => (
                                  <div
                                    key={ptmIdx}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      padding: "3px 6px",
                                      backgroundColor: "#FFFFFF",
                                      border: "1px solid var(--border-color)",
                                      borderRadius: "var(--radius-sm)",
                                      fontSize: "11px",
                                    }}
                                  >
                                    <span style={{ color: "#B91C1C", fontWeight: 600 }}>
                                      {new Date(ptm.mulai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} -{" "}
                                      {new Date(ptm.selesai).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" })} WIB
                                    </span>
                                    <span>Durasi: {formatDurationHuman(ptm.durasi_detik)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Legend & Rentang Label Bawah */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "10px",
                      fontSize: "11px",
                      color: "var(--text-secondary)",
                      flexWrap: "wrap",
                      gap: "8px",
                    }}
                  >
                    <span>
                      {(() => {
                        if (!timelineData) return "-";
                        const r = timelineData.rentang;
                        if (r === "24j") return "24 jam lalu";
                        if (r === "7h") return "7 hari lalu";
                        if (r === "30h") return "30 hari lalu";
                        if (r === "90h") return "90 hari lalu";
                        if (r === "1t") return "1 tahun lalu";
                        if (r === "kustom" && timelineData.dari) {
                          return new Date(timelineData.dari).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Jakarta",
                          });
                        }
                        return "-";
                      })()}
                    </span>

                    <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#22C55E" }} />
                        Online
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#EAB308" }} />
                        Log Berhenti
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#EF4444" }} />
                        Offline
                      </span>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "2px", backgroundColor: "#CBD5E1" }} />
                        Belum Ada Data
                      </span>
                    </div>

                    <span>
                      {(() => {
                        if (!timelineData) return "-";
                        const r = timelineData.rentang;
                        if (r === "24j") return "Sekarang";
                        if (r === "1t") return "Bulan ini";
                        if (r === "kustom" && timelineData.sampai) {
                          return new Date(timelineData.sampai).toLocaleDateString("id-ID", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            timeZone: "Asia/Jakarta",
                          });
                        }
                        return "Hari ini";
                      })()}
                    </span>

                  </div>
                </div>

                {/* 4 Cards Metrik */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: "16px",
                  }}
                >
                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "16px 20px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Volume Log 24 Jam
                    </div>
                    <div style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-main)", marginTop: "4px" }}>
                      {(stats?.device?.logCount24h || 0).toLocaleString("id-ID")}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "16px 20px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Insiden Keamanan Aktif
                    </div>
                    <div
                      style={{
                        fontSize: "24px",
                        fontWeight: 700,
                        color: (stats?.device?.openIncidentCount || 0) > 0 ? "var(--accent-red)" : "var(--text-main)",
                        marginTop: "4px",
                      }}
                    >
                      {stats?.device?.openIncidentCount || 0}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "16px 20px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Top Kategori Log
                    </div>
                    <div style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-main)", marginTop: "8px", textTransform: "capitalize" }}>
                      {Object.keys(stats?.categoryBreakdown || {})[0] || "Tidak ada"}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "16px 20px",
                    }}
                  >
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase" }}>
                      Waktu Terakhir Terlihat
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)", marginTop: "8px" }}>
                      {device.lastSeenAt
                        ? new Date(device.lastSeenAt).toLocaleString("id-ID", {
                            timeZone: "Asia/Jakarta",
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }) + " WIB"
                        : "Belum pernah"}
                    </div>
                  </div>
                </div>

                {/* Daftar Riwayat Kejadian Ping RTO */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "18px 20px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div>
                      <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
                        Daftar Riwayat Ping RTO
                      </h3>
                      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                        Catatan waktu kejadian gagal jangkau ICMP/TCP dan durasi pemulihan.
                      </p>
                    </div>
                    {device.lastPingRtt !== null && device.lastPingRtt !== undefined && (
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-mono)" }}>
                        RTT Terakhir: <strong style={{ color: "var(--text-main)" }}>{device.lastPingRtt} ms</strong>
                      </div>
                    )}
                  </div>

                  {(!stats?.rtoHistory || stats.rtoHistory.length === 0) ? (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "14px 0", textAlign: "center" }}>
                      Tidak ada riwayat kejadian RTO tercatat pada perangkat ini. Ping terpantau stabil.
                    </div>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                        <thead>
                          <tr style={{ borderBottom: "1px solid var(--border-color)", textAlign: "left", color: "var(--text-secondary)" }}>
                            <th style={{ padding: "8px 10px", fontWeight: 600 }}>Waktu Mulai RTO (WIB)</th>
                            <th style={{ padding: "8px 10px", fontWeight: 600 }}>Waktu Pulih (WIB)</th>
                            <th style={{ padding: "8px 10px", fontWeight: 600 }}>Durasi</th>
                            <th style={{ padding: "8px 10px", fontWeight: 600 }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stats.rtoHistory.map((h, idx) => {
                            const startStr = new Date(h.startedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
                            const endStr = h.endedAt
                              ? new Date(h.endedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })
                              : "Sedang berlangsung";
                            const durationMs = (h.endedAt ? new Date(h.endedAt).getTime() : Date.now()) - new Date(h.startedAt).getTime();
                            const durationMins = Math.max(1, Math.round(durationMs / 60000));
                            const isOngoing = !h.endedAt;

                            return (
                              <tr key={h.id || idx} style={{ borderBottom: "1px solid var(--border-color)" }}>
                                <td style={{ padding: "8px 10px", fontFamily: "var(--font-mono)" }}>{startStr}</td>
                                <td style={{ padding: "8px 10px", fontFamily: "var(--font-mono)" }}>{endStr}</td>
                                <td style={{ padding: "8px 10px" }}>
                                  {isOngoing ? `Berlangsung ${durationMins} menit` : `${durationMins} menit`}
                                </td>
                                <td style={{ padding: "8px 10px" }}>
                                  <span
                                    style={{
                                      padding: "2px 6px",
                                      borderRadius: "3px",
                                      fontSize: "11px",
                                      fontWeight: 600,
                                      backgroundColor: isOngoing ? "#FEF2F2" : "#F0FDF4",
                                      color: isOngoing ? "#B91C1C" : "#15803D",
                                      border: `1px solid ${isOngoing ? "#FECACA" : "#BBF7D0"}`,
                                    }}
                                  >
                                    {isOngoing ? "RTO Aktif" : "Pulih"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Grafik Volume Bar Chart 24 Jam */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "20px 24px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", marginBottom: "16px" }}>
                    Aktivitas Volume Log per Jam (24 Jam Terakhir)
                  </h3>
                  <HourlyActivityChart
                    chartData={stats?.hourlyChart || []}
                    summaryMetrics={stats?.chartSummary}
                    deviceId={deviceId}
                    deviceName={device?.name}
                    onHourClick={(bucket) => {
                      setActiveTab("log");
                      setLogRentang("kustom");
                      setCustomLogDari(bucket.mulai.slice(0, 16));
                      setCustomLogSampai(bucket.selesai.slice(0, 16));
                    }}
                  />
                </div>

                {/* Grid Top IP & Top Akun */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
                  {/* Top IP */}
                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "20px 24px",
                    }}
                  >
                    <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", marginBottom: "12px" }}>
                      Top 5 Alamat IP
                    </h3>
                    {stats?.topIp && stats.topIp.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {stats.topIp.map((item, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: "12px",
                              padding: "6px 0",
                              borderBottom: "1px solid #F1F5F9",
                            }}
                          >
                            <span className="font-mono" style={{ fontWeight: 600 }}>
                              {item.ip}
                            </span>
                            <span style={{ color: "var(--text-secondary)" }}>{item.count.toLocaleString("id-ID")} kali</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Belum ada data IP terekam.</div>
                    )}
                  </div>

                  {/* Top Akun */}
                  <div
                    style={{
                      backgroundColor: "var(--bg-panel)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-md)",
                      padding: "20px 24px",
                    }}
                  >
                    <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)", marginBottom: "12px" }}>
                      Top 5 Akun Pengguna Terkait
                    </h3>
                    {stats?.topAccounts && stats.topAccounts.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {stats.topAccounts.map((item, i) => (
                          <div
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              fontSize: "12px",
                              padding: "6px 0",
                              borderBottom: "1px solid #F1F5F9",
                            }}
                          >
                            <span className="font-mono" style={{ fontWeight: 600 }}>
                              {item.account}
                            </span>
                            <span style={{ color: "var(--text-secondary)" }}>{item.count.toLocaleString("id-ID")} kali</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Belum ada akun terekam.</div>
                    )}
                  </div>
                </div>

                {/* Ringkasan Analisa AI Harian Perangkat */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "20px 24px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          backgroundColor: "var(--accent-blue)",
                          borderRadius: "2px",
                        }}
                      />
                      <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-main)" }}>
                        Ringkasan Keamanan AI Harian
                      </h3>
                    </div>

                    <button
                      onClick={handleRunDailyAi}
                      disabled={isDailyAiLoading}
                      style={{
                        padding: "5px 12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        backgroundColor: isDailyAiLoading ? "#E2E8F0" : "var(--accent-blue)",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: isDailyAiLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      {isDailyAiLoading ? "Sedang Menganalisa..." : "Buat Ringkasan Harian AI"}
                    </button>
                  </div>

                  {dailyAiResult ? (
                    <div style={{ fontSize: "13px", lineHeight: "1.5", color: "var(--text-main)" }}>
                      <div
                        style={{
                          padding: "12px 16px",
                          backgroundColor: "#F8FAFC",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          marginBottom: "12px",
                        }}
                      >
                        {dailyAiResult.summary || JSON.stringify(dailyAiResult)}
                      </div>

                      {dailyAiResult.actionItems && dailyAiResult.actionItems.length > 0 && (
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>
                            TINDAKAN YANG DIREKOMENDASIKAN:
                          </div>
                          <ul style={{ margin: 0, paddingLeft: "20px" }}>
                            {dailyAiResult.actionItems.map((act: string, idx: number) => (
                              <li key={idx}>{act}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Belum ada ringkasan analisa AI harian untuk perangkat ini. Klik tombol di atas untuk menjalankan analisa otomatis 24 jam terakhir.
                    </div>
                  )}
                </div>

                {/* Kartu Pesan Paling Sering (Top 5 Pola 24 Jam) */}
                <TopPatternsCard
                  deviceId={deviceId}
                  onIgnorePattern={(pattern) => {
                    setFilterPrefillPattern(pattern);
                    setActiveTab("konfigurasi");
                  }}
                />
              </div>
              </SectionErrorBoundary>
            )}

            {/* TAB 2: LOG */}
            {activeTab === "log" && (
              <SectionErrorBoundary sectionName="Log Perangkat">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {/* 1. Bar Pengaturan & Filter Log */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "16px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  {/* Baris 1: Rentang Cepat + Urutan + Live Mode + Ekspor CSV */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "12px",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    {/* Segmented Rentang Cepat */}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)", marginRight: "4px" }}>
                        RENTANG:
                      </span>
                      {[
                        { key: "15m", label: "15 Menit" },
                        { key: "1j", label: "1 Jam" },
                        { key: "6j", label: "6 Jam" },
                        { key: "24j", label: "24 Jam" },
                        { key: "7h", label: "7 Hari" },
                        { key: "30h", label: "30 Hari" },
                        { key: "kustom", label: "Kustom" },
                      ].map((item) => {
                        const isActive = logRentang === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => {
                              setLogRentang(item.key as any);
                              if (isLiveMode) setIsLiveMode(false);
                            }}
                            style={{
                              padding: "5px 11px",
                              fontSize: "12px",
                              fontWeight: isActive ? 700 : 500,
                              backgroundColor: isActive ? "var(--accent-blue)" : "#FFFFFF",
                              color: isActive ? "#FFFFFF" : "var(--text-main)",
                              border: isActive ? "1px solid var(--accent-blue)" : "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                              transition: "all 0.15s ease",
                            }}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Kontrol Aksi: Urutan, Live, Ekspor */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                      {/* Tombol Urutan */}
                      <button
                        type="button"
                        onClick={() => setLogOrder((ord) => (ord === "desc" ? "asc" : "desc"))}
                        title={`Urutan saat ini: ${logOrder === "desc" ? "Terbaru dulu" : "Terlama dulu"}. Klik untuk membalik.`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "5px 12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor: "#FFFFFF",
                          color: "var(--text-main)",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          {logOrder === "desc" ? (
                            <>
                              <line x1="12" y1="5" x2="12" y2="19" />
                              <polyline points="19 12 12 19 5 12" />
                            </>
                          ) : (
                            <>
                              <line x1="12" y1="19" x2="12" y2="5" />
                              <polyline points="5 12 12 5 19 12" />
                            </>
                          )}
                        </svg>
                        <span>{logOrder === "desc" ? "Terbaru dulu" : "Terlama dulu"}</span>
                      </button>

                      {/* Live Mode Toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const nextLive = !isLiveMode;
                          setIsLiveMode(nextLive);
                          if (nextLive) {
                            setLogOrder("desc");
                          }
                        }}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "5px 12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor: isLiveMode ? "#F0FDF4" : "#FFFFFF",
                          color: isLiveMode ? "#166534" : "var(--text-secondary)",
                          border: isLiveMode ? "1px solid #86EFAC" : "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            backgroundColor: isLiveMode ? "#22C55E" : "#94A3B8",
                            boxShadow: isLiveMode ? "0 0 0 2px rgba(34, 197, 94, 0.2)" : "none",
                          }}
                        />
                        {isLiveMode ? "Live: Aktif (5s)" : "Live: Mati"}
                      </button>

                      {/* Ekspor CSV */}
                      {(() => {
                        const exportQuery = new URLSearchParams();
                        exportQuery.append("export", "csv");
                        if (debouncedSearch) exportQuery.append("search", debouncedSearch);
                        if (logSeverities.length > 0) exportQuery.append("severity", logSeverities.join(","));
                        if (logCategory !== "all") exportQuery.append("category", logCategory);
                        if (logApp) exportQuery.append("app", logApp);
                        if (logSrcIp) exportQuery.append("srcIp", logSrcIp);
                        if (logActor) exportQuery.append("actor", logActor);
                        exportQuery.append("order", logOrder);
                        if (!isLiveMode) {
                          const { from, to } = getLogTimeRange();
                          if (from) exportQuery.append("from", from);
                          if (to) exportQuery.append("to", to);
                        }
                        return (
                          <a
                            href={`/api/devices/${deviceId}/logs?${exportQuery.toString()}`}
                            download
                            title="Unduh log dengan tanggal, jam WIB, UTC, dan data per parsed"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "5px 12px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "#FFFFFF",
                              color: "var(--accent-blue)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              textDecoration: "none",
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Ekspor CSV
                          </a>
                        );
                      })()}

                      {/* Toggle Sembunyikan Pesan Berulang */}
                      <label
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          fontSize: "12px",
                          fontWeight: 500,
                          color: "var(--text-main)",
                          cursor: "pointer",
                          userSelect: "none",
                          padding: "5px 8px",
                          backgroundColor: "#F8FAFC",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={hideRepeatedLogs}
                          onChange={(e) => setHideRepeatedLogs(e.target.checked)}
                          style={{ cursor: "pointer" }}
                        />
                        Sembunyikan pesan berulang
                      </label>

                      {/* Chip Pesan Digabung / Dibuang */}
                      {mergedOrDroppedCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveTab("konfigurasi")}
                          title="Klik untuk membuka pengaturan filter log perangkat"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            padding: "5px 10px",
                            fontSize: "11px",
                            fontWeight: 600,
                            backgroundColor: "#EFF6FF",
                            color: "#1E40AF",
                            borderRadius: "12px",
                            border: "1px solid #BFDBFE",
                            cursor: "pointer",
                          }}
                        >
                          Ada {mergedOrDroppedCount.toLocaleString("id-ID")} pesan serupa digabung/dibuang. Lihat
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Baris 2: Input Filter (Teks, Severity, Kategori, App, IP, User) */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center" }}>
                    {/* Pencarian Pesan */}
                    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                      <input
                        type="text"
                        placeholder="Cari pesan log..."
                        value={logSearch}
                        onChange={(e) => setLogSearch(e.target.value)}
                        style={{
                          padding: "6px 28px 6px 10px",
                          fontSize: "12px",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          width: "210px",
                          backgroundColor: "#FFFFFF",
                        }}
                      />
                      {logSearch && (
                        <button
                          type="button"
                          onClick={() => {
                            setLogSearch("");
                            setDebouncedSearch("");
                          }}
                          style={{
                            position: "absolute",
                            right: "8px",
                            background: "none",
                            border: "none",
                            fontSize: "14px",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          &times;
                        </button>
                      )}
                    </div>

                    {/* Multi-Severity Dropdown Toggle */}
                    <div style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => setIsSeverityDropdownOpen((v) => !v)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 10px",
                          fontSize: "12px",
                          backgroundColor: "#FFFFFF",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                          color: logSeverities.length > 0 ? "var(--accent-blue)" : "var(--text-main)",
                          fontWeight: logSeverities.length > 0 ? 600 : 400,
                        }}
                      >
                        <span>
                          {logSeverities.length === 0
                            ? "Semua Severity"
                            : `${logSeverities.length} Severity Terpilih`}
                        </span>
                        <span style={{ fontSize: "10px" }}>▼</span>
                      </button>

                      {isSeverityDropdownOpen && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            marginTop: "4px",
                            backgroundColor: "#FFFFFF",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-md)",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                            padding: "10px",
                            zIndex: 40,
                            width: "240px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--text-secondary)" }}>
                              PILIH SEVERITY (0-7):
                            </span>
                            {logSeverities.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setLogSeverities([])}
                                style={{ background: "none", border: "none", color: "var(--accent-blue)", fontSize: "11px", cursor: "pointer", padding: 0 }}
                              >
                                Pilih Semua
                              </button>
                            )}
                          </div>
                          {[0, 1, 2, 3, 4, 5, 6, 7].map((s) => {
                            const isChecked = logSeverities.includes(s);
                            const meta = SEVERITY_NAMES[s] || { label: String(s), bg: "#F1F5F9", text: "#334155" };
                            return (
                              <label
                                key={s}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  fontSize: "12px",
                                  cursor: "pointer",
                                  padding: "3px 4px",
                                  borderRadius: "4px",
                                  backgroundColor: isChecked ? "#F8FAFC" : "transparent",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setLogSeverities((prev) => [...prev, s]);
                                    } else {
                                      setLogSeverities((prev) => prev.filter((v) => v !== s));
                                    }
                                  }}
                                />
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    padding: "1px 5px",
                                    borderRadius: "3px",
                                    backgroundColor: meta.bg,
                                    color: meta.text,
                                    minWidth: "46px",
                                    textAlign: "center",
                                  }}
                                >
                                  {meta.label}
                                </span>
                                <span style={{ color: "var(--text-main)" }}>Level {s}</span>
                              </label>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setIsSeverityDropdownOpen(false)}
                            style={{
                              marginTop: "6px",
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                              backgroundColor: "#F1F5F9",
                              border: "none",
                              borderRadius: "4px",
                              cursor: "pointer",
                              textAlign: "center",
                            }}
                          >
                            Tutup
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Kategori */}
                    <select
                      value={logCategory}
                      onChange={(e) => setLogCategory(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="all">Semua Kategori</option>
                      <option value="auth">Autentikasi (auth)</option>
                      <option value="firewall">Firewall</option>
                      <option value="system">Sistem</option>
                      <option value="network">Jaringan</option>
                      <option value="dhcp">DHCP</option>
                      <option value="config">Konfigurasi</option>
                      <option value="other">Lainnya</option>
                    </select>

                    {/* Filter Aplikasi */}
                    <input
                      type="text"
                      placeholder="Aplikasi / Topik..."
                      value={logApp}
                      onChange={(e) => setLogApp(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        width: "130px",
                        backgroundColor: "#FFFFFF",
                      }}
                    />

                    {/* Filter IP Sumber */}
                    <input
                      type="text"
                      placeholder="IP Sumber..."
                      value={logSrcIp}
                      onChange={(e) => setLogSrcIp(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        width: "120px",
                        backgroundColor: "#FFFFFF",
                      }}
                    />

                    {/* Filter Akun/User */}
                    <input
                      type="text"
                      placeholder="Akun / User..."
                      value={logActor}
                      onChange={(e) => setLogActor(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        width: "110px",
                        backgroundColor: "#FFFFFF",
                      }}
                    />

                    {/* Reset Button */}
                    {(debouncedSearch ||
                      logSeverities.length > 0 ||
                      logCategory !== "all" ||
                      logApp ||
                      logSrcIp ||
                      logActor ||
                      logRentang !== "24j" ||
                      logOrder !== "desc") && (
                      <button
                        type="button"
                        onClick={() => {
                          setLogSearch("");
                          setDebouncedSearch("");
                          setLogSeverities([]);
                          setLogCategory("all");
                          setLogApp("");
                          setLogSrcIp("");
                          setLogActor("");
                          setLogRentang("24j");
                          setCustomLogDari("");
                          setCustomLogSampai("");
                          setLogOrder("desc");
                        }}
                        style={{
                          padding: "6px 10px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor: "#FEF2F2",
                          color: "var(--accent-red)",
                          border: "1px solid #FECACA",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        Reset Filter
                      </button>
                    )}
                  </div>

                  {/* Baris 3: Pemilih Rentang Kustom (jika rentang = kustom) */}
                  {logRentang === "kustom" && (
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 14px",
                        backgroundColor: "#F8FAFC",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    >
                      <span style={{ fontSize: "12px", fontWeight: 600 }}>Rentang Kustom (WIB):</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Dari:</span>
                        <input
                          type="datetime-local"
                          value={customLogDari}
                          onChange={(e) => setCustomLogDari(e.target.value)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "12px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                          }}
                        />
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Sampai:</span>
                        <input
                          type="datetime-local"
                          value={customLogSampai}
                          onChange={(e) => setCustomLogSampai(e.target.value)}
                          style={{
                            padding: "4px 8px",
                            fontSize: "12px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                          }}
                        />
                      </div>
                      {customLogValidationError && (
                        <span style={{ fontSize: "11px", color: "var(--accent-red)", fontWeight: 600 }}>
                          {customLogValidationError}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Baris 4: Chip Filter Aktif & Indikator Hasil */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderTop: "1px solid #F1F5F9",
                      paddingTop: "10px",
                      fontSize: "12px",
                    }}
                  >
                    {/* Filter chips */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                      <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Filter Aktif:</span>

                      {/* Rentang Chip */}
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          backgroundColor: "#F1F5F9",
                          borderRadius: "12px",
                          color: "var(--text-main)",
                        }}
                      >
                        Rentang: {logRentang === "kustom" ? "Kustom" : logRentang.toUpperCase()}
                      </span>

                      {/* Search chip */}
                      {debouncedSearch && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#EFF6FF",
                            color: "var(--accent-blue)",
                            borderRadius: "12px",
                          }}
                        >
                          Teks: &quot;{debouncedSearch}&quot;
                          <button
                            type="button"
                            onClick={() => {
                              setLogSearch("");
                              setDebouncedSearch("");
                            }}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}

                      {/* Severity chips */}
                      {logSeverities.length > 0 && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#FEF2F2",
                            color: "#991B1B",
                            borderRadius: "12px",
                          }}
                        >
                          Severity: {logSeverities.map((s) => SEVERITY_NAMES[s]?.label || s).join(", ")}
                          <button
                            type="button"
                            onClick={() => setLogSeverities([])}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}

                      {/* Kategori chip */}
                      {logCategory !== "all" && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "12px",
                          }}
                        >
                          Kategori: {logCategory}
                          <button
                            type="button"
                            onClick={() => setLogCategory("all")}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}

                      {/* App chip */}
                      {logApp && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "12px",
                          }}
                        >
                          App: {logApp}
                          <button
                            type="button"
                            onClick={() => setLogApp("")}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}

                      {/* IP chip */}
                      {logSrcIp && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "12px",
                          }}
                        >
                          IP: {logSrcIp}
                          <button
                            type="button"
                            onClick={() => setLogSrcIp("")}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}

                      {/* Actor chip */}
                      {logActor && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                            padding: "2px 8px",
                            fontSize: "11px",
                            backgroundColor: "#F8FAFC",
                            border: "1px solid var(--border-color)",
                            borderRadius: "12px",
                          }}
                        >
                          Akun: {logActor}
                          <button
                            type="button"
                            onClick={() => setLogActor("")}
                            style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                          >
                            &times;
                          </button>
                        </span>
                      )}
                    </div>

                    {/* Hasil count */}
                    <div style={{ color: "var(--text-secondary)", fontWeight: 500 }}>
                      Menampilkan <strong>{logs.length}</strong>
                      {logTotalCount !== null ? (
                        <>
                          {" "}
                          dari{" "}
                          <strong>
                            {isLogEstimated ? "sekitar " : ""}
                            {logTotalCount.toLocaleString("id-ID")}
                            {isLogEstimated ? "+" : ""}
                          </strong>{" "}
                          log
                        </>
                      ) : (
                        " log"
                      )}
                    </div>
                  </div>

                  {/* Peringatan Penolakan Paket jika log ada namun paket terakhir ditolak */}
                  {logs.length > 0 && ingestDiagnostics?.lastPacket && !ingestDiagnostics.lastPacket.accepted && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#991B1B",
                        backgroundColor: "#FEF2F2",
                        border: "1px solid #FECACA",
                        borderLeft: "3px solid var(--accent-red)",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: "8px",
                      }}
                    >
                      <span>
                        Paket dari <strong>{ingestDiagnostics.lastPacket.sourceIp}</strong> diterima{" "}
                        <strong>{getRelativeTimeString(ingestDiagnostics.lastPacket.timestamp)}</strong> tetapi ditolak:{" "}
                        <strong>{ingestDiagnostics.lastPacket.reasonLabel || ingestDiagnostics.lastPacket.reason}</strong>.
                      </span>
                      {!device.isActive && (
                        <button
                          type="button"
                          onClick={handleToggleStatus}
                          disabled={isTogglingStatus}
                          style={{
                            padding: "4px 10px",
                            fontSize: "11px",
                            fontWeight: 600,
                            backgroundColor: "var(--accent-blue)",
                            color: "#FFFFFF",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            cursor: "pointer",
                          }}
                        >
                          {isTogglingStatus ? "Memproses..." : "Aktifkan Perangkat"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Peringatan pencarian teks jika rentang > 24 jam */}
                  {(searchWarning || (debouncedSearch && ["7h", "30h", "kustom"].includes(logRentang))) && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#B45309",
                        backgroundColor: "#FEF3C7",
                        padding: "6px 12px",
                        borderRadius: "var(--radius-sm)",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <span>{searchWarning || "Pencarian teks dengan rentang lebih dari 24 jam memerlukan pemindaian lebih luas. Untuk performa optimal, gunakan rentang 24 jam atau persempit dengan filter severity/kategori."}</span>
                    </div>
                  )}
                  {/* Chip Log Baru Tersedia saat pengguna scroll ke bawah atau filter di masa lalu */}
                  {unseenLogCount > 0 && (
                    <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
                      <button
                        type="button"
                        onClick={applyPendingLogs}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "6px",
                          padding: "6px 16px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor: "var(--accent-blue)",
                          color: "#FFFFFF",
                          borderRadius: "20px",
                          border: "none",
                          cursor: "pointer",
                          boxShadow: "0 2px 8px rgba(31, 95, 191, 0.3)",
                        }}
                      >
                        <span>↑ {unseenLogCount} log baru</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Tabel Log dengan Pemisah Tanggal & Waktu Dua Baris */}
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  }}
                >
                  {isLogsLoading && logs.length === 0 ? (
                    <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                      Memuat daftar event log...
                    </div>
                  ) : logs.length === 0 ? (
                    <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text-main)", fontSize: "13px" }}>
                      {!device.isActive ? (
                        <div style={{ maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                          <div style={{ fontWeight: 700, color: "#991B1B", fontSize: "14px" }}>
                            Perangkat ini nonaktif, jadi log yang dikirim ditolak. Aktifkan perangkat.
                          </div>
                          {ingestDiagnostics?.lastPacket && !ingestDiagnostics.lastPacket.accepted && (
                            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                              Paket dari <strong className="font-mono">{ingestDiagnostics.lastPacket.sourceIp}</strong> diterima{" "}
                              <strong>{getRelativeTimeString(ingestDiagnostics.lastPacket.timestamp)}</strong> tetapi ditolak:{" "}
                              <strong>{ingestDiagnostics.lastPacket.reasonLabel || ingestDiagnostics.lastPacket.reason || "nonaktif"}</strong>
                              {ingestDiagnostics.totalRejected24h > 0 ? ` (${ingestDiagnostics.totalRejected24h.toLocaleString("id-ID")} paket ditolak 24 jam terakhir)` : ""}.
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={handleToggleStatus}
                            disabled={isTogglingStatus}
                            style={{
                              marginTop: "4px",
                              padding: "7px 16px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "var(--accent-blue)",
                              color: "#FFFFFF",
                              border: "none",
                              borderRadius: "var(--radius-sm)",
                              cursor: isTogglingStatus ? "not-allowed" : "pointer",
                            }}
                          >
                            {isTogglingStatus ? "Memproses..." : "Aktifkan Perangkat"}
                          </button>
                        </div>
                      ) : !device.ipAddress && device.type !== "windows" ? (
                        <div style={{ maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                          <div style={{ fontWeight: 700, color: "var(--text-main)", fontSize: "14px" }}>
                            Perangkat ini belum punya IP sumber. Syslog dikenali dari IP pengirim. Isi IP di Edit, atau pakai HTTP Ingest dengan token.
                          </div>
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center", marginTop: "4px" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setEditIpValue(device.ipAddress || "");
                                setIsEditIpModalOpen(true);
                              }}
                              style={{
                                padding: "7px 14px",
                                fontSize: "12px",
                                fontWeight: 600,
                                backgroundColor: "var(--accent-blue)",
                                color: "#FFFFFF",
                                border: "none",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                              }}
                            >
                              Isi IP di Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveTab("konfigurasi")}
                              style={{
                                padding: "7px 14px",
                                fontSize: "12px",
                                fontWeight: 600,
                                backgroundColor: "#FFFFFF",
                                color: "var(--text-main)",
                                border: "1px solid var(--border-color)",
                                borderRadius: "var(--radius-sm)",
                                cursor: "pointer",
                              }}
                            >
                              Lihat Sumber Tidak Dikenal / Konfigurasi
                            </button>
                          </div>
                        </div>
                      ) : ingestDiagnostics?.lastPacket && !ingestDiagnostics.lastPacket.accepted ? (
                        <div style={{ maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontWeight: 700, color: "#991B1B", fontSize: "14px" }}>
                            Paket dari {ingestDiagnostics.lastPacket.sourceIp} diterima{" "}
                            {getRelativeTimeString(ingestDiagnostics.lastPacket.timestamp)} tetapi ditolak:{" "}
                            {ingestDiagnostics.lastPacket.reasonLabel || ingestDiagnostics.lastPacket.reason}.
                          </div>
                          {ingestDiagnostics.totalRejected24h > 0 && (
                            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                              Total paket ditolak 24 jam terakhir: <strong>{ingestDiagnostics.totalRejected24h.toLocaleString("id-ID")}</strong> paket.
                            </div>
                          )}
                        </div>
                      ) : hasLogsOutsideFilter ? (
                        <div style={{ color: "var(--text-secondary)" }}>
                          Tidak ada log yang sesuai filter pencarian.
                        </div>
                      ) : (
                        <div style={{ maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                          <div style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "13px" }}>
                            Belum ada paket dari perangkat ini. Periksa konfigurasi di panel Cara mengirim log.
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab("konfigurasi")}
                            style={{
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: 600,
                              backgroundColor: "#FFFFFF",
                              color: "var(--accent-blue)",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              cursor: "pointer",
                            }}
                          >
                            Buka Panel Cara Mengirim Log
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="desktop-only" style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                            <th style={{ padding: "10px 14px", width: "160px" }}>Waktu (WIB)</th>
                            <th style={{ padding: "10px 14px", width: "80px" }}>Severity</th>
                            <th style={{ padding: "10px 14px", width: "90px" }}>Kategori</th>
                            <th style={{ padding: "10px 14px", width: "110px" }}>Aplikasi</th>
                            <th style={{ padding: "10px 14px" }}>Pesan Log</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            // Hitung jumlah log per tanggal dalam dataset saat ini untuk label pemisah
                            const dateCountMap = new Map<string, number>();
                            for (const l of logs) {
                              const dLabel = getDateDividerLabel(l.eventTime);
                              dateCountMap.set(dLabel, (dateCountMap.get(dLabel) || 0) + 1);
                            }

                            let prevDividerDate = "";

                            return logs.map((log) => {
                              const sev = SEVERITY_NAMES[log.severity] || {
                                label: String(log.severity),
                                bg: "#F1F5F9",
                                text: "#334155",
                              };

                              const { dateStr, timeStr } = formatLogRowTime(log.eventTime);
                              const dividerDate = getDateDividerLabel(log.eventTime);
                              const showDivider = dividerDate !== prevDividerDate;
                              if (showDivider) {
                                prevDividerDate = dividerDate;
                              }

                              const skewSec =
                                typeof log.parsed?.clock_skew_seconds === "number"
                                  ? log.parsed.clock_skew_seconds
                                  : 0;
                              const isClockSkewed = Math.abs(skewSec) > 300;

                              const fullWib =
                                new Date(log.eventTime).toLocaleString("id-ID", {
                                  timeZone: "Asia/Jakarta",
                                }) + " WIB";
                              const fullUtc = new Date(log.eventTime)
                                .toISOString()
                                .replace("T", " ")
                                .replace("Z", " UTC");
                              const relativeTime = getRelativeTimeString(log.eventTime);
                              const recWib = log.receivedAt
                                ? new Date(log.receivedAt).toLocaleString("id-ID", {
                                    timeZone: "Asia/Jakarta",
                                  }) + " WIB"
                                : "-";
                              const devTimeWib = log.parsed?.device_time
                                ? new Date(log.parsed.device_time).toLocaleString("id-ID", {
                                    timeZone: "Asia/Jakarta",
                                  }) + " WIB"
                                : null;

                              const timeTooltip = [
                                `Waktu Event (WIB): ${fullWib}`,
                                `Waktu Event (UTC): ${fullUtc}`,
                                `Waktu Relatif: ${relativeTime}`,
                                `Diterima Server: ${recWib}`,
                                devTimeWib
                                  ? `Jam Asli Perangkat: ${devTimeWib} (${formatClockSkewDescription(
                                      skewSec
                                    )})`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join("\n");

                              return (
                                <React.Fragment key={log.id}>
                                  {/* Pemisah Tanggal Setiap Pergantian Hari */}
                                  {showDivider && (
                                    <tr
                                      style={{
                                        backgroundColor: "#F8FAFC",
                                        borderTop: "2px solid #E2E8F0",
                                        borderBottom: "1px solid #E2E8F0",
                                      }}
                                    >
                                      <td
                                        colSpan={5}
                                        style={{
                                          padding: "7px 14px",
                                          fontSize: "11px",
                                          fontWeight: 700,
                                          color: "var(--text-secondary)",
                                        }}
                                      >
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                          <span
                                            style={{
                                              width: "3px",
                                              height: "12px",
                                              backgroundColor: "var(--accent-blue)",
                                              borderRadius: "2px",
                                            }}
                                          />
                                          <span>{dividerDate}</span>
                                          <span style={{ fontWeight: 400, color: "var(--text-muted)", fontSize: "11px" }}>
                                            — {dateCountMap.get(dividerDate) || 0} log dimuat
                                          </span>
                                        </div>
                                      </td>
                                    </tr>
                                  )}

                                  {/* Baris Log */}
                                  <tr
                                    onClick={() => setSelectedLog(log)}
                                    style={{
                                      borderBottom: "1px solid #F1F5F9",
                                      cursor: "pointer",
                                      transition: "background-color 0.1s ease",
                                    }}
                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#F8FAFC")}
                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                                  >
                                    <td
                                      title={timeTooltip}
                                      style={{
                                        padding: "8px 14px",
                                        whiteSpace: "nowrap",
                                        color: "var(--text-secondary)",
                                      }}
                                    >
                                      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                                        <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-main)" }}>
                                          {dateStr}
                                        </div>
                                        <div style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--text-secondary)" }}>
                                          {timeStr}
                                        </div>
                                        {isClockSkewed && (
                                          <div style={{ marginTop: "2px" }}>
                                            <span
                                              title={`Jam perangkat berbeda ${formatClockSkewDescription(
                                                skewSec
                                              )} dari server. Waktu yang ditampilkan memakai waktu server.`}
                                              style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                gap: "3px",
                                                fontSize: "10px",
                                                fontWeight: 600,
                                                color: "#B45309",
                                                backgroundColor: "#FEF3C7",
                                                padding: "1px 5px",
                                                borderRadius: "3px",
                                              }}
                                            >
                                              <svg
                                                width="9"
                                                height="9"
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2.5"
                                              >
                                                <circle cx="12" cy="12" r="10" />
                                                <polyline points="12 6 12 12 16 14" />
                                              </svg>
                                              Jam meleset
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </td>
                                    <td style={{ padding: "8px 14px" }}>
                                      <span
                                        style={{
                                          fontSize: "10px",
                                          fontWeight: 700,
                                          padding: "2px 6px",
                                          borderRadius: "3px",
                                          backgroundColor: sev.bg,
                                          color: sev.text,
                                        }}
                                      >
                                        {sev.label}
                                      </span>
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px 14px",
                                        textTransform: "uppercase",
                                        fontSize: "11px",
                                        color: "var(--text-secondary)",
                                      }}
                                    >
                                      {log.category}
                                    </td>
                                    <td
                                      style={{
                                        padding: "8px 14px",
                                        fontSize: "11px",
                                        color: "var(--text-secondary)",
                                      }}
                                    >
                                      {log.sourceApp || "-"}
                                    </td>
                                    <td
                                      className="font-mono"
                                      style={{
                                        padding: "8px 14px",
                                        maxWidth: "500px",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {log.repeatCount && log.repeatCount > 1 ? (
                                        <span
                                          style={{
                                            display: "inline-block",
                                            marginRight: "6px",
                                            padding: "1px 6px",
                                            fontSize: "10px",
                                            fontWeight: 700,
                                            backgroundColor: "#E0E7FF",
                                            color: "#3730A3",
                                            borderRadius: "10px",
                                          }}
                                          title={`Pesan berulang ${log.repeatCount} kali`}
                                        >
                                          x{log.repeatCount}
                                        </span>
                                      ) : null}
                                      {log.message}
                                    </td>
                                  </tr>
                                </React.Fragment>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Log Cards View */}
                    <div className="mobile-only" style={{ display: "none" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px" }}>
                        {logs.map((log) => {
                          const sev = SEVERITY_NAMES[log.severity] || {
                            label: String(log.severity),
                            bg: "#F1F5F9",
                            text: "#334155",
                          };
                          const sevStripeColor =
                            log.severity <= 3
                              ? "var(--accent-red)"
                              : log.severity === 4
                              ? "#E65100"
                              : log.severity === 5
                              ? "#F57F17"
                              : log.severity === 6
                              ? "var(--accent-blue)"
                              : "#94A3B8";

                          const { dateStr, timeStr } = formatLogRowTime(log.eventTime);

                          return (
                            <div
                              key={`mob-${log.id}`}
                              onClick={() => setSelectedLog(log)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setSelectedLog(log);
                                }
                              }}
                              style={{
                                display: "block",
                                backgroundColor: "#FFFFFF",
                                border: "1px solid var(--border-color)",
                                borderLeft: `4px solid ${sevStripeColor}`,
                                borderRadius: "var(--radius-sm)",
                                padding: "12px 14px",
                                cursor: "pointer",
                                textAlign: "left",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span
                                    style={{
                                      fontSize: "10px",
                                      fontWeight: 700,
                                      textTransform: "uppercase",
                                      padding: "2px 6px",
                                      borderRadius: "3px",
                                      backgroundColor: sev.bg,
                                      color: sev.text,
                                    }}
                                  >
                                    {sev.label}
                                  </span>
                                  <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                                    {log.category}
                                  </span>
                                  {log.sourceApp && (
                                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                      • {log.sourceApp}
                                    </span>
                                  )}
                                </div>
                                <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                  {timeStr} WIB
                                </span>
                              </div>

                              <div
                                className="font-mono"
                                style={{
                                  fontSize: "12px",
                                  color: "var(--text-main)",
                                  lineHeight: 1.4,
                                  overflow: "hidden",
                                  display: "-webkit-box",
                                  WebkitLineClamp: 3,
                                  WebkitBoxOrient: "vertical",
                                  wordBreak: "break-word",
                                }}
                              >
                                {log.repeatCount && log.repeatCount > 1 && (
                                  <span
                                    style={{
                                      display: "inline-block",
                                      marginRight: "6px",
                                      padding: "1px 5px",
                                      fontSize: "10px",
                                      fontWeight: 700,
                                      backgroundColor: "#E0E7FF",
                                      color: "#3730A3",
                                      borderRadius: "8px",
                                    }}
                                  >
                                    x{log.repeatCount}
                                  </span>
                                )}
                                {log.message}
                              </div>

                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px", fontSize: "11px", color: "var(--text-secondary)" }}>
                                <span>{log.parsed?.src_ip ? `IP: ${log.parsed.src_ip}` : dateStr}</span>
                                <span style={{ color: "var(--accent-blue)", fontWeight: 600 }}>Detail →</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}

                  {hasMoreLogs && (
                    <div style={{ padding: "12px", textAlign: "center", borderTop: "1px solid var(--border-color)" }}>
                      <button
                        type="button"
                        onClick={() => fetchLogs(logCursor, true)}
                        disabled={isLogsLoading}
                        style={{
                          padding: "6px 16px",
                          fontSize: "12px",
                          fontWeight: 600,
                          backgroundColor: "#FFFFFF",
                          border: "1px solid var(--border-color)",
                          borderRadius: "var(--radius-sm)",
                          cursor: "pointer",
                        }}
                      >
                        {isLogsLoading ? "Memuat..." : "Muat Lebih Banyak Log"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              </SectionErrorBoundary>
            )}

            {/* TAB 3: INSIDEN */}
            {activeTab === "insiden" && (
              <SectionErrorBoundary sectionName="Insiden Perangkat">
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    padding: "12px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Status:</span>
                    <select
                      value={incidentFilterStatus}
                      onChange={(e) => setIncidentFilterStatus(e.target.value)}
                      style={{
                        padding: "5px 10px",
                        fontSize: "12px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="all">Semua Status</option>
                      <option value="open">Terbuka (Open)</option>
                      <option value="ack">Ditinjau (Ack)</option>
                      <option value="closed">Selesai (Closed)</option>
                    </select>
                  </div>

                  <button
                    onClick={() => fetchIncidents()}
                    style={{
                      padding: "5px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#FFFFFF",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      cursor: "pointer",
                    }}
                  >
                    Segarkan
                  </button>
                </div>

                <div
                  style={{
                    backgroundColor: "var(--bg-panel)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-md)",
                    overflow: "hidden",
                  }}
                >
                  {isIncidentsLoading ? (
                    <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                      Memuat daftar insiden perangkat...
                    </div>
                  ) : incidents.length === 0 ? (
                    <div style={{ padding: "48px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px" }}>
                      Tidak ada insiden yang terdeteksi untuk perangkat ini.
                    </div>
                  ) : (
                    <>
                      <div className="desktop-only" style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F8FAFC", borderBottom: "1px solid var(--border-color)" }}>
                          <th style={{ padding: "10px 14px" }}>Status</th>
                          <th style={{ padding: "10px 14px" }}>Keparahan</th>
                          <th style={{ padding: "10px 14px" }}>Judul Insiden & Entitas</th>
                          <th style={{ padding: "10px 14px", textAlign: "center" }}>Frekuensi</th>
                          <th style={{ padding: "10px 14px" }}>Terakhir Terlihat</th>
                          <th style={{ padding: "10px 14px", textAlign: "right" }}>Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {incidents.map((inc) => (
                          <tr key={inc.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                            <td style={{ padding: "10px 14px" }}>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  backgroundColor: inc.status === "open" ? "#FEF2F2" : inc.status === "ack" ? "#EFF6FF" : "#F1F5F9",
                                  color: inc.status === "open" ? "var(--accent-red)" : inc.status === "ack" ? "var(--accent-blue)" : "#475569",
                                }}
                              >
                                {inc.status.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: "3px",
                                  backgroundColor: inc.severity === "critical" ? "#FEF2F2" : inc.severity === "high" ? "#FFF7ED" : "#FEFCE8",
                                  color: inc.severity === "critical" ? "#991B1B" : inc.severity === "high" ? "#9A3412" : "#854D0E",
                                }}
                              >
                                {inc.severity.toUpperCase()}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <div style={{ fontWeight: 600 }}>{inc.title}</div>
                              {inc.mainEntity && (
                                <div className="font-mono" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                  Entitas: {inc.mainEntity}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "center" }}>
                              <strong>{inc.count}x</strong>
                            </td>
                            <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>
                              {new Date(inc.lastSeen).toLocaleTimeString("id-ID", {
                                timeZone: "Asia/Jakarta",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}{" "}
                              WIB
                            </td>
                            <td style={{ padding: "10px 14px", textAlign: "right" }}>
                              <button
                                onClick={() => {
                                  setSelectedIncident(inc);
                                  setAiAnalysis(null);
                                  setAiError(null);
                                }}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "var(--radius-sm)",
                                  cursor: "pointer",
                                  color: "var(--accent-blue)",
                                }}
                              >
                                Detail & AI
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Incident Cards */}
                  <div className="mobile-only" style={{ display: "none" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "12px" }}>
                      {incidents.map((inc) => {
                        const isCrit = inc.severity === "critical";
                        const isHigh = inc.severity === "high";

                        return (
                          <div
                            key={`mob-inc-${inc.id}`}
                            style={{
                              backgroundColor: "#FFFFFF",
                              border: "1px solid var(--border-color)",
                              borderLeft: isCrit
                                ? "4px solid var(--accent-red)"
                                : isHigh
                                ? "4px solid #E65100"
                                : "4px solid #F57F17",
                              borderRadius: "var(--radius-sm)",
                              padding: "12px 14px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "8px",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: 700,
                                    padding: "2px 6px",
                                    borderRadius: "3px",
                                    backgroundColor: isCrit ? "#FEF2F2" : isHigh ? "#FFF7ED" : "#FEFCE8",
                                    color: isCrit ? "#991B1B" : isHigh ? "#9A3412" : "#854D0E",
                                  }}
                                >
                                  {inc.severity.toUpperCase()}
                                </span>
                                <span
                                  style={{
                                    fontSize: "10px",
                                    fontWeight: 600,
                                    padding: "2px 6px",
                                    borderRadius: "3px",
                                    backgroundColor: inc.status === "open" ? "#FEF2F2" : inc.status === "ack" ? "#EFF6FF" : "#F1F5F9",
                                    color: inc.status === "open" ? "var(--accent-red)" : inc.status === "ack" ? "var(--accent-blue)" : "#475569",
                                  }}
                                >
                                  {inc.status.toUpperCase()}
                                </span>
                              </div>

                              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                {new Date(inc.lastSeen).toLocaleTimeString("id-ID", {
                                  timeZone: "Asia/Jakarta",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}{" "}
                                WIB
                              </span>
                            </div>

                            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-main)" }}>
                              {inc.title}
                            </div>

                            {inc.mainEntity && (
                              <div className="font-mono" style={{ fontSize: "11px", color: "var(--text-secondary)" }}>
                                Entitas: {inc.mainEntity}
                              </div>
                            )}

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "4px", paddingTop: "8px", borderTop: "1px solid var(--border-color)" }}>
                              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                                Frekuensi: <strong style={{ color: "var(--text-main)" }}>{inc.count}x</strong>
                              </span>

                              <button
                                type="button"
                                onClick={() => setSelectedIncident(inc)}
                                className="touch-target"
                                style={{
                                  padding: "6px 14px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                  backgroundColor: "#FFFFFF",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "var(--radius-sm)",
                                  cursor: "pointer",
                                  color: "var(--accent-blue)",
                                }}
                              >
                                Detail & AI →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
                </div>
              </div>
              </SectionErrorBoundary>
            )}

            {/* TAB 4: KONFIGURASI */}
            {activeTab === "konfigurasi" && (
              <SectionErrorBoundary sectionName="Panduan Konfigurasi">
              <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                <DeviceConfigGuide
                  deviceType={device.type}
                  deviceName={device.name}
                  deviceIp={device.ipAddress}
                  syslogPort={serverConfig.syslogUdpPort}
                />

                {/* Panel Sumber Tidak Dikenal (Admin) */}
                <UnknownSourcesPanel
                  initialSources={unknownSources}
                  onDeviceRegisteredOrBound={() => {
                    fetchStats(true);
                  }}
                />

                {/* Filter Log Perangkat & Pembersihan */}
                <LogFilterManager
                  deviceId={deviceId}
                  deviceName={device.name}
                  initialPattern={filterPrefillPattern}
                  onClearInitialPattern={() => setFilterPrefillPattern(null)}
                />

                {/* Hapus Perangkat */}
                <div
                  style={{
                    backgroundColor: "#FEF2F2",
                    border: "1px solid #FCA5A5",
                    borderRadius: "var(--radius-md)",
                    padding: "20px 24px",
                  }}
                >
                  <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#991B1B", marginBottom: "4px" }}>
                    Zona Berbahaya: Hapus Perangkat
                  </h3>
                  <p style={{ fontSize: "12px", color: "#7F1D1D", marginBottom: "12px" }}>
                    Menghapus perangkat ini akan menghapus seluruh data event log, status token, dan rekaman insiden secara permanen.
                  </p>
                  <button
                    type="button"
                    disabled={isDeletingDevice}
                    onClick={() => setIsDeleteModalOpen(true)}
                    style={{
                      padding: "7px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                      backgroundColor: "#DC2626",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "var(--radius-sm)",
                      cursor: isDeletingDevice ? "not-allowed" : "pointer",
                      opacity: isDeletingDevice ? 0.6 : 1,
                    }}
                  >
                    {isDeletingDevice ? "Memproses..." : "Hapus Perangkat Ini"}
                  </button>
                </div>
              </div>
              </SectionErrorBoundary>
            )}
          </div>
        )}
      </main>

      {/* MODAL 1: Detail Log Raw & Parsed */}
      {selectedLog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "700px",
              maxHeight: "85vh",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ fontSize: "15px", fontWeight: 700 }}>Detail Event Log</h3>
              <button onClick={() => setSelectedLog(null)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer" }}>
                &times;
              </button>
            </div>
            <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px" }}>
              {/* Banner Pesan Berulang (Deduplikasi) */}
              {selectedLog.repeatCount && selectedLog.repeatCount > 1 && (
                <div
                  style={{
                    backgroundColor: "#EFF6FF",
                    border: "1px solid #BFDBFE",
                    borderRadius: "6px",
                    padding: "12px 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#1E40AF", fontSize: "12px" }}>
                    PESAN BERULANG (DEDUPLIKASI 60 DETIK)
                  </div>
                  <div style={{ fontSize: "12px", color: "#1E3A8A" }}>
                    Pesan dengan isi sama ini tercatat berulang sebanyak{" "}
                    <strong>{selectedLog.repeatCount} kali</strong> dan otomatis digabung menjadi satu baris.
                  </div>
                  <div style={{ fontSize: "11px", color: "#3B82F6", marginTop: "2px" }}>
                    Waktu Pertama:{" "}
                    {selectedLog.firstEventTime
                      ? `${new Date(selectedLog.firstEventTime).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                        })} WIB`
                      : "-"}{" "}
                    &bull; Waktu Terakhir:{" "}
                    {new Date(selectedLog.eventTime).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                    })}{" "}
                    WIB
                  </div>
                </div>
              )}

              {/* Detail Waktu & Timestamp */}
              <div style={{ backgroundColor: "#F8FAFC", border: "1px solid var(--border-color)", borderRadius: "6px", padding: "12px" }}>
                <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: "8px", fontSize: "11px", letterSpacing: "0.5px" }}>
                  RINCIAN WAKTU & SINKRONISASI
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: "6px", columnGap: "8px" }}>
                  <span style={{ color: "var(--text-secondary)" }}>Waktu Event (WIB):</span>
                  <span style={{ fontWeight: 600 }}>
                    {new Date(selectedLog.eventTime).toLocaleString("id-ID", {
                      timeZone: "Asia/Jakarta",
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}{" "}
                    WIB
                  </span>

                  <span style={{ color: "var(--text-secondary)" }}>Waktu Event (UTC):</span>
                  <span className="font-mono">
                    {new Date(selectedLog.eventTime).toISOString().replace("T", " ").substring(0, 19)} UTC
                  </span>

                  <span style={{ color: "var(--text-secondary)" }}>Waktu Relatif:</span>
                  <span>{getRelativeTimeString(new Date(selectedLog.eventTime))}</span>

                  <span style={{ color: "var(--text-secondary)" }}>Diterima Server:</span>
                  <span>
                    {selectedLog.receivedAt
                      ? `${new Date(selectedLog.receivedAt).toLocaleString("id-ID", {
                          timeZone: "Asia/Jakarta",
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })} WIB`
                      : "-"}
                  </span>

                  {selectedLog.parsed?.device_time && (
                    <>
                      <span style={{ color: "var(--text-secondary)" }}>Jam Asli Perangkat:</span>
                      <span className="font-mono">{String(selectedLog.parsed.device_time)}</span>
                    </>
                  )}

                  {selectedLog.parsed?.clock_skew_seconds !== undefined &&
                    selectedLog.parsed?.clock_skew_seconds !== null && (
                      <>
                        <span style={{ color: "#D97706", fontWeight: 600 }}>Clock Skew:</span>
                        <div>
                          <span
                            style={{
                              display: "inline-block",
                              backgroundColor: "#FEF3C7",
                              color: "#92400E",
                              border: "1px solid #FCD34D",
                              borderRadius: "4px",
                              padding: "2px 6px",
                              fontSize: "11px",
                              fontWeight: 600,
                            }}
                          >
                            Jam perangkat berbeda{" "}
                            {formatClockSkewDescription(Number(selectedLog.parsed.clock_skew_seconds))} dari server
                          </span>
                        </div>
                      </>
                    )}
                </div>
              </div>

              {/* Informasi Log Lainnya */}
              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", rowGap: "6px", columnGap: "8px" }}>
                <span style={{ color: "var(--text-secondary)" }}>Tingkat Keparahan:</span>
                <div>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: 700,
                      backgroundColor:
                        selectedLog.severity <= 3 ? "#FEE2E2" : selectedLog.severity <= 4 ? "#FEF3C7" : "#E2E8F0",
                      color:
                        selectedLog.severity <= 3 ? "#991B1B" : selectedLog.severity <= 4 ? "#92400E" : "#334155",
                    }}
                  >
                    Level {selectedLog.severity} - {SEVERITY_NAMES[selectedLog.severity]?.label || "UNKNOWN"}
                  </span>
                </div>

                <span style={{ color: "var(--text-secondary)" }}>Kategori / Fasilitas:</span>
                <span>{selectedLog.category || "-"}</span>

                <span style={{ color: "var(--text-secondary)" }}>Aplikasi / Tag:</span>
                <span className="font-mono">{selectedLog.sourceApp || "-"}</span>

                {selectedLog.parsed?.src_ip && (
                  <>
                    <span style={{ color: "var(--text-secondary)" }}>Source IP:</span>
                    <span className="font-mono">{String(selectedLog.parsed.src_ip)}</span>
                  </>
                )}

                {selectedLog.parsed?.actor && (
                  <>
                    <span style={{ color: "var(--text-secondary)" }}>Aktor / User:</span>
                    <span style={{ fontWeight: 600 }}>{String(selectedLog.parsed.actor)}</span>
                  </>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>PESAN LOG (RAW):</div>
                <div
                  className="font-mono"
                  style={{
                    backgroundColor: "#1E293B",
                    color: "#F8FAFC",
                    padding: "10px 12px",
                    borderRadius: "4px",
                    wordBreak: "break-all",
                    maxHeight: "150px",
                    overflowY: "auto",
                  }}
                >
                  {selectedLog.message}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, color: "var(--text-secondary)", marginBottom: "4px" }}>HASIL NORMALISASI (PARSED JSON):</div>
                <pre
                  className="font-mono"
                  style={{
                    backgroundColor: "#F8FAFC",
                    border: "1px solid var(--border-color)",
                    padding: "10px 12px",
                    borderRadius: "4px",
                    overflowX: "auto",
                    maxHeight: "200px",
                  }}
                >
                  {JSON.stringify(selectedLog.parsed, null, 2)}
                </pre>
              </div>
            </div>
            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setFilterPrefillPattern(selectedLog.message);
                  setSelectedLog(null);
                  setActiveTab("konfigurasi");
                }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 12px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "#FEF2F2",
                  color: "#991B1B",
                  border: "1px solid #FCA5A5",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                Abaikan pesan seperti ini
              </button>
              <button
                onClick={() => setSelectedLog(null)}
                style={{ padding: "6px 14px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Detail Insiden & AI */}
      {selectedIncident && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "750px",
              maxHeight: "85vh",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between" }}>
              <div>
                <h3 style={{ fontSize: "15px", fontWeight: 700 }}>{selectedIncident.title}</h3>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  Rule: {selectedIncident.ruleKey} &bull; Entitas: {selectedIncident.mainEntity || "-"}
                </div>
              </div>
              <button onClick={() => setSelectedIncident(null)} style={{ background: "none", border: "none", fontSize: "18px", cursor: "pointer" }}>
                &times;
              </button>
            </div>

            <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", fontSize: "12px" }}>
              {/* Rekomendasi Khusus Log Flood */}
              {selectedIncident.ruleKey === "log_flood" && (
                <div
                  style={{
                    backgroundColor: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: "6px",
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#991B1B", fontSize: "13px" }}>
                    Terdeteksi Banjir Log Berulang (Loop Script / Scheduler)
                  </div>
                  <div style={{ fontSize: "12px", color: "#7F1D1D", lineHeight: "1.5" }}>
                    {selectedIncident.evidence?.[0]?.details?.recommendation ||
                      "Pesan ini kemungkinan berasal dari script atau scheduler yang memicu log baru (loop). Periksa /system scheduler dan /system script di perangkat, atau gunakan syslog native sebagai pengganti fetch."}
                  </div>
                  {selectedIncident.evidence?.[0]?.details?.ratePerMinute && (
                    <div style={{ fontSize: "11px", color: "#991B1B", fontWeight: 600 }}>
                      Laju: ~{selectedIncident.evidence[0].details.ratePerMinute} pesan/menit &bull; Porsi:{" "}
                      {selectedIncident.evidence[0].details.percentageOfDeviceLogs}% dari total log perangkat
                    </div>
                  )}
                  <div style={{ marginTop: "4px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        const pat =
                          selectedIncident.evidence?.[0]?.details?.sampleMessage ||
                          selectedIncident.mainEntity ||
                          "";
                        setFilterPrefillPattern(pat);
                        setSelectedIncident(null);
                        setActiveTab("konfigurasi");
                      }}
                      style={{
                        padding: "6px 14px",
                        fontSize: "12px",
                        fontWeight: 600,
                        backgroundColor: "#DC2626",
                        color: "#FFFFFF",
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        cursor: "pointer",
                      }}
                    >
                      Buat Aturan Abaikan dari Pola Ini
                    </button>
                  </div>
                </div>
              )}

              {/* Tombol trigger AI */}
              <div style={{ backgroundColor: "#F8FAFC", padding: "14px", borderRadius: "4px", border: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>Investigasi & Rekomendasi AI</strong>
                  <button
                    onClick={() => handleAnalyzeIncident(selectedIncident.id, true)}
                    disabled={isAiLoading}
                    style={{
                      padding: "5px 12px",
                      fontSize: "12px",
                      backgroundColor: "var(--accent-blue)",
                      color: "#FFFFFF",
                      border: "none",
                      borderRadius: "3px",
                      cursor: "pointer",
                    }}
                  >
                    {isAiLoading ? "Menganalisa..." : aiAnalysis ? "Analisa Ulang" : "Analisa AI"}
                  </button>
                </div>

                {aiError && <div style={{ color: "#991B1B", marginBottom: "6px" }}>{aiError}</div>}

                {aiAnalysis ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", lineHeight: "1.5" }}>
                    <div><strong>Ringkasan:</strong> {aiAnalysis.summary}</div>
                    {aiAnalysis.cliCommands?.length > 0 && (
                      <div>
                        <strong>Perintah Solusi:</strong>
                        {aiAnalysis.cliCommands.map((cmd: string, idx: number) => (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              backgroundColor: "#1E293B",
                              color: "#F8FAFC",
                              padding: "6px 10px",
                              borderRadius: "4px",
                              marginTop: "4px",
                            }}
                          >
                            <span className="font-mono">{cmd}</span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(cmd);
                                setCopiedCmd(cmd);
                                setTimeout(() => setCopiedCmd(null), 2000);
                              }}
                              style={{
                                padding: "2px 6px",
                                fontSize: "10px",
                                backgroundColor: copiedCmd === cmd ? "#16A34A" : "#475569",
                                color: "#FFF",
                                border: "none",
                                borderRadius: "2px",
                                cursor: "pointer",
                              }}
                            >
                              {copiedCmd === cmd ? "Tersalin!" : "Salin"}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-secondary)" }}>
                    Klik &quot;Analisa AI&quot; untuk mengidentifikasi tingkat ancaman dan perintah solusi spesifik untuk perangkat ini.
                  </div>
                )}
              </div>

              {/* Bukti Log */}
              <div>
                <strong style={{ fontSize: "13px" }}>Bukti Log ({selectedIncident.evidence?.length || 0} event):</strong>
                <div style={{ marginTop: "6px", maxHeight: "180px", overflowY: "auto", border: "1px solid var(--border-color)", borderRadius: "4px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                    <tbody>
                      {selectedIncident.evidence?.map((ev: any, idx: number) => (
                        <tr key={idx} style={{ borderBottom: "1px solid #F1F5F9" }}>
                          <td className="font-mono" style={{ padding: "6px 10px", wordBreak: "break-all" }}>
                            {ev.message || JSON.stringify(ev)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                {selectedIncident.status !== "ack" && (
                  <button
                    onClick={() => handleUpdateIncidentStatus(selectedIncident.id, "ack")}
                    style={{ padding: "5px 10px", fontSize: "11px", backgroundColor: "#EFF6FF", color: "var(--accent-blue)", border: "1px solid #BFDBFE", borderRadius: "3px", cursor: "pointer" }}
                  >
                    Tandai Ditinjau
                  </button>
                )}
                {selectedIncident.status !== "closed" && (
                  <button
                    onClick={() => handleUpdateIncidentStatus(selectedIncident.id, "closed")}
                    style={{ padding: "5px 10px", fontSize: "11px", backgroundColor: "#F0FDF4", color: "#166534", border: "1px solid #86EFAC", borderRadius: "3px", cursor: "pointer" }}
                  >
                    Tutup Insiden
                  </button>
                )}
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                style={{ padding: "5px 12px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "3px", cursor: "pointer" }}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Token Ingest Baru */}
      {newToken && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 110,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "500px",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              padding: "24px",
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--accent-red)", marginBottom: "8px" }}>
              TOKEN INGEST BARU
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
              Salin token ini sekarang. Nilai token hanya ditampilkan sekali dan tidak dapat dilihat kembali.
            </p>
            <div
              className="font-mono"
              style={{
                backgroundColor: "#1E293B",
                color: "#F8FAFC",
                padding: "10px",
                borderRadius: "4px",
                fontSize: "12px",
                wordBreak: "break-all",
                marginBottom: "16px",
              }}
            >
              {newToken}
            </div>
            <div style={{ textAlign: "right" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newToken);
                  setNewToken(null);
                }}
                style={{
                  padding: "8px 16px",
                  fontSize: "12px",
                  fontWeight: 600,
                  backgroundColor: "var(--accent-blue)",
                  color: "#FFF",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                }}
              >
                Salin & Tutup
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal Konfirmasi Buat Ulang Token */}
      <ConfirmModal
        isOpen={isTokenConfirmModalOpen}
        title="Konfirmasi Buat Ulang Token Ingest"
        message={
          <div>
            Token lama untuk perangkat <strong>{device?.name}</strong> akan berhenti berfungsi.
            Agen yang memakai token lama harus segera diperbarui dengan token baru.
          </div>
        }
        confirmLabel="Buat Ulang Token"
        cancelLabel="Batal"
        isDanger={true}
        isLoading={isRegeneratingToken}
        onConfirm={handleExecuteRegenerateToken}
        onCancel={() => setIsTokenConfirmModalOpen(false)}
      />

      {/* Modal Konfirmasi Hapus Perangkat */}
      <ConfirmModal
        isOpen={isDeleteModalOpen}
        title="Hapus Perangkat Permanen"
        message={
          <div>
            Apakah Anda yakin ingin menghapus permanen perangkat <strong>{device?.name}</strong>?
            Seluruh data event log, status token, dan rekaman insiden akan dihapus secara permanen dari basis data.
          </div>
        }
        confirmLabel="Hapus Permanen"
        cancelLabel="Batal"
        isDanger={true}
        isLoading={isDeletingDevice}
        onConfirm={handleExecuteDeleteDevice}
        onCancel={() => setIsDeleteModalOpen(false)}
      />

      {/* Modal Edit IP Perangkat */}
      {isEditIpModalOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(31, 36, 48, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 120,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              borderTop: "3px solid var(--accent-blue)",
              padding: "20px 24px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
            }}
          >
            <h3 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
              Edit Alamat IP Sumber ({device?.name})
            </h3>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "14px" }}>
              Syslog UDP/TCP dikenali dari alamat IP pengirim paket. Kosongkan jika perangkat hanya memakai HTTP Ingest dengan token.
            </p>
            <form onSubmit={handleSaveDeviceIp} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Alamat IP Sumber (IPv4 / IPv6)
                </label>
                <input
                  type="text"
                  value={editIpValue}
                  onChange={(e) => setEditIpValue(e.target.value)}
                  placeholder="Contoh: 103.18.133.181"
                  className="font-mono"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    fontSize: "13px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "6px" }}>
                <button
                  type="button"
                  onClick={() => setIsEditIpModalOpen(false)}
                  disabled={isSavingIp}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    cursor: "pointer",
                  }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSavingIp}
                  style={{
                    padding: "7px 14px",
                    fontSize: "12px",
                    fontWeight: 600,
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--accent-blue)",
                    color: "#FFFFFF",
                    cursor: isSavingIp ? "not-allowed" : "pointer",
                  }}
                >
                  {isSavingIp ? "Menyimpan..." : "Simpan IP"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notifikasi Ringan */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
