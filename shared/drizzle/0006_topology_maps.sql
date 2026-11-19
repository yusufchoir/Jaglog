-- Migration: 0006_topology_maps.sql
-- Penambahan fitur Peta Topologi Jaringan & Pengelompokan (Aditif)

CREATE TABLE IF NOT EXISTS "topology_maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "nama" varchar(100) NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "topology_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "topology_maps"("id") ON DELETE CASCADE,
  "nama" varchar(100) NOT NULL,
  "warna_garis" varchar(20) NOT NULL DEFAULT 'biru',
  "x" double precision NOT NULL DEFAULT 0,
  "y" double precision NOT NULL DEFAULT 0,
  "lebar" double precision NOT NULL DEFAULT 300,
  "tinggi" double precision NOT NULL DEFAULT 200,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "topology_nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "topology_maps"("id") ON DELETE CASCADE,
  "device_id" uuid REFERENCES "devices"("id") ON DELETE CASCADE,
  "tipe_virtual" varchar(50),
  "label" varchar(150),
  "x" double precision NOT NULL DEFAULT 0,
  "y" double precision NOT NULL DEFAULT 0,
  "group_id" uuid REFERENCES "topology_groups"("id") ON DELETE SET NULL,
  "terkunci" boolean NOT NULL DEFAULT false,
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Indeks unik untuk 1 perangkat hanya 1 node per peta
CREATE UNIQUE INDEX IF NOT EXISTS "idx_topology_nodes_map_device" 
  ON "topology_nodes" ("map_id", "device_id") 
  WHERE "device_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_topology_nodes_map_id" ON "topology_nodes" ("map_id");
CREATE INDEX IF NOT EXISTS "idx_topology_nodes_group_id" ON "topology_nodes" ("group_id");

CREATE TABLE IF NOT EXISTS "topology_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "topology_maps"("id") ON DELETE CASCADE,
  "source_node_id" uuid NOT NULL REFERENCES "topology_nodes"("id") ON DELETE CASCADE,
  "target_node_id" uuid NOT NULL REFERENCES "topology_nodes"("id") ON DELETE CASCADE,
  "label" varchar(100),
  "tipe" varchar(30) NOT NULL DEFAULT 'kabel',
  "is_demo" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_topology_links_no_self" CHECK ("source_node_id" != "target_node_id"),
  CONSTRAINT "uq_topology_links_source_target" UNIQUE ("source_node_id", "target_node_id")
);

CREATE INDEX IF NOT EXISTS "idx_topology_links_map_id" ON "topology_links" ("map_id");
CREATE INDEX IF NOT EXISTS "idx_topology_links_source" ON "topology_links" ("source_node_id");
CREATE INDEX IF NOT EXISTS "idx_topology_links_target" ON "topology_links" ("target_node_id");

-- Pastikan ada satu peta default jika belum ada peta sama sekali
INSERT INTO "topology_maps" ("nama", "is_default", "is_demo")
SELECT 'Peta Jaringan Utama', true, false
WHERE NOT EXISTS (SELECT 1 FROM "topology_maps" WHERE "is_default" = true);
