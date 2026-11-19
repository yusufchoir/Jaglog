"use client";

import { useEffect, useState } from "react";

export function SWRegistration() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    // Hanya aktifkan di production atau bila testing PWA
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // 1. Cek jika sudah ada worker yang menunggu aktivasi
          if (registration.waiting) {
            setWaitingWorker(registration.waiting);
            setUpdateAvailable(true);
          }

          // 2. Deteksi update baru yang masuk
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;

            installing.addEventListener("statechange", () => {
              if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                // Versi baru selesai diunduh & menunggu konfirmasi pengguna
                setWaitingWorker(installing);
                setUpdateAvailable(true);
              }
            });
          });
        })
        .catch((err) => {
          console.warn("[PWA] Service Worker gagal didaftarkan:", err);
        });

      // Reload saat service worker baru aktif (dijaga maksimal 1x per 60 detik agar tidak berkedip/loop)
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          try {
            const SW_RELOAD_KEY = "jagalog_sw_reload_ts";
            const lastSwReload = sessionStorage.getItem(SW_RELOAD_KEY);
            const now = Date.now();
            if (!lastSwReload || now - parseInt(lastSwReload, 10) > 60000) {
              sessionStorage.setItem(SW_RELOAD_KEY, now.toString());
              window.location.reload();
            }
          } catch {
            // fallback
          }
        }
      });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad);
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  const handleUpdate = () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    }
  };

  if (!updateAvailable) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "calc(20px + env(safe-area-inset-bottom, 0px))",
        right: "20px",
        zIndex: 9999,
        backgroundColor: "var(--bg-panel, #FFFFFF)",
        border: "1px solid var(--border-color, #E6E4DF)",
        borderLeft: "3px solid var(--accent-blue, #1F5FBF)",
        borderRadius: "4px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.12)",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        fontSize: "13px",
        color: "var(--text-main, #1F2430)",
        maxWidth: "90vw",
      }}
    >
      <span>Versi baru JagaLog tersedia.</span>
      <button
        onClick={handleUpdate}
        style={{
          padding: "6px 12px",
          fontSize: "12px",
          fontWeight: 600,
          backgroundColor: "var(--accent-blue, #1F5FBF)",
          color: "#FFFFFF",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
        }}
      >
        Muat Ulang
      </button>
    </div>
  );
}
