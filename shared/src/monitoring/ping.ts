import { execFile } from "child_process";
import net from "net";

export interface PingResult {
  isAlive: boolean;
  latencyMs: number | null;
  method: "icmp" | "tcp" | null;
}

/**
 * Validasi ketat format IP (IPv4 atau IPv6) untuk mencegah command injection
 */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  return net.isIP(trimmed) !== 0;
}

/**
 * Perform single ICMP ping using execFile (direct binary execution without shell)
 */
function execIcmpPing(
  ip: string,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs?: number }> {
  return new Promise((resolve) => {
    const trimmedIp = ip.trim();
    if (!isValidIp(trimmedIp)) {
      return resolve({ ok: false });
    }

    const isMac = process.platform === "darwin";
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    
    // Argumen dalam bentuk array tanpa memanggil shell (/bin/sh)
    const args = isMac
      ? ["-c", "1", "-t", String(timeoutSec), trimmedIp]
      : ["-c", "1", "-W", String(timeoutSec), trimmedIp];

    const start = Date.now();
    execFile("ping", args, { timeout: timeoutMs + 500 }, (error, stdout) => {
      const elapsed = Date.now() - start;
      if (error) {
        return resolve({ ok: false });
      }
      // Check if received at least 1 packet
      const isReceived =
        /1 (?:packets |)received|1 packets transmitted, 1 (?:packets |)received/i.test(
          stdout
        );
      if (!isReceived) {
        return resolve({ ok: false });
      }

      // Parse latency from ping output: e.g. time=12.4 ms or time<1ms
      const match = stdout.match(/time[=<]([0-9.]+)\s*ms/i);
      const latencyMs = match ? Math.round(parseFloat(match[1])) : elapsed;
      resolve({ ok: true, latencyMs });
    });
  });
}

/**
 * Fallback TCP check: try connecting to common open network ports
 * (80=HTTP, 443=HTTPS, 22=SSH, 8291=MikroTik WinBox, 53=DNS).
 * Even if ECONNREFUSED is returned, it means the IP is online and the OS TCP stack responded!
 */
function tcpCheck(
  ip: string,
  port: number,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs?: number }> {
  return new Promise((resolve) => {
    const trimmedIp = ip.trim();
    if (!isValidIp(trimmedIp)) {
      return resolve({ ok: false });
    }

    const socket = new net.Socket();
    let resolved = false;
    const start = Date.now();

    const done = (isOk: boolean) => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        const latencyMs = isOk ? Date.now() - start : undefined;
        resolve({ ok: isOk, latencyMs });
      }
    };

    socket.setTimeout(timeoutMs);

    socket.connect(port, ip, () => {
      done(true);
    });

    socket.on("error", (err: any) => {
      // ECONNREFUSED means host is online and rejecting port at L4, which confirms host IP is REACHABLE!
      if (err.code === "ECONNREFUSED") {
        done(true);
      } else {
        done(false);
      }
    });

    socket.on("timeout", () => {
      done(false);
    });
  });
}

/**
 * Check if an IP address is reachable via ICMP with fallback to TCP.
 * Returns detailed result including latency and connection method.
 */
export async function pingDeviceWithDetails(
  ip: string,
  timeoutMs = 2000,
  attempts = 2
): Promise<PingResult> {
  if (!ip || ip.trim() === "") {
    return { isAlive: false, latencyMs: null, method: null };
  }

  const targetIp = ip.trim();

  // Try ICMP first across attempts
  for (let i = 0; i < attempts; i++) {
    try {
      const icmpRes = await execIcmpPing(targetIp, timeoutMs);
      if (icmpRes.ok) {
        return {
          isAlive: true,
          latencyMs: icmpRes.latencyMs ?? null,
          method: "icmp",
        };
      }
    } catch {
      // ignore and retry/fallback
    }
  }

  // Fallback to TCP checks on common ports (80, 443, 22, 8291)
  const commonPorts = [80, 443, 22, 8291];
  for (let i = 0; i < attempts; i++) {
    for (const port of commonPorts) {
      try {
        const tcpRes = await tcpCheck(targetIp, port, timeoutMs);
        if (tcpRes.ok) {
          return {
            isAlive: true,
            latencyMs: tcpRes.latencyMs ?? null,
            method: "tcp",
          };
        }
      } catch {
        // continue to next port
      }
    }
  }

  return { isAlive: false, latencyMs: null, method: null };
}

/**
 * Check if an IP address is reachable via ICMP with fallback to TCP.
 * Runs up to `attempts` tries (default 2), with `timeoutMs` per attempt (default 2000ms).
 */
export async function pingDevice(
  ip: string,
  timeoutMs = 2000,
  attempts = 2
): Promise<boolean> {
  const result = await pingDeviceWithDetails(ip, timeoutMs, attempts);
  return result.isAlive;
}

/**
 * Concurrency-limited ping runner (Max 20 concurrent pings)
 */
export async function pingDevicesInBatches<T>(
  items: T[],
  getIp: (item: T) => string | null | undefined,
  concurrency = 20
): Promise<Map<T, boolean>> {
  const results = new Map<T, boolean>();
  const queue = [...items];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const ip = getIp(item);
      if (!ip) {
        results.set(item, false);
        continue;
      }

      const isAlive = await pingDevice(ip, 2000, 2);
      results.set(item, isAlive);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Concurrency-limited ping runner returning detailed PingResult (latency RTT + isAlive)
 */
export async function pingDevicesWithDetailsInBatches<T>(
  items: T[],
  getIp: (item: T) => string | null | undefined,
  concurrency = 20
): Promise<Map<T, PingResult>> {
  const results = new Map<T, PingResult>();
  const queue = [...items];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      const ip = getIp(item);
      if (!ip) {
        results.set(item, { isAlive: false, latencyMs: null, method: null });
        continue;
      }

      const res = await pingDeviceWithDetails(ip, 2000, 2);
      results.set(item, res);
    }
  });

  await Promise.all(workers);
  return results;
}
