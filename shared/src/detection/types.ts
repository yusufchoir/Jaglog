export type RuleKey =
  | "brute_force_login"
  | "password_spray"
  | "success_after_failures"
  | "port_scan"
  | "new_admin_account"
  | "log_cleared"
  | "config_changed"
  | "device_silent"
  | "log_burst"
  | "log_flood";

import { IncidentSeverity, IncidentStatus } from "../types";

export type { IncidentSeverity, IncidentStatus };

export interface DetectionThresholds {
  brute_force_login: { max_failures: number; window_minutes: number };
  password_spray: { max_users: number; window_minutes: number };
  success_after_failures: { min_failures: number; window_minutes: number };
  port_scan: { min_ports: number; window_minutes: number };
  device_silent_minutes: number;
  log_burst_multiplier: number;
}

export interface IncidentEvidenceItem {
  eventId: string;
  timestamp: string;
  message: string;
  src_ip?: string | null;
  dst_ip?: string | null;
  actor?: string | null;
  action?: string | null;
  outcome?: string | null;
  details?: Record<string, unknown>;
}

export interface RuleMatch {
  ruleKey: RuleKey;
  deviceId: string;
  severity: IncidentSeverity;
  title: string;
  mainEntity: string;
  firstSeen: Date;
  lastSeen: Date;
  count: number;
  evidence: IncidentEvidenceItem[];
}
