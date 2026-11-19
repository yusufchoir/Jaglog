/**
 * Resilient Fetch Terpusat dengan Kebijakan Retry, Backoff, Jitter, dan Circuit Breaker
 *
 * Aturan perbaiki_lagi.md:
 * - Maksimal 2 kali retry dengan backoff & jitter
 * - Error 4xx tidak pernah di-retry
 * - 401 mengarahkan ke login
 * - Circuit breaker: 3 kegagalan beruntun -> menahan request otomatis selama 30 detik
 * - Pemanggilan manual ("Coba Lagi") langsung me-reset circuit breaker
 */

interface CircuitState {
  failureCount: number;
  openUntil: number; // timestamp ms
  lastError: string;
}

const circuitStates = new Map<string, CircuitState>();

export class CircuitBreakerError extends Error {
  public remainingSeconds: number;
  public endpointKey: string;

  constructor(endpointKey: string, remainingSeconds: number) {
    super(
      `Permintaan otomatis ke server ditahan selama ${remainingSeconds} detik karena terjadi beberapa kegagalan beruntun. Silakan tekan tombol "Coba Lagi" untuk mencoba kembali sekarang.`
    );
    this.name = "CircuitBreakerError";
    this.endpointKey = endpointKey;
    this.remainingSeconds = remainingSeconds;
  }
}

export function getEndpointKey(url: string): string {
  try {
    const parsed = new URL(url, "http://localhost");
    // Ekstrak rute utama, misalnya: /api/devices/{id}/stats -> /api/devices/stats
    return parsed.pathname.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":id"
    );
  } catch {
    return url;
  }
}

export function isCircuitBreakerOpen(endpointKey: string): { isOpen: boolean; remainingSeconds: number } {
  const state = circuitStates.get(endpointKey);
  if (!state || state.openUntil <= Date.now()) {
    return { isOpen: false, remainingSeconds: 0 };
  }
  const remainingSeconds = Math.max(1, Math.ceil((state.openUntil - Date.now()) / 1000));
  return { isOpen: true, remainingSeconds };
}

export function recordCircuitSuccess(endpointKey: string): void {
  circuitStates.delete(endpointKey);
}

export function resetCircuitBreaker(endpointKey: string): void {
  circuitStates.delete(endpointKey);
}

export function recordCircuitFailure(endpointKey: string, errorMessage: string): void {
  const current = circuitStates.get(endpointKey) || { failureCount: 0, openUntil: 0, lastError: "" };
  current.failureCount += 1;
  current.lastError = errorMessage;
  if (current.failureCount >= 3) {
    current.openUntil = Date.now() + 30000; // Tahan 30 detik
  }
  circuitStates.set(endpointKey, current);
}

export interface ResilientFetchOptions extends RequestInit {
  maxRetries?: number; // default: 2
  forceManual?: boolean; // bypass and reset circuit breaker if manual click
}

export async function resilientFetch(
  url: string,
  options: ResilientFetchOptions = {}
): Promise<Response> {
  const endpointKey = getEndpointKey(url);
  const { maxRetries = 2, forceManual = false, ...fetchInit } = options;

  // Jika pemicu manual ("Coba Lagi"), reset circuit breaker seketika
  if (forceManual) {
    resetCircuitBreaker(endpointKey);
  } else {
    const { isOpen, remainingSeconds } = isCircuitBreakerOpen(endpointKey);
    if (isOpen) {
      throw new CircuitBreakerError(endpointKey, remainingSeconds);
    }
  }

  let attempt = 0;
  let lastResponse: Response | null = null;
  let lastError: any = null;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(url, fetchInit);

      // Status 2xx atau 3xx: Sukses
      if (response.ok) {
        recordCircuitSuccess(endpointKey);
        return response;
      }

      // Status 4xx (Client Error): JANGAN di-retry
      if (response.status >= 400 && response.status < 500) {
        if (response.status === 401 && typeof window !== "undefined") {
          // Sesi kadaluarsa
          console.warn(`[resilientFetch] Sesi 401 pada ${url}`);
        }
        // 4xx bukan indikasi circuit breaker terbuka (kecuali 429)
        if (response.status === 429) {
          recordCircuitFailure(endpointKey, "Terlalu banyak permintaan (429)");
        }
        return response;
      }

      // Status 5xx (Server Error): Dapat di-retry
      lastResponse = response;
      recordCircuitFailure(endpointKey, `Server mengembalikan status ${response.status}`);
    } catch (err: any) {
      lastError = err;
      recordCircuitFailure(endpointKey, err?.message || "Koneksi ke server terputus");
    }

    attempt++;
    if (attempt <= maxRetries) {
      // Exponential backoff dengan jitter: 150ms * 2^attempt + jitter (0-80ms)
      const baseDelay = 150 * Math.pow(2, attempt - 1);
      const jitter = Math.random() * 80;
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError || new Error("Gagal menghubungi server setelah beberapa percobaan.");
}

