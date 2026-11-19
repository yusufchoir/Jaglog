"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { initGlobalErrorHandlers } from "@/lib/client-logger";

export type LiveConnectionStatus = "connected" | "connecting" | "disconnected" | "fallback_polling";

export interface ChangeEventPayload {
  id: string;
  tipe: string;
  perangkat_id: string | null;
  versi: number;
  waktu: string;
  clientId?: string;
  data_ringkas?: Record<string, any>;
}

type EventCallback = (event: ChangeEventPayload) => void;

interface LiveUpdateContextType {
  status: LiveConnectionStatus;
  isReconnectingVisible: boolean; // True only if disconnected > 10s
  subscribe: (tipe: string, callback: EventCallback) => () => void;
  lastEventId: string | null;
}

const LiveUpdateContext = createContext<LiveUpdateContextType | null>(null);

const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];

export function LiveUpdateProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<LiveConnectionStatus>("connecting");
  const statusRef = useRef<LiveConnectionStatus>("connecting");
  const [isReconnectingVisible, setIsReconnectingVisible] = useState(false);

  const updateStatus = useCallback((s: LiveConnectionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const disconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const retrySseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const lastEventIdRef = useRef<string | null>(null);
  const listenersRef = useRef<Map<string, Set<EventCallback>>>(new Map());

  // Subscribe helper untuk komponen anak
  const subscribe = useCallback((tipe: string, callback: EventCallback) => {
    if (!listenersRef.current.has(tipe)) {
      listenersRef.current.set(tipe, new Set());
    }
    const set = listenersRef.current.get(tipe)!;
    set.add(callback);

    return () => {
      set.delete(callback);
      if (set.size === 0) {
        listenersRef.current.delete(tipe);
      }
    };
  }, []);

  // Broadcast event ke semua listener lokal
  const dispatchEvent = useCallback((event: ChangeEventPayload) => {
    if (event.id) {
      lastEventIdRef.current = event.id;
    }

    // 1. Dispatch ke listener spesifik tipe (misal: "perangkat.status")
    const specificListeners = listenersRef.current.get(event.tipe);
    if (specificListeners) {
      specificListeners.forEach((cb) => {
        try {
          cb(event);
        } catch (err) {
          console.error(`[LiveUpdateProvider] Error listener ${event.tipe}:`, err);
        }
      });
    }

    // 2. Dispatch ke wildcard listener "*"
    const wildcardListeners = listenersRef.current.get("*");
    if (wildcardListeners) {
      wildcardListeners.forEach((cb) => {
        try {
          cb(event);
        } catch (err) {
          console.error("[LiveUpdateProvider] Error wildcard listener:", err);
        }
      });
    }
  }, []);

  // Mulai fallback polling (15s) jika SSE gagal 3x berturut-turut
  const startFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) return;
    updateStatus("fallback_polling");

    fallbackIntervalRef.current = setInterval(async () => {
      if (typeof document !== "undefined" && document.hidden) return;

      // Beritahu listener untuk memuat ulang tampilan aktif via event virtual resync
      dispatchEvent({
        id: `fallback_${Date.now()}`,
        tipe: "resync",
        perangkat_id: null,
        versi: Date.now(),
        waktu: new Date().toISOString(),
      });
    }, 15000);

    // Coba kembali ke SSE setiap 2 menit
    if (!retrySseIntervalRef.current) {
      retrySseIntervalRef.current = setInterval(() => {
        stopFallbackPolling();
        reconnectAttemptsRef.current = 0;
        connectSSE();
      }, 120000);
    }
  }, [dispatchEvent, updateStatus]);

  const stopFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current);
      fallbackIntervalRef.current = null;
    }
    if (retrySseIntervalRef.current) {
      clearInterval(retrySseIntervalRef.current);
      retrySseIntervalRef.current = null;
    }
  }, []);

  // Koneksi utama EventSource SSE
  const connectSSE = useCallback(() => {
    // Jangan sambung jika sedang berada di halaman publik/login atau polling fallback
    if (typeof window !== "undefined" && (window.location.pathname === "/login" || window.location.pathname === "/offline")) {
      return;
    }
    if (fallbackIntervalRef.current) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    updateStatus("connecting");

    // Bangun URL dengan parameter Last-Event-ID jika ada
    const url = new URL("/api/stream", window.location.origin);
    if (lastEventIdRef.current) {
      url.searchParams.set("lastEventId", lastEventIdRef.current);
    }

    const es = new EventSource(url.toString(), { withCredentials: true });
    eventSourceRef.current = es;

    // Timer indikator 'Menyambung ulang...': hanya tampil jika terputus > 10 detik
    if (!disconnectTimerRef.current) {
      disconnectTimerRef.current = setTimeout(() => {
        setIsReconnectingVisible(true);
      }, 10000);
    }

    es.onopen = () => {
      updateStatus("connected");
      reconnectAttemptsRef.current = 0;
      setIsReconnectingVisible(false);
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      stopFallbackPolling();
    };

    // Helper untuk mendaftarkan event listener SSE
    const registerSSEEvent = (eventType: string) => {
      es.addEventListener(eventType, (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data) as ChangeEventPayload;
          dispatchEvent(payload);
        } catch {
          // Payload mungkin string kosong untuk resync
          if (eventType === "resync") {
            dispatchEvent({
              id: e.lastEventId || `resync_${Date.now()}`,
              tipe: "resync",
              perangkat_id: null,
              versi: Date.now(),
              waktu: new Date().toISOString(),
            });
          }
        }
      });
    };

    // Daftarkan semua tipe event yang didukung (termasuk mutasi grup & tata letak peta)
    [
      "log.baru",
      "perangkat.status",
      "perangkat.ping",
      "perangkat.diubah",
      "grup.berubah",
      "peta.berubah",
      "insiden.berubah",
      "analisa.selesai",
      "statistik.diperbarui",
      "pengiriman_log.berubah",
      "resync",
    ].forEach(registerSSEEvent);

    es.onerror = (e) => {
      es.close();
      eventSourceRef.current = null;
      updateStatus("disconnected");

      reconnectAttemptsRef.current += 1;

      // Jika gagal 3x berturut-turut, beralih ke fallback polling
      if (reconnectAttemptsRef.current >= 3) {
        console.warn("[LiveUpdateProvider] SSE gagal 3x berturut-turut. Beralih ke fallback polling.");
        startFallbackPolling();
        return;
      }

      // Hitung backoff eksponensial dengan jitter
      const stepIndex = Math.min(reconnectAttemptsRef.current - 1, BACKOFF_STEPS.length - 1);
      const baseDelay = BACKOFF_STEPS[stepIndex] || 1000;
      const jitter = Math.random() * 500;
      const delay = baseDelay + jitter;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        connectSSE();
      }, delay);
    };
  }, [dispatchEvent, startFallbackPolling, stopFallbackPolling, updateStatus]);

  // Kelola siklus hidup koneksi & visibilitychange
  useEffect(() => {
    initGlobalErrorHandlers();

    // Tunda koneksi awal SSE sedikit (150 ms) agar request data utama halaman
    // mendapatkan prioritas slot koneksi HTTP/1.1 tanpa terhambat socket streaming.
    const initialTimer = setTimeout(() => {
      connectSSE();
    }, 150);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab disembunyikan: jadwalkan penutupan koneksi setelah 60 detik
        hideTimerRef.current = setTimeout(() => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
            updateStatus("disconnected");
          }
        }, 60000);
      } else {
        // Tab terlihat kembali: batalkan timer penutupan jika masih berjalan
        if (hideTimerRef.current) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }

        // Jika koneksi sempat ditutup, sambung ulang
        if (!eventSourceRef.current && statusRef.current !== "fallback_polling") {
          connectSSE();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(initialTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
      stopFallbackPolling();
    };
  }, [connectSSE, stopFallbackPolling, updateStatus]);

  return (
    <LiveUpdateContext.Provider
      value={{
        status,
        isReconnectingVisible,
        subscribe,
        lastEventId: lastEventIdRef.current,
      }}
    >
      {children}
    </LiveUpdateContext.Provider>
  );
}

export function useLiveUpdates() {
  const context = useContext(LiveUpdateContext);
  if (!context) {
    throw new Error("useLiveUpdates harus digunakan di dalam LiveUpdateProvider");
  }
  return context;
}

/**
 * Hook praktis untuk mendengarkan event perubahan data tertentu.
 */
export function useLiveEvent(tipe: string, callback: EventCallback) {
  const { subscribe } = useLiveUpdates();

  useEffect(() => {
    const unsubscribe = subscribe(tipe, callback);
    return () => {
      unsubscribe();
    };
  }, [tipe, callback, subscribe]);
}
