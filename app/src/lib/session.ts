import { cookies } from "next/headers";
import { getSession, SessionData, CurrentUser, getUserWithFreshRole, formatDisplayName } from "@shared/auth";

export const SESSION_COOKIE_NAME = "jagalog_session";

export type { CurrentUser };
export { formatDisplayName };

/**
 * Mengambil sesi pengguna saat ini di server component atau API route
 */
export async function getCurrentSession(): Promise<{ token: string; user: SessionData } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  const sessionData = await getSession(token);
  if (!sessionData) return null;

  return { token, user: sessionData };
}

/**
 * SATU fungsi server getCurrentUser() (id, username, displayName, role)
 * Digunakan oleh SEMUA halaman, layout, navigasi, dan otorisasi API.
 * Peran dibaca dari sumber resmi (database) dengan cache Redis <= 60s.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getCurrentSession();
  if (!session) return null;

  return getUserWithFreshRole(session.user);
}

/**
 * Helper otorisasi admin (Fail-Closed, mengecek peran segar dari DB/Cache)
 */
export async function requireAdmin(): Promise<{ token: string; user: CurrentUser }> {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  const freshUser = await getUserWithFreshRole(session.user);
  if (!freshUser || !freshUser.isActive) {
    throw new Error("UNAUTHORIZED");
  }

  if (freshUser.role !== "admin") {
    throw new Error("FORBIDDEN");
  }

  return { token: session.token, user: freshUser };
}
