import { getDetectionThresholds, getIpAllowlist } from "./settings";
import { recordIncident } from "./incident-recorder";
import {
  detectBruteForceLogin,
  detectPasswordSpray,
  detectSuccessAfterFailures,
  detectPortScan,
  detectNewAdminAccount,
  detectLogCleared,
  detectConfigChanged,
  detectDeviceSilent,
  detectLogBurst,
  detectLogFlood,
} from "./rules";
import { RuleMatch } from "./types";

export interface DetectionRunResult {
  matchesCount: number;
  newIncidentsCount: number;
  updatedIncidentsCount: number;
  ruleStats: Record<string, number>;
  durationMs: number;
}

/**
 * Menjalankan satu siklus Rule Engine Deteksi Serangan JagaLog
 */
export async function runDetectionEngine(): Promise<DetectionRunResult> {
  const startTime = Date.now();

  // 1. Ambil ambang batas dan daftar IP allowlist dari DB/cache
  const thresholds = await getDetectionThresholds();
  const allowlist = await getIpAllowlist();

  // 2. Eksekusi semua aturan deteksi secara paralel
  const [
    bruteForceMatches,
    passwordSprayMatches,
    successAfterFailuresMatches,
    portScanMatches,
    newAdminMatches,
    logClearedMatches,
    configChangedMatches,
    deviceSilentMatches,
    logBurstMatches,
    logFloodMatches,
  ] = await Promise.all([
    detectBruteForceLogin(thresholds, allowlist),
    detectPasswordSpray(thresholds, allowlist),
    detectSuccessAfterFailures(thresholds, allowlist),
    detectPortScan(thresholds, allowlist),
    detectNewAdminAccount(thresholds, allowlist),
    detectLogCleared(thresholds, allowlist),
    detectConfigChanged(thresholds, allowlist),
    detectDeviceSilent(thresholds, allowlist),
    detectLogBurst(thresholds, allowlist),
    detectLogFlood(thresholds, allowlist),
  ]);

  const allMatches: RuleMatch[] = [
    ...bruteForceMatches,
    ...passwordSprayMatches,
    ...successAfterFailuresMatches,
    ...portScanMatches,
    ...newAdminMatches,
    ...logClearedMatches,
    ...configChangedMatches,
    ...deviceSilentMatches,
    ...logBurstMatches,
    ...logFloodMatches,
  ];

  let newIncidentsCount = 0;
  let updatedIncidentsCount = 0;
  const ruleStats: Record<string, number> = {};

  // 3. Catat dan deduplikasi insiden
  for (const match of allMatches) {
    ruleStats[match.ruleKey] = (ruleStats[match.ruleKey] || 0) + 1;
    try {
      const { isNew } = await recordIncident(match);
      if (isNew) {
        newIncidentsCount++;
      } else {
        updatedIncidentsCount++;
      }
    } catch (err) {
      console.error(`[Detection Engine Error] Gagal mencatat insiden ${match.ruleKey}:`, err);
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    matchesCount: allMatches.length,
    newIncidentsCount,
    updatedIncidentsCount,
    ruleStats,
    durationMs,
  };
}
