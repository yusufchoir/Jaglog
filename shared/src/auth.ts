import { redis } from "./redis";
import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";
import { verify, hash } from "@node-rs/argon2";
import crypto from "crypto";

export const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 jam
export const MAX_LOGIN_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_SECONDS = 15 * 60; // 15 menit
export const USER_ROLE_CACHE_TTL = 60; // 60 detik

export interface SessionData {
  userId: string;
  username: string;
  role: "admin" | "viewer";
  mustChangePassword: boolean;
  createdAt: number;
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "viewer";
  isActive: boolean;
  mustChangePassword?: boolean;
}

/**
 * Format nama tampilan konsisten di semua halaman (e.g. "admin" -> "Admin")
 */
export function formatDisplayName(username: string): string {
  if (!username) return "Pengguna";
  return username
    .split(/[-_ ]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Invalidate cache peran pengguna di Redis saat role/isActive diubah
 */
export async function invalidateUserRoleCache(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await redis.del(`cache:user:role:${userId}`);
  } catch (err) {
    console.warn("[Auth] Gagal invalidasi cache peran:", err);
  }
}

/**
 * Mengambil peran dan data user resmi dari database dengan cache Redis <= 60 detik.
 * Sesi Redis tidak lagi menjadi kebenaran tunggal untuk peran.
 * Bila DB timeout/gagal: gunakan nilai terakhir yang valid dari cache/sesi (jangan turun ke viewer).
 */
export async function getUserWithFreshRole(sessionUser: SessionData): Promise<CurrentUser | null> {
  if (!sessionUser || !sessionUser.userId) return null;

  const cacheKey = `cache:user:role:${sessionUser.userId}`;

  // 1. Coba baca dari cache Redis (TTL <= 60s)
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (!parsed.isActive) return null;
      return {
        id: parsed.id,
        username: parsed.username,
        displayName: formatDisplayName(parsed.username),
        role: parsed.role as "admin" | "viewer",
        isActive: parsed.isActive,
        mustChangePassword: sessionUser.mustChangePassword,
      };
    }
  } catch {
    // Abaikan jika Redis get gagal
  }

  // 2. Baca dari sumber resmi (Database)
  try {
    const [dbUser] = await db
      .select({
        id: users.id,
        username: users.username,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, sessionUser.userId))
      .limit(1);

    if (!dbUser || !dbUser.isActive) {
      return null;
    }

    const freshUser: CurrentUser = {
      id: dbUser.id,
      username: dbUser.username,
      displayName: formatDisplayName(dbUser.username),
      role: dbUser.role as "admin" | "viewer",
      isActive: dbUser.isActive,
      mustChangePassword: sessionUser.mustChangePassword,
    };

    // Simpan ke cache Redis dengan TTL 60 detik
    try {
      await redis.set(
        cacheKey,
        JSON.stringify({
          id: dbUser.id,
          username: dbUser.username,
          role: dbUser.role,
          isActive: dbUser.isActive,
        }),
        "EX",
        USER_ROLE_CACHE_TTL
      );
    } catch {}

    return freshUser;
  } catch (dbErr) {
    console.warn("[Auth] Gagal membaca peran dari database, degradasi ke sesi:", dbErr);
    // Jalur cadangan: jika DB gagal, gunakan nilai sesi yang ada (jangan turunkan admin ke viewer!)
    return {
      id: sessionUser.userId,
      username: sessionUser.username,
      displayName: formatDisplayName(sessionUser.username),
      role: sessionUser.role,
      isActive: true,
      mustChangePassword: sessionUser.mustChangePassword,
    };
  }
}

/**
 * Buat kunci Redis untuk rate limiting percobaan login
 */
export function getRateLimitKey(ip: string, username: string): string {
  const cleanIp = ip.trim().toLowerCase();
  const cleanUser = username.trim().toLowerCase();
  return `ratelimit:login:${cleanIp}:${cleanUser}`;
}

/**
 * Cek apakah IP + username terkena rate limit login
 */
export async function checkRateLimit(
  ip: string,
  username: string
): Promise<{ allowed: boolean; remainingAttempts: number; retryAfterSeconds: number }> {
  try {
    const key = getRateLimitKey(ip, username);
    const currentAttempts = await redis.get(key);

    if (!currentAttempts) {
      return {
        allowed: true,
        remainingAttempts: MAX_LOGIN_ATTEMPTS,
        retryAfterSeconds: 0,
      };
    }

    const attempts = parseInt(currentAttempts, 10);
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      return {
        allowed: false,
        remainingAttempts: 0,
        retryAfterSeconds: ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS,
      };
    }

    return {
      allowed: true,
      remainingAttempts: MAX_LOGIN_ATTEMPTS - attempts,
      retryAfterSeconds: 0,
    };
  } catch (redisErr) {
    console.warn("Redis checkRateLimit unavailable (allowing login fallback):", redisErr);
    return {
      allowed: true,
      remainingAttempts: MAX_LOGIN_ATTEMPTS,
      retryAfterSeconds: 0,
    };
  }
}

/**
 * Tambah counter gagal login di Redis
 */
export async function recordFailedLogin(ip: string, username: string): Promise<number> {
  try {
    const key = getRateLimitKey(ip, username);
    const attempts = await redis.incr(key);

    if (attempts === 1) {
      await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    }

    return attempts;
  } catch (redisErr) {
    console.warn("Redis recordFailedLogin unavailable:", redisErr);
    return 1;
  }
}

