ALTER TABLE "devices" ADD COLUMN "ping_failure_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "notify_on_rto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "last_ping_rtt" integer;--> statement-breakpoint
ALTER TABLE "notification_channels" ADD COLUMN "events" jsonb DEFAULT '["ping_rto","ping_recovered","device_offline","device_recovered"]'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_log_events_time" ON "log_events" USING btree ("event_time" DESC NULLS LAST);