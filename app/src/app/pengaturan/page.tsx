"use client";

import { useEffect, useState } from "react";
import { LogFilterManager } from "@/components/LogFilterManager";
import { UnknownSourcesPanel } from "@/components/UnknownSourcesPanel";
import { SectionErrorBoundary } from "@/components/SectionErrorBoundary";
import { formatWIBDateTime } from "@/lib/datetime";

interface DetectionThresholds {
  brute_force_login?: { failures: number; windowSeconds: number };
  password_spray?: { accounts: number; windowSeconds: number };
  port_scan?: { ports: number; windowSeconds: number };
  device_silent?: { silentMinutes: number };
  log_burst?: { multiplier: number };
  [key: string]: any;
}

interface NotificationChannel {
  id: string;
  name: string;
  type: "telegram" | "email";
  isActive: boolean;
  events?: string[];
  createdAt: string;
}

interface NotificationLogItem {
  id: string;
  channelId: string | null;
  channelType: string;
  recipient: string;
  status: "sent" | "failed";
  error: string | null;
  sentAt: string;
}

export default function SettingsPage() {
  const [userRole, setUserRole] = useState<string>("admin");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Settings State
  const [logRetentionDays, setLogRetentionDays] = useState<number>(30);
  const [ipAllowlistText, setIpAllowlistText] = useState<string>("");
  const [aiProvider, setAiProvider] = useState<string>("mock");
  const [aiModel, setAiModel] = useState<string>("claude-3-5-sonnet-20241022");
  const [aiApiKey, setAiApiKey] = useState<string>("");
  const [aiBaseUrl, setAiBaseUrl] = useState<string>("");
  const [aiHourlyLimit, setAiHourlyLimit] = useState<number>(20);

  // Thresholds State
  const [bruteForceFailures, setBruteForceFailures] = useState<number>(5);
  const [bruteForceWindow, setBruteForceWindow] = useState<number>(300);
  const [passwordSprayAccounts, setPasswordSprayAccounts] = useState<number>(5);
  const [passwordSprayWindow, setPasswordSprayWindow] = useState<number>(300);
  const [portScanPorts, setPortScanPorts] = useState<number>(20);
  const [portScanWindow, setPortScanWindow] = useState<number>(60);
  const [deviceSilentMinutes, setDeviceSilentMinutes] = useState<number>(15);
  const [logBurstMultiplier, setLogBurstMultiplier] = useState<number>(5);

  // Saluran Notifikasi State
  const [channels, setChannels] = useState<NotificationChannel[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLogItem[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; msg: string } | null>(null);

  // Modal Tambah Saluran
  const [newChannelType, setNewChannelType] = useState<"telegram" | "email">("telegram");
  const [newChannelName, setNewChannelName] = useState("");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [emailHost, setEmailHost] = useState("");
  const [emailPort, setEmailPort] = useState(587);
  const [emailUser, setEmailUser] = useState("");
  const [emailPass, setEmailPass] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [newChannelEvents, setNewChannelEvents] = useState<string[]>([
    "ping_rto",
    "ping_recovered",
    "device_offline",
    "device_recovered",
    "flapping_detected",
  ]);
  const [isSubmittingChannel, setIsSubmittingChannel] = useState(false);

  // Kesalahan Klien State
  const [clientErrorsList, setClientErrorsList] = useState<Array<{
    id: string;
    sidikJari: string;
    nama: string;
    pesan: string;
    path: string;
    komponen: string | null;
    buildId: string;
    tipe: string;
    jumlah: number;
    terakhirTerjadi: string;
    status: "baru" | "selesai";
  }>>([]);
  const [isLoadingClientErrors, setIsLoadingClientErrors] = useState(false);
  const [clientErrorFilter, setClientErrorFilter] = useState<"semua" | "baru" | "selesai">("baru");
  const [updatingErrorId, setUpdatingErrorId] = useState<string | null>(null);

  // Diagnostik Sistem State
  const [diagnostikData, setDiagnostikData] = useState<any | null>(null);
  const [isLoadingDiagnostik, setIsLoadingDiagnostik] = useState(false);
  const [diagnostikError, setDiagnostikError] = useState<string | null>(null);

  const fetchDiagnostik = async () => {
    setIsLoadingDiagnostik(true);
    setDiagnostikError(null);
    try {
      const res = await fetch("/api/admin/diagnostik");
      if (!res.ok) {
        if (res.status === 403) {
          setDiagnostikError("Hanya akun dengan peran 'admin' yang dapat mengakses data diagnostik sistem.");
        } else {
          setDiagnostikError(`Gagal memuat data diagnostik (HTTP ${res.status}).`);
        }
        return;
      }
      const data = await res.json();
      setDiagnostikData(data);
    } catch (err: any) {
      console.error("Gagal memuat data diagnostik:", err);
      setDiagnostikError("Tidak dapat terhubung ke server untuk pemeriksaan diagnostik.");
    } finally {
      setIsLoadingDiagnostik(false);
    }
  };

  const fetchClientErrors = async (status = clientErrorFilter) => {
    setIsLoadingClientErrors(true);
    try {
      const res = await fetch(`/api/client-error?status=${status}&limit=50`);
      if (res.ok) {
        const json = await res.json();
        setClientErrorsList(json.errors || []);
      }
    } catch (err) {
      console.error("Gagal memuat log kesalahan klien:", err);
    } finally {
      setIsLoadingClientErrors(false);
    }
  };

  const handleToggleErrorStatus = async (id: string, currentStatus: "baru" | "selesai") => {
    setUpdatingErrorId(id);
    try {
      const newStatus = currentStatus === "baru" ? "selesai" : "baru";
      const res = await fetch("/api/client-error", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        setClientErrorsList((prev) =>
          prev.map((e) => (e.id === id ? { ...e, status: newStatus } : e))
        );
      }
    } catch (err) {
      console.error("Gagal memperbarui status kesalahan:", err);
    } finally {
      setUpdatingErrorId(null);
    }
  };

  const fetchSettings = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || "Gagal memuat pengaturan.");
        setIsLoading(false);
        return;
      }

      setUserRole(data.userRole || "admin");
      const s = data.settings || {};

      if (s.log_retention_days) {
        setLogRetentionDays(Number(s.log_retention_days) || 30);
      }

      if (s.ip_allowlist) {
        if (Array.isArray(s.ip_allowlist)) {
          setIpAllowlistText(s.ip_allowlist.join("\n"));
        } else if (typeof s.ip_allowlist === "string") {
          setIpAllowlistText(s.ip_allowlist);
        }
      }

      if (s.ai_provider) setAiProvider(s.ai_provider);
      if (s.ai_model) setAiModel(s.ai_model);
      if (s.ai_api_key) setAiApiKey(s.ai_api_key);
      if (s.ai_base_url) setAiBaseUrl(s.ai_base_url);
      if (s.ai_analysis_hourly_limit) setAiHourlyLimit(Number(s.ai_analysis_hourly_limit) || 20);

      const dt: DetectionThresholds = s.detection_thresholds || {};
      if (dt.brute_force_login?.failures) setBruteForceFailures(dt.brute_force_login.failures);
      if (dt.brute_force_login?.windowSeconds) setBruteForceWindow(dt.brute_force_login.windowSeconds);
      if (dt.password_spray?.accounts) setPasswordSprayAccounts(dt.password_spray.accounts);
      if (dt.password_spray?.windowSeconds) setPasswordSprayWindow(dt.password_spray.windowSeconds);
      if (dt.port_scan?.ports) setPortScanPorts(dt.port_scan.ports);
      if (dt.port_scan?.windowSeconds) setPortScanWindow(dt.port_scan.windowSeconds);
      if (dt.device_silent?.silentMinutes) setDeviceSilentMinutes(dt.device_silent.silentMinutes);
      if (dt.log_burst?.multiplier) setLogBurstMultiplier(dt.log_burst.multiplier);
    } catch (err) {
      console.error(err);
      setErrorMessage("Tidak dapat terhubung ke server saat memuat pengaturan.");
    } finally {
      setIsLoading(false);
    }
  };

  const fetchNotifications = async () => {
    setIsLoadingNotifications(true);
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        setChannels(data.channels || []);
        setNotificationLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Gagal memuat saluran notifikasi:", err);
    } finally {
      setIsLoadingNotifications(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    fetchNotifications();
    fetchClientErrors();
    fetchDiagnostik();
  }, []);

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingChannel(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    let config: any = {};
    if (newChannelType === "telegram") {
      config = { botToken: tgBotToken, chatId: tgChatId };
    } else {
      config = {
        host: emailHost,
        port: Number(emailPort) || 587,
        auth: { user: emailUser, pass: emailPass },
        from: emailFrom,
        to: emailTo,
      };
    }

    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newChannelType,
          name: newChannelName,
          config,
          events: newChannelEvents,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Gagal membuat saluran notifikasi.");
        return;
      }

      setSuccessMessage(`Saluran notifikasi '${newChannelName}' berhasil ditambahkan.`);
      setIsChannelModalOpen(false);
      setNewChannelName("");
      setTgBotToken("");
      setTgChatId("");
      setEmailHost("");
      setEmailPort(587);
      setEmailUser("");
      setEmailPass("");
      setEmailFrom("");
      setEmailTo("");
      setNewChannelEvents([
        "ping_rto",
        "ping_recovered",
        "device_offline",
        "device_recovered",
        "flapping_detected",
      ]);
      fetchNotifications();
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan.");
    } finally {
      setIsSubmittingChannel(false);
    }
  };

  const handleToggleChannel = async (channel: NotificationChannel) => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: channel.id,
          isActive: !channel.isActive,
        }),
      });
      if (res.ok) {
        fetchNotifications();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteChannel = async (id: string, name: string) => {
    if (!confirm(`Hapus saluran notifikasi '${name}'?`)) return;
    try {
      const res = await fetch(`/api/notifications?id=${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setSuccessMessage(`Saluran '${name}' berhasil dihapus.`);
        fetchNotifications();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestNotification = async (channelId: string) => {
    setTestingChannelId(channelId);
    setTestResult(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult({ id: channelId, success: true, msg: "Tes notifikasi berhasil terkirim!" });
      } else {
        setTestResult({ id: channelId, success: false, msg: data.error || "Gagal mengirim tes notifikasi." });
      }
      fetchNotifications();
    } catch (err) {
      setTestResult({ id: channelId, success: false, msg: "Kesalahan jaringan saat tes." });
    } finally {
      setTestingChannelId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== "admin") {
      alert("Hanya pengguna berhak akses Administrator yang dapat mengubah pengaturan.");
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const allowlistArray = ipAllowlistText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const detectionThresholds: DetectionThresholds = {
      brute_force_login: { failures: bruteForceFailures, windowSeconds: bruteForceWindow },
      password_spray: { accounts: passwordSprayAccounts, windowSeconds: passwordSprayWindow },
      port_scan: { ports: portScanPorts, windowSeconds: portScanWindow },
      device_silent: { silentMinutes: deviceSilentMinutes },
      log_burst: { multiplier: logBurstMultiplier },
    };

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          log_retention_days: logRetentionDays,
          ip_allowlist: allowlistArray,
          ai_provider: aiProvider,
          ai_model: aiModel,
          ai_api_key: aiApiKey,
          ai_base_url: aiBaseUrl,
          ai_analysis_hourly_limit: aiHourlyLimit,
          detection_thresholds: detectionThresholds,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Gagal menyimpan pengaturan.");
        return;
      }

      setSuccessMessage("Pengaturan sistem berhasil disimpan dan diterapkan.");
      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error(err);
      setErrorMessage("Terjadi kesalahan jaringan saat menyimpan pengaturan.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "var(--bg-app)" }}>
      <main className="page-bottom-padding" style={{ maxWidth: "1000px", margin: "0 auto", padding: "28px 24px" }}>
        {/* Title */}
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--text-main)",
              letterSpacing: "-0.4px",
            }}
          >
            Pengaturan Sistem
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Kelola retensi penyimpanan log, daftar IP yang diizinkan, ambang batas deteksi serangan, dan penyedia AI.
          </p>
        </div>

        {errorMessage && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "20px",
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
              marginBottom: "20px",
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
            Memuat konfigurasi sistem...
          </div>
        ) : (
          <form onSubmit={handleSaveSettings} style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Bagian 1: Retensi Log */}
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                1. Retensi Penyimpanan Log
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Log yang berumur lebih lama dari masa retensi akan dihapus secara otomatis untuk menjaga ketersediaan ruang penyimpanan.
              </p>

              <div style={{ maxWidth: "300px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                  Masa Retensi Log (Hari)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={logRetentionDays}
                    onChange={(e) => setLogRetentionDays(parseInt(e.target.value, 10) || 30)}
                    disabled={userRole !== "admin"}
                    style={{
                      width: "120px",
                      padding: "7px 10px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                      color: "var(--text-main)",
                    }}
                  />
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>hari</span>
                </div>
              </div>
            </div>

            {/* Bagian 2: Keamanan Jaringan & Allowlist */}
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                2. Keamanan Akses & IP Allowlist
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Batasi IP yang diizinkan mengakses konsol web dan pengiriman log HTTP. Kosongkan jika ingin mengizinkan dari semua jaringan.
              </p>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                  Daftar IP / CIDR yang Diizinkan (Satu per baris)
                </label>
                <textarea
                  rows={4}
                  value={ipAllowlistText}
                  onChange={(e) => setIpAllowlistText(e.target.value)}
                  placeholder="Contoh:&#10;192.168.1.0/24&#10;10.0.0.5"
                  disabled={userRole !== "admin"}
                  className="font-mono"
                  style={{
                    width: "100%",
                    maxWidth: "500px",
                    padding: "8px 12px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    color: "var(--text-main)",
                  }}
                />
              </div>
            </div>

            {/* Bagian 3: Ambang Batas Rule Deteksi */}
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                3. Ambang Batas Deteksi Anomali & Serangan
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Sesuaikan sensitivitas Rule Engine deteksi keamanan JagaLog untuk mengurangi false positive.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "20px",
                }}
              >
                {/* Brute Force */}
                <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    Brute Force Login
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Kegagalan login beruntun pada akun yang sama.
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={bruteForceFailures}
                      onChange={(e) => setBruteForceFailures(parseInt(e.target.value, 10) || 5)}
                      style={{ width: "70px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>kali dalam</span>
                    <input
                      type="number"
                      min="10"
                      max="3600"
                      value={bruteForceWindow}
                      onChange={(e) => setBruteForceWindow(parseInt(e.target.value, 10) || 300)}
                      style={{ width: "80px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>detik</span>
                  </div>
                </div>

                {/* Password Spray */}
                <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    Password Spray
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Satu IP mencoba login ke banyak akun berbeda.
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}>
                    <input
                      type="number"
                      min="2"
                      max="100"
                      value={passwordSprayAccounts}
                      onChange={(e) => setPasswordSprayAccounts(parseInt(e.target.value, 10) || 5)}
                      style={{ width: "70px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>akun dalam</span>
                    <input
                      type="number"
                      min="10"
                      max="3600"
                      value={passwordSprayWindow}
                      onChange={(e) => setPasswordSprayWindow(parseInt(e.target.value, 10) || 300)}
                      style={{ width: "80px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>detik</span>
                  </div>
                </div>

                {/* Port Scan */}
                <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    Port Scan
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Koneksi ditolak pada banyak port tujuan berbeda.
                  </div>
                  <div style={{ display: "flex", gap: "8px", marginTop: "10px", alignItems: "center" }}>
                    <input
                      type="number"
                      min="5"
                      max="500"
                      value={portScanPorts}
                      onChange={(e) => setPortScanPorts(parseInt(e.target.value, 10) || 20)}
                      style={{ width: "70px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>port dalam</span>
                    <input
                      type="number"
                      min="5"
                      max="600"
                      value={portScanWindow}
                      onChange={(e) => setPortScanWindow(parseInt(e.target.value, 10) || 60)}
                      style={{ width: "80px", padding: "5px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                    />
                    <span style={{ fontSize: "12px" }}>detik</span>
                  </div>
                </div>

                {/* Device Silent & Burst */}
                <div style={{ padding: "12px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-main)" }}>
                    Perangkat Hening & Lonjakan Log
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Notifikasi jika perangkat mati atau volume membludak.
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "12px", width: "110px" }}>Hening batas:</span>
                      <input
                        type="number"
                        min="5"
                        max="1440"
                        value={deviceSilentMinutes}
                        onChange={(e) => setDeviceSilentMinutes(parseInt(e.target.value, 10) || 15)}
                        style={{ width: "70px", padding: "4px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                      />
                      <span style={{ fontSize: "12px" }}>menit</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "12px", width: "110px" }}>Lonjakan burst:</span>
                      <input
                        type="number"
                        min="2"
                        max="50"
                        value={logBurstMultiplier}
                        onChange={(e) => setLogBurstMultiplier(parseInt(e.target.value, 10) || 5)}
                        style={{ width: "70px", padding: "4px 8px", fontSize: "12px", border: "1px solid var(--border-color)", borderRadius: "4px" }}
                      />
                      <span style={{ fontSize: "12px" }}>x rata-rata</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Bagian 4: Modul Analisa AI */}
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: 700,
                  color: "var(--text-main)",
                  marginBottom: "4px",
                }}
              >
                4. Penyedia Modul Analisa AI (LLM)
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                Pilih penyedia model AI untuk investigasi insiden dan pembuatan ringkasan harian perangkat.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                  gap: "16px",
                  maxWidth: "700px",
                }}
              >
                {/* Provider Selector */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                    Penyedia AI
                  </label>
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                    disabled={userRole !== "admin"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                      color: "var(--text-main)",
                    }}
                  >
                    <option value="mock">Bawaan Sistem (Mock Provider - Tanpa API Key)</option>
                    <option value="anthropic">Anthropic Claude (Claude 3.5 Sonnet / Haiku)</option>
                    <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
                    <option value="ollama">Ollama (Lokal / Self-hosted)</option>
                  </select>
                </div>

                {/* Model Name */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                    Nama Model
                  </label>
                  <input
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder="claude-3-5-sonnet-20241022 / gpt-4o-mini"
                    disabled={userRole !== "admin"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                      color: "var(--text-main)",
                    }}
                  />
                </div>

                {/* API Key */}
                {aiProvider !== "mock" && aiProvider !== "ollama" && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                      API Key
                    </label>
                    <input
                      type="password"
                      value={aiApiKey}
                      onChange={(e) => setAiApiKey(e.target.value)}
                      placeholder="sk-ant-... atau sk-proj-..."
                      disabled={userRole !== "admin"}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                        color: "var(--text-main)",
                        fontFamily: "var(--font-mono)",
                      }}
                    />
                  </div>
                )}

                {/* Base URL (Ollama) */}
                {aiProvider === "ollama" && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                      Ollama Base URL
                    </label>
                    <input
                      type="text"
                      value={aiBaseUrl}
                      onChange={(e) => setAiBaseUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      disabled={userRole !== "admin"}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                        color: "var(--text-main)",
                      }}
                    />
                  </div>
                )}

                {/* Hourly limit */}
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "var(--text-main)", marginBottom: "6px" }}>
                    Batas Panggilan AI / Jam
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={aiHourlyLimit}
                    onChange={(e) => setAiHourlyLimit(parseInt(e.target.value, 10) || 20)}
                    disabled={userRole !== "admin"}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      fontSize: "13px",
                      border: "1px solid var(--border-color)",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "#FFFFFF",
                      color: "var(--text-main)",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Save Button */}
            {userRole === "admin" && (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="touch-target"
                  style={{
                    padding: "10px 24px",
                    fontSize: "13px",
                    fontWeight: 600,
                    backgroundColor: "var(--accent-blue)",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    cursor: isSaving ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                    minHeight: "44px",
                  }}
                >
                  {isSaving ? "Menyimpan Perubahan..." : "Simpan Pengaturan"}
                </button>
              </div>
            )}
          </form>
        )}

        {/* Section 5: Saluran Notifikasi */}
        <div
          style={{
            marginTop: "24px",
            backgroundColor: "var(--bg-panel)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            padding: "24px",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "12px",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.2px" }}>
                5. Saluran Notifikasi (Alerting)
              </h2>
              <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Kirim pemberitahuan otomatis ke Telegram Bot atau Email SMTP saat status perangkat berubah ke <strong>Offline</strong> atau <strong>Pulih (Online)</strong>.
              </p>
            </div>

            {userRole === "admin" && (
              <button
                type="button"
                onClick={() => setIsChannelModalOpen(true)}
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
                + Tambah Saluran
              </button>
            )}
          </div>

          {/* Test Result Message */}
          {testResult && (
            <div
              style={{
                padding: "8px 12px",
                marginBottom: "14px",
                borderRadius: "var(--radius-sm)",
                fontSize: "12px",
                backgroundColor: testResult.success ? "#F0FDF4" : "#FEF2F2",
                border: `1px solid ${testResult.success ? "#86EFAC" : "#FCA5A5"}`,
                color: testResult.success ? "#166534" : "#991B1B",
              }}
            >
              {testResult.msg}
            </div>
          )}

          {/* Tabel Saluran Notifikasi */}
          <div
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-sm)",
              overflow: "hidden",
              marginBottom: "24px",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", textAlign: "left" }}>
              <thead>
                <tr style={{ backgroundColor: "#F8F8F6", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", height: "36px" }}>
                  <th style={{ padding: "0 14px", fontWeight: 600 }}>Tipe</th>
                  <th style={{ padding: "0 14px", fontWeight: 600 }}>Nama Saluran</th>
                  <th style={{ padding: "0 14px", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: "0 14px", fontWeight: 600, textAlign: "right" }}>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingNotifications ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "20px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Memuat saluran notifikasi...
                    </td>
                  </tr>
                ) : channels.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: "24px 14px", textAlign: "center", color: "var(--text-secondary)" }}>
                      Belum ada saluran notifikasi yang dikonfigurasi. Klik <strong>+ Tambah Saluran</strong> untuk mengaktifkan alerting ke Telegram atau Email.
                    </td>
                  </tr>
                ) : (
                  channels.map((ch) => (
                    <tr key={ch.id} style={{ borderBottom: "1px solid var(--border-color)", height: "44px" }}>
                      <td style={{ padding: "0 14px" }}>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 7px",
                            borderRadius: "4px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            backgroundColor: ch.type === "telegram" ? "#EFF6FF" : "#F3E8FF",
                            color: ch.type === "telegram" ? "#1E40AF" : "#6B21A8",
                            border: `1px solid ${ch.type === "telegram" ? "#BFDBFE" : "#E9D5FF"}`,
                          }}
                        >
                          {ch.type}
                        </span>
                      </td>
                      <td style={{ padding: "0 14px", fontWeight: 600, color: "var(--text-main)" }}>
                        {ch.name}
                      </td>
                      <td style={{ padding: "0 14px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            fontSize: "11px",
                            fontWeight: 600,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            color: ch.isActive ? "#15803D" : "var(--text-secondary)",
                            backgroundColor: ch.isActive ? "#F0FDF4" : "#F1F5F9",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              backgroundColor: ch.isActive ? "#22C55E" : "#94A3B8",
                            }}
                          />
                          {ch.isActive ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td style={{ padding: "0 14px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={() => handleTestNotification(ch.id)}
                            disabled={testingChannelId === ch.id}
                            style={{
                              padding: "4px 8px",
                              fontSize: "11px",
                              fontWeight: 600,
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                              backgroundColor: "#FFFFFF",
                              cursor: testingChannelId === ch.id ? "not-allowed" : "pointer",
                              color: "var(--text-main)",
                            }}
                          >
                            {testingChannelId === ch.id ? "Mengirim..." : "Kirim Tes"}
                          </button>
                          {userRole === "admin" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleChannel(ch)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  border: "1px solid var(--border-color)",
                                  borderRadius: "var(--radius-sm)",
                                  backgroundColor: "transparent",
                                  cursor: "pointer",
                                  color: ch.isActive ? "var(--accent-red)" : "var(--accent-blue)",
                                }}
                              >
                                {ch.isActive ? "Nonaktifkan" : "Aktifkan"}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteChannel(ch.id, ch.name)}
                                style={{
                                  padding: "4px 8px",
                                  fontSize: "11px",
                                  border: "1px solid #FECACA",
                                  borderRadius: "var(--radius-sm)",
                                  backgroundColor: "#FEF2F2",
                                  color: "#B91C1C",
                                  cursor: "pointer",
                                }}
                              >
                                Hapus
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Log Pengiriman Notifikasi Terakhir */}
          <div>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-main)", marginBottom: "8px" }}>
              Riwayat Pengiriman Notifikasi (30 Terakhir)
            </h3>
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
                maxHeight: "260px",
                overflowY: "auto",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                <thead>
                  <tr style={{ backgroundColor: "#F8F8F6", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", height: "32px" }}>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Waktu (WIB)</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Tipe</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Penerima</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Status</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Detail / Pesan</th>
                  </tr>
                </thead>
                <tbody>
                  {notificationLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: "16px 12px", textAlign: "center", color: "var(--text-secondary)" }}>
                        Belum ada riwayat pengiriman notifikasi.
                      </td>
                    </tr>
                  ) : (
                    notificationLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: "1px solid var(--border-color)", height: "36px" }}>
                        <td style={{ padding: "0 12px", whiteSpace: "nowrap", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                          {new Date(log.sentAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}
                        </td>
                        <td style={{ padding: "0 12px", textTransform: "uppercase", fontWeight: 600, fontSize: "10px" }}>
                          {log.channelType}
                        </td>
                        <td style={{ padding: "0 12px", fontFamily: "var(--font-mono)", fontSize: "11px" }}>
                          {log.recipient}
                        </td>
                        <td style={{ padding: "0 12px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              fontWeight: 600,
                              backgroundColor: log.status === "sent" ? "#F0FDF4" : "#FEF2F2",
                              color: log.status === "sent" ? "#15803D" : "#B91C1C",
                              border: `1px solid ${log.status === "sent" ? "#BBF7D0" : "#FECACA"}`,
                            }}
                          >
                            {log.status === "sent" ? "Terkirim" : "Gagal"}
                          </span>
                        </td>
                        <td style={{ padding: "0 12px", color: log.error ? "#B91C1C" : "var(--text-secondary)", fontSize: "11px" }}>
                          {log.error || "Notifikasi berhasil disampaikan"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Section 6: Filter Log Global (Noise Filter & Anti-Banjir) */}
        <div style={{ marginTop: "24px" }}>
          <LogFilterManager deviceId={null} />
        </div>

        {/* Section 7: Kesalahan Aplikasi Sisi Klien (Client Error Logging) */}
        <SectionErrorBoundary sectionName="Kesalahan Aplikasi Sisi Klien">
          <div
            style={{
              backgroundColor: "var(--bg-panel)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              padding: "20px 24px",
              marginTop: "24px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "16px",
              }}
            >
              <div>
                <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.2px" }}>
                  7. Kesalahan Aplikasi Sisi Klien (Client Error Logging)
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  Daftar pengecualian JavaScript yang ditangkap otomatis oleh Error Boundary, window.onerror, dan unhandledrejection untuk investigasi teknis.
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <select
                  value={clientErrorFilter}
                  onChange={(e) => {
                    const val = e.target.value as "semua" | "baru" | "selesai";
                    setClientErrorFilter(val);
                    fetchClientErrors(val);
                  }}
                  style={{
                    padding: "6px 10px",
                    fontSize: "12px",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "#FFFFFF",
                    color: "var(--text-main)",
                  }}
                >
                  <option value="baru">Hanya Baru / Belum Selesai</option>
                  <option value="semua">Semua Kesalahan</option>
                  <option value="selesai">Sudah Diselesaikan</option>
                </select>

                <button
                  type="button"
                  onClick={() => fetchClientErrors(clientErrorFilter)}
                  disabled={isLoadingClientErrors}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: "var(--bg-panel)",
                    color: "var(--text-main)",
                    border: "1px solid var(--border-color)",
                    borderRadius: "var(--radius-sm)",
                    cursor: isLoadingClientErrors ? "not-allowed" : "pointer",
                  }}
                >
                  {isLoadingClientErrors ? "Memuat..." : "Segarkan"}
                </button>
              </div>
            </div>

            {/* Tabel Kesalahan Klien */}
            <div
              style={{
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
                overflowX: "auto",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", textAlign: "left" }}>
                <thead>
                  <tr style={{ backgroundColor: "#F8F8F6", borderBottom: "1px solid var(--border-color)", color: "var(--text-secondary)", height: "36px" }}>
                    <th style={{ padding: "0 14px", fontWeight: 600 }}>Pesan & Komponen</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Rute / Path</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Tipe / Build</th>
                    <th style={{ padding: "0 12px", fontWeight: 600, textAlign: "center" }}>Frekuensi</th>
                    <th style={{ padding: "0 12px", fontWeight: 600 }}>Terakhir Terjadi</th>
                    <th style={{ padding: "0 12px", fontWeight: 600, textAlign: "center" }}>Status</th>
                    {userRole === "admin" && (
                      <th style={{ padding: "0 14px", fontWeight: 600, textAlign: "right" }}>Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {clientErrorsList.length === 0 ? (
                    <tr>
                      <td colSpan={userRole === "admin" ? 7 : 6} style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
                        {isLoadingClientErrors
                          ? "Memuat data kesalahan aplikasi..."
                          : "Tidak ada catatan kesalahan aplikasi sisi klien untuk filter ini."}
                      </td>
                    </tr>
                  ) : (
                    clientErrorsList.map((item) => (
                      <tr
                        key={item.id}
                        style={{
                          height: "46px",
                          borderBottom: "1px solid var(--border-color)",
                          backgroundColor: item.status === "baru" ? "#FFFDFD" : "transparent",
                        }}
                      >
                        <td style={{ padding: "8px 14px", maxWidth: "260px" }}>
                          <div style={{ fontWeight: 600, color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {item.pesan || item.nama}
                          </div>
                          {item.komponen && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              Komponen: <span className="font-mono">{item.komponen}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-secondary)" }}>
                          {item.path || "/"}
                        </td>
                        <td style={{ padding: "8px 12px" }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "10px",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: "3px",
                              backgroundColor:
                                item.tipe === "chunk_load"
                                  ? "#EFF6FF"
                                  : item.tipe === "boundary"
                                  ? "#FEF2F2"
                                  : "#F3F4F6",
                              color:
                                item.tipe === "chunk_load"
                                  ? "#1D4ED8"
                                  : item.tipe === "boundary"
                                  ? "#DC2626"
                                  : "#4B5563",
                              border: `1px solid ${
                                item.tipe === "chunk_load"
                                  ? "#BFDBFE"
                                  : item.tipe === "boundary"
                                  ? "#FECACA"
                                  : "#E5E7EB"
                              }`,
                            }}
                          >
                            {item.tipe}
                          </span>
                          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                            bld: {item.buildId?.slice(0, 8) || "dev"}
                          </div>
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center", fontWeight: 700, color: "var(--text-main)" }}>
                          {item.jumlah}x
                        </td>
                        <td style={{ padding: "8px 12px", fontSize: "11px", color: "var(--text-secondary)" }}>
                          {formatWIBDateTime(item.terakhirTerjadi)}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: "10px",
                              fontWeight: 700,
                              padding: "2px 8px",
                              borderRadius: "10px",
                              backgroundColor: item.status === "baru" ? "#FEF2F2" : "#F0FDF4",
                              color: item.status === "baru" ? "#B91C1C" : "#15803D",
                              border: `1px solid ${item.status === "baru" ? "#FECACA" : "#BBF7D0"}`,
                            }}
                          >
                            {item.status === "baru" ? "Baru" : "Selesai"}
                          </span>
                        </td>
                        {userRole === "admin" && (
                          <td style={{ padding: "8px 14px", textAlign: "right" }}>
                            <button
                              type="button"
                              onClick={() => handleToggleErrorStatus(item.id, item.status)}
                              disabled={updatingErrorId === item.id}
                              style={{
                                padding: "4px 8px",
                                fontSize: "11px",
                                fontWeight: 600,
                                backgroundColor: item.status === "baru" ? "#F0FDF4" : "#F3F4F6",
                                color: item.status === "baru" ? "#166534" : "#4B5563",
                                border: `1px solid ${item.status === "baru" ? "#86EFAC" : "#D1D5DB"}`,
                                borderRadius: "var(--radius-sm)",
                                cursor: updatingErrorId === item.id ? "not-allowed" : "pointer",
                              }}
                            >
                              {updatingErrorId === item.id
                                ? "Menyimpan..."
                                : item.status === "baru"
                                ? "Tandai Selesai"
                                : "Buka Kembali"}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </SectionErrorBoundary>

        {/* Section 8: Kesehatan Sistem (System Health & Diagnostik) */}
        {userRole === "admin" && (
          <SectionErrorBoundary sectionName="Kesehatan Sistem">
            <div
              style={{
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                padding: "20px 24px",
                marginTop: "24px",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <h2 style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-main)", letterSpacing: "-0.2px" }}>
                      8. Kesehatan Sistem (System Health & Diagnostik)
                    </h2>
                    {diagnostikData && (
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: "4px",
                          border: "1px solid",
                          borderColor:
                            diagnostikData.status === "ok"
                              ? "#86EFAC"
                              : diagnostikData.status === "perlu_perhatian"
                              ? "#FCD34D"
                              : "#FCA5A5",
                          backgroundColor:
                            diagnostikData.status === "ok"
                              ? "#F0FDF4"
                              : diagnostikData.status === "perlu_perhatian"
                              ? "#FFFBEB"
                              : "#FEF2F2",
                          color:
                            diagnostikData.status === "ok"
                              ? "#166534"
                              : diagnostikData.status === "perlu_perhatian"
                              ? "#92400E"
                              : "#991B1B",
                        }}
                      >
                        {diagnostikData.status === "ok"
                          ? "[OK] Normal"
                          : diagnostikData.status === "perlu_perhatian"
                          ? "[Perhatian] Perlu Tindakan"
                          : "[Gagal] Gangguan Kritis"}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                    Metrik langsung PostgreSQL, Redis, BullMQ, kapasitas disk, batas sistem aktif, dan hasil probe dashboard.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={fetchDiagnostik}
                  disabled={isLoadingDiagnostik}
                  style={{
                    padding: "6px 12px",
                    fontSize: "12px",
                    fontWeight: 600,
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "#FFFFFF",
                    color: "var(--text-main)",
                    cursor: isLoadingDiagnostik ? "not-allowed" : "pointer",
                  }}
                >
                  {isLoadingDiagnostik ? "Memeriksa..." : "Segarkan Diagnostik"}
                </button>
              </div>

              {diagnostikError && (
                <div
                  style={{
                    padding: "10px 14px",
                    fontSize: "12px",
                    color: "var(--accent-red)",
                    backgroundColor: "#FEF2F2",
                    border: "1px solid #FCA5A5",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: "16px",
                  }}
                >
                  {diagnostikError}
                </div>
              )}

              {/* Peringatan Proaktif */}
              {diagnostikData?.warnings && diagnostikData.warnings.length > 0 && (
                <div
                  style={{
                    padding: "10px 14px",
                    fontSize: "12px",
                    color: "#92400E",
                    backgroundColor: "#FFFBEB",
                    border: "1px solid #FCD34D",
                    borderRadius: "var(--radius-sm)",
                    marginBottom: "16px",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: "4px" }}>
                    [Perhatian] Peringatan Batas Sistem Terdeteksi:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "2px" }}>
                    {diagnostikData.warnings.map((w: string, idx: number) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Grid 4 Kartu Utama */}
              {diagnostikData ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                      gap: "12px",
                      marginBottom: "16px",
                    }}
                  >
                    {/* Kartu PostgreSQL */}
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-main)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                          PostgreSQL
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color:
                              diagnostikData.postgres.status === "ok"
                                ? "#166534"
                                : diagnostikData.postgres.status === "perlu_perhatian"
                                ? "#92400E"
                                : "#991B1B",
                          }}
                        >
                          {diagnostikData.postgres.status === "ok"
                            ? "[OK]"
                            : diagnostikData.postgres.status === "perlu_perhatian"
                            ? "[Perhatian]"
                            : "[Gagal]"}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div>Latensi: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.postgres.latencyMs} ms</strong></div>
                        <div>Koneksi: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.postgres.activeConnections} / {diagnostikData.postgres.maxConnections} ({diagnostikData.postgres.connectionUsagePercent}%)</strong></div>
                        <div>Kunci Menunggu: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.postgres.waitingLocks} lock</strong></div>
                      </div>
                    </div>

                    {/* Kartu Redis */}
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-main)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                          Redis Cache
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color:
                              diagnostikData.redis.status === "ok"
                                ? "#166534"
                                : diagnostikData.redis.status === "perlu_perhatian"
                                ? "#92400E"
                                : "#991B1B",
                          }}
                        >
                          {diagnostikData.redis.status === "ok"
                            ? "[OK]"
                            : diagnostikData.redis.status === "perlu_perhatian"
                            ? "[Perhatian]"
                            : "[Gagal]"}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div>Latensi: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.latencyMs} ms</strong></div>
                        <div>Memori: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.usedMemoryHuman} ({diagnostikData.redis.maxMemoryPolicy})</strong></div>
                        <div>Total Kunci: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.keysCount} keys</strong></div>
                      </div>
                    </div>

                    {/* Kartu Antrian BullMQ */}
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-main)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                          Antrian Ingest (BullMQ)
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: diagnostikData.redis.bullmq.waiting > 100 ? "#92400E" : "#166534",
                          }}
                        >
                          {diagnostikData.redis.bullmq.waiting > 100 ? "[Perhatian]" : "[OK]"}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div>Menunggu (Waiting): <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.bullmq.waiting}</strong></div>
                        <div>Aktif: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.bullmq.active}</strong> | Gagal: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.bullmq.failed}</strong></div>
                        <div>Selesai: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.redis.bullmq.completed}</strong></div>
                      </div>
                    </div>

                    {/* Kartu Ruang Disk */}
                    <div
                      style={{
                        padding: "12px 14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-main)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-main)" }}>
                          Kapasitas Disk Server
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color:
                              diagnostikData.disk.percentUsed >= 80
                                ? "#92400E"
                                : "#166534",
                          }}
                        >
                          {diagnostikData.disk.percentUsed >= 80 ? "[Perhatian]" : "[OK]"}
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: "3px" }}>
                        <div>Terpakai: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.disk.percentUsed}%</strong></div>
                        <div>Tersisa: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.disk.availGb} GB</strong></div>
                        <div>Total: <strong style={{ color: "var(--text-main)" }}>{diagnostikData.disk.totalGb} GB</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Rincian Probe Dashboard & Batas Aktif */}
                  <div
                    style={{
                      padding: "14px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-main)",
                      fontSize: "12px",
                    }}
                  >
                    <div style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "8px" }}>
                      Uji Respons Bagian Dashboard & Konfigurasi Limit Aktif
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "10px" }}>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Hasil Probe Sub-Query:</div>
                        <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-main)", display: "flex", flexDirection: "column", gap: "2px" }}>
                          <li>Perangkat (devices): {diagnostikData.dashboardProbe.sections.devices?.durationMs} ms ({diagnostikData.dashboardProbe.sections.devices?.status})</li>
                          <li>Insiden (incidents): {diagnostikData.dashboardProbe.sections.incidents?.durationMs} ms ({diagnostikData.dashboardProbe.sections.incidents?.status})</li>
                          <li>Grafik 24 Jam (device_log_hourly): {diagnostikData.dashboardProbe.sections.hourlyChart?.durationMs} ms ({diagnostikData.dashboardProbe.sections.hourlyChart?.status})</li>
                          <li>Total Waktu Probe: <strong>{diagnostikData.dashboardProbe.totalDurationMs} ms</strong></li>
                        </ul>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Nilai Batas (Limits) & Kill Switch:</div>
                        <ul style={{ margin: 0, paddingLeft: "16px", color: "var(--text-main)", display: "flex", flexDirection: "column", gap: "2px" }}>
                          <li>Statement Timeout: {diagnostikData.limits.statementTimeout}</li>
                          <li>Redis Timeout: {diagnostikData.limits.redisTimeoutMs} ms</li>
                          <li>Circuit Breaker Klien: {diagnostikData.limits.clientCircuitBreakerFailures}x gagal → jeda {diagnostikData.limits.clientCircuitBreakerCooldownSeconds} detik</li>
                          <li>Kill Switch Fast Path: <strong style={{ color: diagnostikData.limits.fastPathActive ? "#166534" : "#991B1B" }}>{diagnostikData.limits.fastPathActive ? "Aktif (DASHBOARD_FAST_PATH=true)" : "Nonaktif (Fallback Jalur Lama)"}</strong></li>
                        </ul>
                      </div>
                      {diagnostikData.systemIntegrity && (
                        <div style={{ gridColumn: "1 / -1", marginTop: "8px", paddingTop: "8px", borderTop: "1px dashed var(--border-color)" }}>
                          <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Integritas Skema & Agregasi:</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", fontSize: "12px" }}>
                            <span>Migrasi Skema: <strong>{diagnostikData.systemIntegrity.migrationsApplied} migrasi aktif (Lengkap)</strong></span>
                            <span>Kesesuaian Log 24 Jam: <strong style={{ color: diagnostikData.systemIntegrity.isConsistent ? "#166534" : "#991B1B" }}>{diagnostikData.systemIntegrity.isConsistent ? "100% Cocok (Sinkron)" : "Perlu Sinkronisasi"}</strong> ({diagnostikData.systemIntegrity.rawLogs24h} mentah vs {diagnostikData.systemIntegrity.hourlyAggLogs24h} agregasi)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Ringkasan Penolakan Ingest 24 Jam */}
                  {diagnostikData.ingestRejections24h && (
                    <div
                      style={{
                        marginTop: "14px",
                        padding: "14px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-main)",
                        fontSize: "12px",
                      }}
                    >
                      <div style={{ fontWeight: 700, color: "var(--text-main)", marginBottom: "8px" }}>
                        Ringkasan Penolakan Ingest Global (24 Jam Terakhir)
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px" }}>
                        <div>Nonaktif: <strong>{diagnostikData.ingestRejections24h.nonaktif ?? 0}</strong></div>
                        <div>IP Tidak Terdaftar: <strong>{diagnostikData.ingestRejections24h.ip_tidak_terdaftar ?? 0}</strong></div>
                        <div>Token Salah: <strong>{diagnostikData.ingestRejections24h.token_salah ?? 0}</strong></div>
                        <div>Rate Limit: <strong>{diagnostikData.ingestRejections24h.rate_limit ?? 0}</strong></div>
                        <div>Ukuran Berlebih: <strong>{diagnostikData.ingestRejections24h.ukuran ?? 0}</strong></div>
                        <div>Tidak Terbaca: <strong>{diagnostikData.ingestRejections24h.tidak_terbaca ?? 0}</strong></div>
                      </div>
                    </div>
                  )}

                  {/* Panel Sumber Tidak Dikenal (Admin) */}
                  <div style={{ marginTop: "16px" }}>
                    <UnknownSourcesPanel
                      initialSources={diagnostikData.unknownSources}
                      onDeviceRegisteredOrBound={fetchDiagnostik}
                    />
                  </div>
                </>
              ) : (
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", padding: "16px 0", textAlign: "center" }}>
                  {isLoadingDiagnostik ? "Memeriksa status dan kesehatan sistem..." : "Data diagnostik belum dimuat."}
                </div>
              )}
            </div>
          </SectionErrorBoundary>
        )}

        {/* Modal Tambah Saluran Notifikasi */}
        {isChannelModalOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(31, 36, 48, 0.4)",
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
                maxWidth: "480px",
                maxHeight: "90vh",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                overflow: "hidden",
              }}
            >
              <div style={{ height: "3px", backgroundColor: "var(--accent-blue)", width: "100%", flexShrink: 0 }} />
              <div style={{ padding: "24px", overflowY: "auto" }}>
                <h2 style={{ fontSize: "16px", fontWeight: 700, color: "var(--text-main)", marginBottom: "4px" }}>
                  Tambah Saluran Notifikasi
                </h2>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "16px" }}>
                  Konfigurasi kredensial disimpan secara terenkripsi (AES-256-GCM).
                </p>

                <form onSubmit={handleCreateChannel} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                      Tipe Saluran *
                    </label>
                    <select
                      value={newChannelType}
                      onChange={(e) => setNewChannelType(e.target.value as any)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "#FFFFFF",
                      }}
                    >
                      <option value="telegram">Telegram Bot</option>
                      <option value="email">Email SMTP</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                      Nama Saluran *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="misal: Telegram Tim NOC / Email IT"
                      value={newChannelName}
                      onChange={(e) => setNewChannelName(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                      }}
                    />
                  </div>

                  {newChannelType === "telegram" ? (
                    <>
                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                          Bot Token *
                        </label>
                        <input
                          type="password"
                          required
                          placeholder="misal: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
                          value={tgBotToken}
                          onChange={(e) => setTgBotToken(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            fontSize: "13px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            fontFamily: "var(--font-mono)",
                          }}
                        />
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px", display: "block" }}>
                          Dapatkan dari @BotFather di Telegram.
                        </span>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                          Chat ID *
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="misal: -1001234567890 atau 12345678"
                          value={tgChatId}
                          onChange={(e) => setTgChatId(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px 12px",
                            fontSize: "13px",
                            border: "1px solid var(--border-color)",
                            borderRadius: "var(--radius-sm)",
                            fontFamily: "var(--font-mono)",
                          }}
                        />
                        <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px", display: "block" }}>
                          Gunakan ID grup (diawali minus) atau ID akun admin.
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            SMTP Host *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="smtp.gmail.com"
                            value={emailHost}
                            onChange={(e) => setEmailHost(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            Port *
                          </label>
                          <input
                            type="number"
                            required
                            value={emailPort}
                            onChange={(e) => setEmailPort(parseInt(e.target.value) || 587)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            Username SMTP *
                          </label>
                          <input
                            type="text"
                            required
                            placeholder="user@domain.com"
                            value={emailUser}
                            onChange={(e) => setEmailUser(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            Password SMTP *
                          </label>
                          <input
                            type="password"
                            required
                            value={emailPass}
                            onChange={(e) => setEmailPass(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            Email Pengirim (From) *
                          </label>
                          <input
                            type="email"
                            required
                            placeholder="alerts@jagalog.local"
                            value={emailFrom}
                            onChange={(e) => setEmailFrom(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                        <div>
                          <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                            Email Penerima (To) *
                          </label>
                          <input
                            type="email"
                            required
                            placeholder="noc@perusahaan.co.id"
                            value={emailTo}
                            onChange={(e) => setEmailTo(e.target.value)}
                            style={{
                              width: "100%",
                              padding: "8px 12px",
                              fontSize: "13px",
                              border: "1px solid var(--border-color)",
                              borderRadius: "var(--radius-sm)",
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  <div>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}>
                      Pilih Notifikasi Event
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px", backgroundColor: "var(--bg-main)", padding: "10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
                      {[
                        { key: "ping_rto", label: "Ping RTO" },
                        { key: "ping_recovered", label: "Ping Pulih" },
                        { key: "device_offline", label: "Log Mati (Offline)" },
                        { key: "device_recovered", label: "Log Pulih (Online)" },
                        { key: "flapping_detected", label: "Flapping / Tidak Stabil" },
                      ].map((ev) => (
                        <label key={ev.key} style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={newChannelEvents.includes(ev.key)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewChannelEvents([...newChannelEvents, ev.key]);
                              } else {
                                setNewChannelEvents(newChannelEvents.filter((k) => k !== ev.key));
                              }
                            }}
                            style={{ cursor: "pointer" }}
                          />
                          <span>{ev.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                    <button
                      type="button"
                      onClick={() => setIsChannelModalOpen(false)}
                      disabled={isSubmittingChannel}
                      style={{
                        padding: "8px 14px",
                        fontSize: "13px",
                        border: "1px solid var(--border-color)",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "transparent",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                      }}
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmittingChannel}
                      style={{
                        padding: "8px 16px",
                        fontSize: "13px",
                        fontWeight: 600,
                        border: "none",
                        borderRadius: "var(--radius-sm)",
                        backgroundColor: "var(--accent-blue)",
                        color: "#FFFFFF",
                        cursor: isSubmittingChannel ? "not-allowed" : "pointer",
                      }}
                    >
                      {isSubmittingChannel ? "Menyimpan..." : "Tambah Saluran"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
