"use client";

/**
 * Modul Terpusat Pelaporan Kesalahan Klien & Pemulihan Chunk
 * Mencegah layar putih dan mengirim laporan terdeduplikasi ke /api/client-error.
 */

// Cache sidik jari error di memori klien selama 60 detik untuk deduplikasi
const reportedFingerprints = new Map<string, number>();
const DEDUPE_INTERVAL_MS = 60 * 1000;

// Rate limiting di sisi klien: Maks 20 laporan per menit
let clientReportsInWindow = 0;
let clientWindowStartTime = Date.now();
const MAX_CLIENT_REPORTS_PER_MINUTE = 20;

function sanitizeClientData(str: string): string {
  if (!str) return "";
  return str
    .replace(/(bearer\s+[a-zA-Z0-9_\-\.]+)/gi, "bearer [TERLINDUNGI]")
    .replace(/(password|token|secret|cookie|auth)=([^&\s]+)/gi, "$1=[TERLINDUNGI]")
    .replace(/("password"|"token"|"secret"|"cookie")\s*:\s*"[^"]+"/gi, '$1:"[TERLINDUNGI]"');
}

function computeClientFingerprint(name: string, message: string, path: string): string {
  const raw = `${name}:${message}:${path}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

export interface ClientErrorContext {
  komponen?: string;
  errorId?: string;
  path?: string;
}

/**
 * Kirim laporan kesalahan ke /api/client-error secara aman dan terdeduplikasi
 */
export async function reportClientError(
  error: unknown,
  context?: ClientErrorContext
): Promise<string> {
  if (typeof window === "undefined") return "";

  try {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    const name = errorObj.name || "Error";
    const message = errorObj.message || "Unknown error";
    const stack = errorObj.stack || "";
    const path = context?.path || window.location.pathname;

    const fingerprint = computeClientFingerprint(name, message, path);
    const now = Date.now();
    const lastSent = reportedFingerprints.get(fingerprint);

    if (lastSent && now - lastSent < DEDUPE_INTERVAL_MS) {
      // Abaikan deduplikasi dalam 60 detik di klien
      return fingerprint;
    }

    // Cek batas laju klien (maks 20 laporan per menit)
    if (now - clientWindowStartTime > 60000) {
      clientWindowStartTime = now;
      clientReportsInWindow = 0;
    }
    if (clientReportsInWindow >= MAX_CLIENT_REPORTS_PER_MINUTE) {
      return fingerprint;
    }
    clientReportsInWindow++;

    reportedFingerprints.set(fingerprint, now);

    // Bersihkan cache yang kadaluarsa
    for (const [k, ts] of reportedFingerprints.entries()) {
      if (now - ts > DEDUPE_INTERVAL_MS) {
        reportedFingerprints.delete(k);
      }
    }

    const payload = {
      nama: sanitizeClientData(name).slice(0, 100),
      pesan: sanitizeClientData(message).slice(0, 2000),
      stack: sanitizeClientData(stack).slice(0, 4096),
      path: path.split("?")[0].slice(0, 255),
      build: "1.0.0",
      komponen: context?.komponen ? sanitizeClientData(context.komponen).slice(0, 100) : null,
      errorId: context?.errorId || null,
      waktu: new Date().toISOString(),
    };

    // Gunakan keepalive agar request tetap terkirim saat tab ditutup/reload
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      // Gagal lapor tidak boleh melempar error baru
    });

    return fingerprint;
  } catch {
    return "";
  }
}

/**
 * Deteksi dan pulihkan ChunkLoadError (aset lama pasca-redeploy)
 * Memuat ulang halaman SATU KALI dengan penjaga sessionStorage agar tidak loop.
 */
export function handleChunkLoadRecovery(error: unknown): boolean {
  if (typeof window === "undefined") return false;

  const errorStr = String(error && typeof error === "object" && "message" in error ? (error as any).message : error);
  const isChunkError =
    errorStr.includes("ChunkLoadError") ||
    errorStr.includes("Loading chunk") ||
    errorStr.includes("Loading CSS chunk") ||
    errorStr.includes("Failed to fetch dynamically imported module");

  if (!isChunkError) return false;

  const RECOVERY_KEY = "jagalog_chunk_recovery_ts";
  const lastRecovery = sessionStorage.getItem(RECOVERY_KEY);
  const now = Date.now();

  // Jika belum pernah reload atau reload terakhir lebih dari 30 detik lalu:
  if (!lastRecovery || now - parseInt(lastRecovery, 10) > 30000) {
    sessionStorage.setItem(RECOVERY_KEY, now.toString());
    console.warn("[JagaLog] Terdeteksi versi baru aset aplikasi. Memuat ulang halaman...");

    // Tampilkan notifikasi visual sejenak sebelum reload
    const banner = document.createElement("div");
    banner.style.position = "fixed";
    banner.style.top = "16px";
    banner.style.left = "50%";
    banner.style.transform = "translateX(-50%)";
    banner.style.backgroundColor = "#1F2430";
    banner.style.color = "#FFFFFF";
    banner.style.padding = "10px 20px";
    banner.style.borderRadius = "6px";
    banner.style.fontSize = "13px";
    banner.style.fontWeight = "600";
    banner.style.zIndex = "99999";
    banner.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
    banner.textContent = "Versi baru aplikasi tersedia. Memuat ulang...";
    document.body.appendChild(banner);

    setTimeout(() => {
      window.location.reload();
    }, 400);

    return true;
  }

  // Jika sudah pernah reload dalam 30 detik tetapi masih gagal, jangan loop!
  return false;
}

let isGlobalHandlerInitialized = false;

/**
 * Inisialisasi pendengar event error global pada level window
 */
export function initGlobalErrorHandlers() {
  if (typeof window === "undefined" || isGlobalHandlerInitialized) return;
  isGlobalHandlerInitialized = true;

  window.addEventListener("error", (event) => {
    // 1. Cek pemulihan ChunkLoadError
    if (handleChunkLoadRecovery(event.error || event.message)) {
      event.preventDefault();
      return;
    }

    // 2. Laporkan ke server
    reportClientError(event.error || new Error(event.message), {
      path: window.location.pathname,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    // 1. Cek pemulihan ChunkLoadError pada promise import dinamis
    if (handleChunkLoadRecovery(event.reason)) {
      event.preventDefault();
      return;
    }

    // 2. Laporkan ke server
    reportClientError(event.reason || new Error("Unhandled Promise Rejection"), {
      path: window.location.pathname,
    });
  });
}

