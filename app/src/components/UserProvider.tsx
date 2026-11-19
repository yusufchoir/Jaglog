"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
  isActive?: boolean;
}

export type RoleStatus = "verified" | "checking" | "error";

interface UserContextType {
  currentUser: CurrentUser | null;
  roleStatus: RoleStatus;
  isAdmin: boolean;
  isMonitorMode: boolean;
  setIsMonitorMode: (mode: boolean) => void;
  refreshUser: () => Promise<void>;
  errorMessage: string | null;
}

const UserContext = createContext<UserContextType | null>(null);

const BACKOFF_DELAYS = [1000, 2000, 4000];

export function UserProvider({
  children,
  initialUser,
}: {
  children: React.ReactNode;
  initialUser: CurrentUser | null;
}) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(initialUser);
  const [roleStatus, setRoleStatus] = useState<RoleStatus>(initialUser ? "verified" : "checking");
  const [isMonitorMode, setIsMonitorMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastValidUserRef = useRef<CurrentUser | null>(initialUser);

  if (initialUser && !lastValidUserRef.current) {
    lastValidUserRef.current = initialUser;
  }

  const fetchUser = useCallback(async (isRetry = false) => {
    // Lewati fetch jika di halaman login / offline
    if (typeof window !== "undefined") {
      const p = window.location.pathname;
      if (p === "/login" || p === "/offline") return;
    }

    if (!isRetry) {
      if (!lastValidUserRef.current) {
        setRoleStatus("checking");
      }
      setErrorMessage(null);
    }

    try {
      const res = await fetch("/api/auth/me");
      if (res.status === 401) {
        setCurrentUser(null);
        lastValidUserRef.current = null;
        setRoleStatus("error");
        router.push("/login");
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data.user) {
        const u: CurrentUser = {
          id: data.user.id,
          username: data.user.username,
          displayName: data.user.displayName || data.user.username.charAt(0).toUpperCase() + data.user.username.slice(1),
          role: data.user.role,
        };
        setCurrentUser(u);
        lastValidUserRef.current = u;
        setRoleStatus("verified");
        setErrorMessage(null);
        retryCountRef.current = 0;
        return;
      }
      throw new Error("Format respon pengguna tidak sesuai.");
    } catch (err: any) {
      console.warn("[UserProvider] Gagal memeriksa sesi pengguna:", err);

      // Bila pencarian peran gagal/timeout: gunakan nilai terakhir yang valid dari cache
      if (lastValidUserRef.current) {
        setCurrentUser(lastValidUserRef.current);
        setRoleStatus("verified"); // Pertahankan peran terakhir yang valid
        return;
      }

      // Bila benar-benar tidak ada nilai, tampilkan status netral "Memeriksa peran..." dengan menu minimal
      if (retryCountRef.current < 3) {
        const delay = BACKOFF_DELAYS[retryCountRef.current] || 2000;
        retryCountRef.current += 1;
        setRoleStatus("checking");
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        retryTimerRef.current = setTimeout(() => {
          fetchUser(true);
        }, delay);
      } else {
        // Setelah 3 kali gagal: pesan "Tidak dapat memeriksa hak akses. Muat ulang." dengan tombol
        setRoleStatus("error");
        setErrorMessage("Tidak dapat memeriksa hak akses. Silakan muat ulang halaman.");
      }
    }
  }, [router]);

  useEffect(() => {
    // Sinkronkan jika initialUser berubah
    if (initialUser) {
      setCurrentUser(initialUser);
      lastValidUserRef.current = initialUser;
      setRoleStatus("verified");
    } else {
      fetchUser();
    }

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [initialUser, fetchUser]);

  const isAdmin = currentUser?.role === "admin";

  return (
    <UserContext.Provider
      value={{
        currentUser,
        roleStatus,
        isAdmin,
        isMonitorMode,
        setIsMonitorMode,
        refreshUser: () => fetchUser(false),
        errorMessage,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useCurrentUser harus digunakan di dalam UserProvider.");
  }
  return context;
}

