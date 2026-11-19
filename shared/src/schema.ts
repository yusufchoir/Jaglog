import {
  pgTable,
  text,
  varchar,
  boolean,
  timestamp,
  uuid,
  bigserial,
  bigint,
  smallint,
  integer,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// 1. Users Table
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: varchar("role", { length: 20 }).notNull().default("viewer"), // 'admin' | 'viewer'
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 1b. Device Groups Table — Master Grup / Area Perangkat
export const deviceGroups = pgTable(
  "device_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    nama: varchar("nama", { length: 100 }).notNull(),
    deskripsi: text("deskripsi"),
    warnaGaris: varchar("warna_garis", { length: 20 }).notNull().default("biru"), // 'biru'|'merah'|'abu'
    urutan: integer("urutan").notNull().default(0),
    parentId: uuid("parent_id").references((): any => deviceGroups.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("idx_device_groups_lower_nama").on(sql`lower(${table.nama})`),
    index("idx_device_groups_parent_id").on(table.parentId),
  ]
);

// 2. Devices Table
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    type: varchar("type", { length: 50 }).notNull().default("other"), // 'mikrotik'|'windows'|'linux'|'switch'|'firewall'|'other'
    ipAddress: varchar("ip_address", { length: 45 }).unique(), // IPv4 or IPv6, nullable for token-based agent
    location: varchar("location", { length: 150 }),
    groupId: uuid("group_id").references(() => deviceGroups.id, { onDelete: "set null" }),
    notes: text("notes"),
    ingestTokenHash: varchar("ingest_token_hash", { length: 128 }),
    isActive: boolean("is_active").notNull().default(true),
    offlineAfterMinutes: integer("offline_after_minutes").notNull().default(10),
    pingEnabled: boolean("ping_enabled").notNull().default(false),
    pingFailureThreshold: integer("ping_failure_threshold").notNull().default(3),
    notifyOnRto: boolean("notify_on_rto").notNull().default(true),
    lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
    lastPingOk: boolean("last_ping_ok"),
    lastPingRtt: integer("last_ping_rtt"),
    timezone: varchar("timezone", { length: 50 }).notNull().default("Asia/Jakarta"),
    status: varchar("status", { length: 20 }).notNull().default("unknown"), // 'online'|'log_stopped'|'offline'|'rto'|'unknown'
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_devices_group_id").on(table.groupId),
  ]
);

// 3. Log Events Table
export const logEvents = pgTable(
  "log_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    severity: smallint("severity").notNull().default(6), // 0=Emergency to 7=Debug (RFC 5424)
    facility: smallint("facility").default(1),
    sourceApp: varchar("source_app", { length: 100 }),
    category: varchar("category", { length: 50 }).notNull().default("other"), // 'auth'|'network'|'system'|'firewall'|'config'|'other'
    message: text("message").notNull(),
    raw: text("raw").notNull(),
    parsed: jsonb("parsed").default({}),
    // Deduplikasi pesan berulang
    repeatCount: integer("repeat_count").notNull().default(1),
    firstEventTime: timestamp("first_event_time", { withTimezone: true }),
  },
  (table) => [
    index("idx_log_events_device_time").on(table.deviceId, table.eventTime.desc()),
    index("idx_log_events_device_time_id").on(table.deviceId, table.eventTime.desc(), table.id.desc()),
    index("idx_log_events_device_time_id_asc").on(table.deviceId, table.eventTime.asc(), table.id.asc()),
    index("idx_log_events_time").on(table.eventTime.desc()),
    index("idx_log_events_device_sev_time").on(table.deviceId, table.severity, table.eventTime.desc()),
    index("idx_log_events_message_trgm").using("gin", sql`${table.message} gin_trgm_ops`),
  ]
);

// 4. Incidents Table
export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    ruleKey: varchar("rule_key", { length: 100 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull().default("medium"), // 'low'|'medium'|'high'|'critical'
    title: text("title").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(1),
    status: varchar("status", { length: 20 }).notNull().default("open"), // 'open'|'ack'|'closed'
    evidence: jsonb("evidence").default([]),
    mainEntity: varchar("main_entity", { length: 150 }), // e.g. src_ip for deduplication
  },
  (table) => [
    index("idx_incidents_device_status").on(table.deviceId, table.status),
    index("idx_incidents_rule_device").on(table.deviceId, table.ruleKey, table.mainEntity),
  ]
);

