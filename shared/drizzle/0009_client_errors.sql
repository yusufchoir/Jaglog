CREATE TABLE IF NOT EXISTS "client_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"waktu" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"path" varchar(255) NOT NULL,
	"pesan" text NOT NULL,
	"stack" text,
	"build" varchar(50),
	"user_agent" text,
	"sidik_jari" varchar(64) NOT NULL,
	"jumlah" integer DEFAULT 1 NOT NULL,
	"terakhir_terjadi" timestamp with time zone DEFAULT now() NOT NULL,
	"komponen" varchar(100),
	"status" varchar(20) DEFAULT 'baru' NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_errors" ADD CONSTRAINT "client_errors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_client_errors_sidik_jari" ON "client_errors" USING btree ("sidik_jari");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_errors_waktu" ON "client_errors" USING btree ("waktu");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_errors_terakhir" ON "client_errors" USING btree ("terakhir_terjadi");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_client_errors_status" ON "client_errors" USING btree ("status");

