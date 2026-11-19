import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config();

import { getDatabaseUrl } from "./db";

async function runMigration() {
  const connectionString = getDatabaseUrl();
  console.log("Running migrations on database:", connectionString.replace(/:[^:@]*@/, ":***@"));

  let sql: ReturnType<typeof postgres> | null = null;
  const maxRetries = 5;
  const retryDelayMs = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      sql = postgres(connectionString, { max: 1, connect_timeout: 10 });
      await sql`SELECT 1;`;
      break;
    } catch (connErr: any) {
      console.warn(`[Migration] Database connection attempt ${attempt}/${maxRetries} failed: ${connErr.message}`);
      if (attempt === maxRetries) {
        throw connErr;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (!sql) throw new Error("Failed to initialize database connection");

  const db = drizzle(sql);

  // Try creating pg_trgm extension, but do not crash if user lacks superuser permissions
  try {
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm;`;
  } catch (extErr: any) {
    console.warn("[Migration Warning] Could not create pg_trgm extension (continuing):", extErr.message);
  }

  const migrationsFolder = path.resolve(__dirname, "../drizzle");
  console.log("Applying migrations from folder:", migrationsFolder);

  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully!");

  await sql.end();
}

runMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
