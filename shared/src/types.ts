import { InferSelectModel, InferInsertModel } from "drizzle-orm";
import { users, devices, logEvents, incidents, aiAnalyses, settings } from "./schema";

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

export type Device = InferSelectModel<typeof devices>;
export type NewDevice = InferInsertModel<typeof devices>;

export type LogEvent = InferSelectModel<typeof logEvents>;
export type NewLogEvent = InferInsertModel<typeof logEvents>;

export type Incident = InferSelectModel<typeof incidents>;
export type NewIncident = InferInsertModel<typeof incidents>;

export type AIAnalysis = InferSelectModel<typeof aiAnalyses>;
export type NewAIAnalysis = InferInsertModel<typeof aiAnalyses>;

export type Setting = InferSelectModel<typeof settings>;
export type NewSetting = InferInsertModel<typeof settings>;

export type DeviceType =
  | "mikrotik"
  | "windows"
  | "linux"
  | "switch"
  | "firewall"
  | "other";

export type LogCategory =
  | "auth"
  | "network"
  | "system"
  | "firewall"
  | "config"
  | "other";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "ack" | "closed";
export type AIRiskLevel = "low" | "medium" | "high" | "critical";

export interface ParsedLogData {
  actor?: string;
  src_ip?: string;
  dst_ip?: string;
  action?: string;
  outcome?: "success" | "failure" | "unknown" | string;
  app?: string;
  [key: string]: unknown;
}

export interface RecommendationItem {
  priority: number; // 1-5
  action: string;
  reason: string;
  device_specific_command?: string;
}

export interface FindingItem {
  title: string;
  explanation: string;
  evidence_event_ids?: number[];
}
