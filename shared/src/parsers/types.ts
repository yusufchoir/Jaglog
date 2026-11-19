import { LogCategory } from "../types";

export type { LogCategory };

export type LogOutcome = "success" | "failure" | "unknown";

export interface ParsedFields {
  actor?: string | null;
  src_ip?: string | null;
  dst_ip?: string | null;
  action?: string | null;
  outcome?: LogOutcome;
  app?: string | null;
  interface?: string | null;
  logonType?: string | number | null;
  eventId?: number | string | null;
  method?: string | null;
  command?: string | null;
  reason?: string | null;
  topics?: string[] | null;
  [key: string]: unknown;
}

export interface ParseResult {
  severity: number; // 0-7 Syslog Severity
  category: LogCategory;
  sourceApp?: string;
  parsed: ParsedFields;
}
