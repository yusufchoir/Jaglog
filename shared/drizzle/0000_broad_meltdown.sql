CREATE TABLE "ai_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"incident_id" uuid,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"risk_level" varchar(20) DEFAULT 'low' NOT NULL,
	"summary" text NOT NULL,
	"suspected_attack" text,
	"recommendations" jsonb DEFAULT '[]'::jsonb,
	"confidence" varchar(20) DEFAULT 'sedang',
	"findings" jsonb DEFAULT '[]'::jsonb,
	"model" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" varchar(50) DEFAULT 'other' NOT NULL,
	"ip_address" varchar(45),
	"location" varchar(150),
	"notes" text,
	"ingest_token_hash" varchar(128),
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_ip_address_unique" UNIQUE("ip_address")
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"rule_key" varchar(100) NOT NULL,
	"severity" varchar(20) DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb,
	"main_entity" varchar(150)
);
--> statement-breakpoint
CREATE TABLE "log_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"severity" smallint DEFAULT 6 NOT NULL,
	"facility" smallint DEFAULT 1,
	"source_app" varchar(100),
	"category" varchar(50) DEFAULT 'other' NOT NULL,
	"message" text NOT NULL,
	"raw" text NOT NULL,
	"parsed" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(20) DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "log_events" ADD CONSTRAINT "log_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_incidents_device_status" ON "incidents" USING btree ("device_id","status");--> statement-breakpoint
CREATE INDEX "idx_incidents_rule_device" ON "incidents" USING btree ("device_id","rule_key","main_entity");--> statement-breakpoint
CREATE INDEX "idx_log_events_device_time" ON "log_events" USING btree ("device_id","event_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_log_events_device_sev_time" ON "log_events" USING btree ("device_id","severity","event_time" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_log_events_message_trgm" ON "log_events" USING gin ("message" gin_trgm_ops);