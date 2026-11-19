CREATE TABLE IF NOT EXISTS "user_map_view_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"map_id" uuid NOT NULL REFERENCES "topology_maps"("id") ON DELETE CASCADE,
	"collapsed_group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_map_view_states_user_map" ON "user_map_view_states" ("user_id", "map_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_map_view_states_user_map" ON "user_map_view_states" ("user_id", "map_id");

