-- Migrasi 0007: Device Groups & Topology Improvements (Perbaikan Bug & Penambahan Grup/Area)

-- 1. Buat Tabel Master device_groups
CREATE TABLE IF NOT EXISTS "device_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "nama" varchar(100) NOT NULL,
  "deskripsi" text,
  "warna_garis" varchar(20) DEFAULT 'biru' NOT NULL,
  "urutan" integer DEFAULT 0 NOT NULL,
  "parent_id" uuid REFERENCES "device_groups"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_device_groups_warna_garis" CHECK ("warna_garis" IN ('biru', 'merah', 'abu'))
);

-- Index nama unik case-insensitive
CREATE UNIQUE INDEX IF NOT EXISTS "idx_device_groups_lower_nama" ON "device_groups" (lower("nama"));
CREATE INDEX IF NOT EXISTS "idx_device_groups_parent_id" ON "device_groups" ("parent_id");

-- 2. Tambah kolom group_id pada tabel devices
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "group_id" uuid REFERENCES "device_groups"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_devices_group_id" ON "devices" ("group_id");

-- 3. Tambah kolom device_group_id dan updated_at pada topology_groups
ALTER TABLE "topology_groups" ADD COLUMN IF NOT EXISTS "device_group_id" uuid REFERENCES "device_groups"("id") ON DELETE SET NULL;
ALTER TABLE "topology_groups" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_topology_groups_device_group_id" ON "topology_groups" ("device_group_id");

-- 4. Tambah kolom updated_at pada topology_nodes
ALTER TABLE "topology_nodes" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