// 5. AI Analyses Table
export const aiAnalyses = pgTable("ai_analyses", {
  id: uuid("id").defaultRandom().primaryKey(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "set null" }),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  riskLevel: varchar("risk_level", { length: 20 }).notNull().default("low"), // 'low'|'medium'|'high'|'critical'
  summary: text("summary").notNull(),
  suspectedAttack: text("suspected_attack"),
  recommendations: jsonb("recommendations").default([]),
  confidence: varchar("confidence", { length: 20 }).default("sedang"), // 'rendah'|'sedang'|'tinggi'
  findings: jsonb("findings").default([]),
  model: varchar("model", { length: 100 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 6. Settings Table
export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// 7. Device Status History Table
export const deviceStatusHistory = pgTable(
  "device_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull(), // 'online'|'log_stopped'|'offline'|'unknown'
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_dev_status_hist_dev_time").on(table.deviceId, table.startedAt.desc()),
  ]
);

// 8. Notification Channels Table
export const notificationChannels = pgTable("notification_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: varchar("type", { length: 20 }).notNull(), // 'telegram' | 'email'
  name: varchar("name", { length: 100 }).notNull(),
  config: text("config").notNull(), // encrypted JSON string
  isActive: boolean("is_active").notNull().default(true),
  events: jsonb("events").default(["ping_rto", "ping_recovered", "device_offline", "device_recovered"]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 9. Notification Logs Table
export const notificationLogs = pgTable(
  "notification_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id").references(() => notificationChannels.id, { onDelete: "set null" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 50 }).notNull(), // 'ping_rto' | 'ping_recovered' | 'device_offline' | 'device_recovered' | 'flapping_detected' | 'test'
    status: varchar("status", { length: 20 }).notNull(), // 'sent' | 'failed'
    details: jsonb("details").default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_notif_logs_device_time").on(table.deviceId, table.sentAt.desc()),
    index("idx_notif_logs_channel_time").on(table.channelId, table.sentAt.desc()),
  ]
);


// 10. Log Filters Table — Aturan noise filter / dedupe per perangkat atau global
export const logFilters = pgTable(
  "log_filters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 150 }).notNull(),
    matchType: varchar("match_type", { length: 20 }).notNull().default("contains"),
    pattern: text("pattern").notNull(),
    action: varchar("action", { length: 20 }).notNull().default("discard"),
    isActive: boolean("is_active").notNull().default(true),
    matchCount: bigint("match_count", { mode: "number" }).notNull().default(0),
    lastMatchedAt: timestamp("last_matched_at", { withTimezone: true }),
    createdBy: varchar("created_by", { length: 50 }).notNull().default("system"),
    isSystemSuggested: boolean("is_system_suggested").notNull().default(false),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_log_filters_device_active").on(table.deviceId, table.isActive),
    index("idx_log_filters_active").on(table.isActive),
  ]
);

// 11. Log Top Patterns Table — Agregasi pola pesan per jam, per perangkat
export const logTopPatterns = pgTable(
  "log_top_patterns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    normalizedMessage: text("normalized_message").notNull(),
    exampleMessage: text("example_message"),
    count: integer("count").notNull().default(0),
    minSeverity: smallint("min_severity"),
    maxSeverity: smallint("max_severity"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_log_top_patterns_device_hour").on(table.deviceId, table.hourBucket.desc()),
    uniqueIndex("uq_log_top_patterns_device_hour_msg").on(table.deviceId, table.hourBucket, table.normalizedMessage),
  ]
);

// 12. Device Ping Hourly Table — Agregasi cek ping per jam, per perangkat
export const devicePingHourly = pgTable(
  "device_ping_hourly",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    checkCount: integer("check_count").notNull().default(0),
    successCount: integer("success_count").notNull().default(0),
    failCount: integer("fail_count").notNull().default(0),
    maxConsecutiveRtoSeconds: integer("max_consecutive_rto_seconds").notNull().default(0),
    avgLatencyMs: integer("avg_latency_ms"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_dev_ping_hourly_dev_hour").on(table.deviceId, table.hourBucket.desc()),
    uniqueIndex("uq_dev_ping_hourly_dev_hour").on(table.deviceId, table.hourBucket),
  ]
);

// 13. Device Log Hourly Table — Hitungan log diterima, disimpan, dan dibuang per jam
export const deviceLogHourly = pgTable(
  "device_log_hourly",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
    receivedCount: integer("received_count").notNull().default(0),
    storedCount: integer("stored_count").notNull().default(0),
    droppedCount: integer("dropped_count").notNull().default(0),
    severityCritical: integer("severity_critical").notNull().default(0),
    severityError: integer("severity_error").notNull().default(0),
    severityWarning: integer("severity_warning").notNull().default(0),
    severityNotice: integer("severity_notice").notNull().default(0),
    severityInfo: integer("severity_info").notNull().default(0),
    severityDebug: integer("severity_debug").notNull().default(0),
    maxGapSeconds: integer("max_gap_seconds").notNull().default(0),
    lastLogAt: timestamp("last_log_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_dev_log_hourly_dev_hour").on(table.deviceId, table.hourBucket.desc()),
    index("idx_dev_log_hourly_hour").on(table.hourBucket.desc()),
    uniqueIndex("uq_dev_log_hourly_dev_hour").on(table.deviceId, table.hourBucket),
  ]
);

