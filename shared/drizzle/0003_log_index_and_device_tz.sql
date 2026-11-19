ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "timezone" varchar(50) DEFAULT 'Asia/Jakarta' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_log_events_device_time_id" ON "log_events" USING btree ("device_id", "event_time" DESC NULLS LAST, "id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_log_events_device_time_id_asc" ON "log_events" USING btree ("device_id", "event_time" ASC NULLS LAST, "id" ASC NULLS LAST);
