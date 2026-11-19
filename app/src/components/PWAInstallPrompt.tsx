"use client";

import { useEffect, useState, useRef, useCallback } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function usePWAInstall() {
  const promptEventRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. Cek apakah sudah dalam mode standalone
    const standaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    setIsStandalone(standaloneMode);

    // 2. Deteksi perangkat iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isAppleDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isAppleDevice);

    // 3. Cek localStorage apakah pernah ditolak dalam 30 hari
    let isDismissed = false;
    const dismissedTimestamp = localStorage.getItem("jagalog_pwa_dismissed");
    if (dismissedTimestamp) {
      const pastTime = parseInt(dismissedTimestamp, 10);
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      if (Date.now() - pastTime < thirtyDays) {
        isDismissed = true;
      }
    }

    // 4. Dengarkan event beforeinstallprompt (Chrome / Android / Edge)
    const handlePrompt = (e: Event) => {
      // Cek apakah ada UI pemasangan sendiri yang aktif (tombol pasang hanya ada di menu mobile < 769px)
      const hasCustomUI = window.matchMedia("(max-width: 768px)").matches;

      // Bila sudah terpasang, ditolak dalam 30 hari, atau tidak ada UI sendiri: JANGAN panggil preventDefault()
      if (standaloneMode || isDismissed || !hasCustomUI) {
        return;
      }

      // Tahan event dan simpan di ref untuk dipanggil oleh tombol UI "Pasang aplikasi"
      e.preventDefault();
      promptEventRef.current = e as BeforeInstallPromptEvent;
      setCanInstall(true);
    };

    window.addEventListener("beforeinstallprompt", handlePrompt);

    // Dengarkan saat aplikasi sukses terpasang
    const handleInstalled = () => {
      setIsStandalone(true);
      setCanInstall(false);
      promptEventRef.current = null;
    };
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handlePrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    const promptEvent = promptEventRef.current;
    if (!promptEvent) return;

    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") {
        setIsStandalone(true);
        setCanInstall(false);
      } else {
        // Pengguna memilih batal/dismiss: ingat 30 hari
        localStorage.setItem("jagalog_pwa_dismissed", Date.now().toString());
        setCanInstall(false);
      }
    } catch (err) {
      console.warn("[PWA] Gagal memicu install prompt:", err);
    } finally {
      // Bersihkan event ref setelah dieksekusi
      promptEventRef.current = null;
    }
  }, []);

  const dismissPrompt = useCallback(() => {
    setCanInstall(false);
    promptEventRef.current = null;
    localStorage.setItem("jagalog_pwa_dismissed", Date.now().toString());
  }, []);

  return {
    isStandalone,
    canInstall: !isStandalone && canInstall,
    isIOS: !isStandalone && isIOS,
    promptInstall,
    dismissPrompt,
  };
}