/**
 * Reset counter percobaan login jika berhasil
 */
export async function resetLoginAttempts(ip: string, username: string): Promise<void> {
  try {
    const key = getRateLimitKey(ip, username);
    await redis.del(key);
  } catch {
    // ignore
  }
}


/**
 * Buat sesi baru di Redis
 */
export async function createSession(sessionData: SessionData): Promise<string> {
  const sessionToken = crypto.randomBytes(32).toString("hex");
  const sessionKey = `session:${sessionToken}`;

  await redis.set(
    sessionKey,
    JSON.stringify(sessionData),
    "EX",
    SESSION_TTL_SECONDS
  );

  return sessionToken;
}

/**
 * Ambil data sesi dari Redis
 */
export async function getSession(sessionToken: string): Promise<SessionData | null> {
  if (!sessionToken) return null;
  const sessionKey = `session:${sessionToken}`;
  let data: string | null = null;
  try {
    data = await redis.get(sessionKey);
  } catch (err: any) {
    console.warn("[Auth] Gagal membaca session dari Redis (jalur cadangan null):", err?.message || err);
    return null;
  }
  if (!data) return null;

  try {
    const parsed = JSON.parse(data);
    // Jika data berupa string UUID lama (format legacy session:token -> "uuid")
    if (typeof parsed === "string") {
      const [u] = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          mustChangePassword: users.mustChangePassword,
        })
        .from(users)
        .where(eq(users.id, parsed))
        .limit(1);

      if (!u) return null;
      return {
        userId: u.id,
        username: u.username,
        role: (u.role as "admin" | "viewer") || "admin",
        mustChangePassword: u.mustChangePassword,
        createdAt: Date.now(),
      };
    }

    if (typeof parsed === "object" && parsed !== null) {
      const userId = parsed.userId || parsed.id;
      if (!userId) return null;
      return {
        userId,
        username: parsed.username || "admin",
        role: (parsed.role as "admin" | "viewer") || "viewer",
        mustChangePassword: parsed.mustChangePassword ?? false,
        createdAt: Number(parsed.createdAt) || Date.now(),
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Hapus sesi dari Redis (logout)
 */
export async function destroySession(sessionToken: string): Promise<void> {
  if (!sessionToken) return;
  const sessionKey = `session:${sessionToken}`;
  await redis.del(sessionKey);
}

/**
 * Update data sesi di Redis (misalnya setelah ganti password)
 */
export async function updateSessionData(
  sessionToken: string,
  updates: Partial<SessionData>
): Promise<void> {
  const current = await getSession(sessionToken);
  if (!current) return;

  const updated = { ...current, ...updates };
  const sessionKey = `session:${sessionToken}`;
  const ttl = await redis.ttl(sessionKey);
  const remainingTTL = ttl > 0 ? ttl : SESSION_TTL_SECONDS;

  await redis.set(sessionKey, JSON.stringify(updated), "EX", remainingTTL);
}

/**
 * Verifikasi kredensial login user
 */
export async function authenticateUser(
  usernameInput: string,
  passwordInput: string
): Promise<
  | { success: true; user: { id: string; username: string; role: "admin" | "viewer"; mustChangePassword: boolean } }
  | { success: false; reason: "not_found" | "inactive" | "wrong_password" | "db_error"; message?: string }
> {
  try {
    let [foundUser] = await db
      .select()
      .from(users)
      .where(eq(users.username, usernameInput.trim()))
      .limit(1);

    // Jika user admin dicari tapi tabel users kosong, lakukan auto-seed admin darurat
    if (!foundUser) {
      try {
        const allUsers = await db.select({ id: users.id }).from(users).limit(1);
        if (allUsers.length === 0) {
          console.log("[Auth] Tabel users kosong. Menjalankan auto-seed admin awal...");
          const adminUser = process.env.ADMIN_USERNAME || "admin";
          const adminPass = process.env.ADMIN_PASSWORD || "JagaLogAdmin123!";
          const pHash = await hash(adminPass);
          const [inserted] = await db
            .insert(users)
            .values({
              username: adminUser,
              passwordHash: pHash,
              role: "admin",
              isActive: true,
              mustChangePassword: true,
            })
            .returning();

          if (usernameInput.trim() === adminUser) {
            foundUser = inserted;
          }
        }
      } catch (seedErr) {
        console.warn("[Auth] Auto-seed check notice:", seedErr);
      }
    }

    if (!foundUser) {
      return { success: false, reason: "not_found" };
    }

    if (!foundUser.isActive) {
      return { success: false, reason: "inactive" };
    }

    const isValidPassword = await verify(foundUser.passwordHash, passwordInput);
    if (!isValidPassword) {
      return { success: false, reason: "wrong_password" };
    }

    return {
      success: true,
      user: {
        id: foundUser.id,
        username: foundUser.username,
        role: foundUser.role as "admin" | "viewer",
        mustChangePassword: foundUser.mustChangePassword,
      },
    };
  } catch (err: any) {
    console.error("[Auth] Database error in authenticateUser:", err);
    const errMsg = err.code ? `${err.code}: ${err.message}` : (err.message || String(err));
    return {
      success: false,
      reason: "db_error",
      message: errMsg,
    };
  }

}

export { hash, verify };