// 14. Topology Maps Table — Peta Topologi Jaringan
export const topologyMaps = pgTable("topology_maps", {
  id: uuid("id").defaultRandom().primaryKey(),
  nama: varchar("nama", { length: 100 }).notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// 15. Topology Nodes Table — Node Peta (Perangkat Fisik / Node Virtual)
// Keanggotaan grup ditentukan tunggal oleh devices.group_id (tidak diduplikasi di tabel peta)
export const topologyNodes = pgTable(
  "topology_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => topologyMaps.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "cascade" }),
    tipeVirtual: varchar("tipe_virtual", { length: 50 }), // 'internet'|'isp'|'cloud'|'switch_tak_terpantau'|'lainnya'
    label: varchar("label", { length: 150 }),
    x: doublePrecision("x").notNull().default(0),
    y: doublePrecision("y").notNull().default(0),
    terkunci: boolean("terkunci").notNull().default(false),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_topology_nodes_map_id").on(table.mapId),
    uniqueIndex("idx_topology_nodes_map_device")
      .on(table.mapId, table.deviceId)
      .where(sql`${table.deviceId} IS NOT NULL`),
  ]
);

// 17. Topology Links Table — Koneksi Penghubung Antar Node
export const topologyLinks = pgTable(
  "topology_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => topologyMaps.id, { onDelete: "cascade" }),
    sourceNodeId: uuid("source_node_id")
      .notNull()
      .references(() => topologyNodes.id, { onDelete: "cascade" }),
    targetNodeId: uuid("target_node_id")
      .notNull()
      .references(() => topologyNodes.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 100 }),
    tipe: varchar("tipe", { length: 30 }).notNull().default("kabel"), // 'kabel'|'wireless'|'vpn'|'lainnya'
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_topology_links_map_id").on(table.mapId),
    index("idx_topology_links_source").on(table.sourceNodeId),
    index("idx_topology_links_target").on(table.targetNodeId),
    uniqueIndex("uq_topology_links_source_target").on(table.sourceNodeId, table.targetNodeId),
  ]
);

// 18. User Map View States Table — Preferensi Tampilan Peta per User (Grup Terlipat, dsb)
export const userMapViewStates = pgTable(
  "user_map_view_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mapId: uuid("map_id")
      .notNull()
      .references(() => topologyMaps.id, { onDelete: "cascade" }),
    collapsedGroupIds: jsonb("collapsed_group_ids").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_user_map_view_states_user_map").on(table.userId, table.mapId),
    uniqueIndex("uq_user_map_view_states_user_map").on(table.userId, table.mapId),
  ]
);

// 19. Client Errors Table — Pelaporan Kesalahan Sisi Klien
export const clientErrors = pgTable(
  "client_errors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    waktu: timestamp("waktu", { withTimezone: true }).defaultNow().notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    path: varchar("path", { length: 255 }).notNull(),
    pesan: text("pesan").notNull(),
    stack: text("stack"),
    build: varchar("build", { length: 50 }),
    userAgent: text("user_agent"),
    sidikJari: varchar("sidik_jari", { length: 64 }).notNull(),
    jumlah: integer("jumlah").notNull().default(1),
    terakhirTerjadi: timestamp("terakhir_terjadi", { withTimezone: true }).defaultNow().notNull(),
    komponen: varchar("komponen", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("baru"), // 'baru' | 'selesai'
  },
  (table) => [
    uniqueIndex("uq_client_errors_sidik_jari").on(table.sidikJari),
    index("idx_client_errors_waktu").on(table.waktu),
    index("idx_client_errors_terakhir").on(table.terakhirTerjadi),
    index("idx_client_errors_status").on(table.status),
  ]
);

// Inferred Types
export type DeviceGroup = typeof deviceGroups.$inferSelect;
export type InsertDeviceGroup = typeof deviceGroups.$inferInsert;
export type TopologyMap = typeof topologyMaps.$inferSelect;
export type InsertTopologyMap = typeof topologyMaps.$inferInsert;
export type TopologyNode = typeof topologyNodes.$inferSelect;
export type InsertTopologyNode = typeof topologyNodes.$inferInsert;
export type TopologyLink = typeof topologyLinks.$inferSelect;
export type InsertTopologyLink = typeof topologyLinks.$inferInsert;
export type UserMapViewState = typeof userMapViewStates.$inferSelect;
export type InsertUserMapViewState = typeof userMapViewStates.$inferInsert;
export type ClientError = typeof clientErrors.$inferSelect;
export type InsertClientError = typeof clientErrors.$inferInsert;

