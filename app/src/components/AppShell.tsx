"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { HeaderNav } from "@/components/HeaderNav";
import { useCurrentUser } from "@/components/UserProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isMonitorMode } = useCurrentUser();

  const isPublicPage =
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname === "/ganti-password";

  if (isPublicPage) {
    return <>{children}</>;
  }

  return (
    <>
      {!isMonitorMode && <HeaderNav />}
      {children}
    </>
  );
}
