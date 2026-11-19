import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as dotenv from "dotenv";
import * as schema from "./schema";

dotenv.config();

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER) {
    const user = encodeURIComponent(process.env.POSTGRES_USER.trim());
    const pass = process.env.POSTGRES_PASSWORD ? `:${encodeURIComponent(process.env.POSTGRES_PASSWORD.trim())}` : "";
    const host = process.env.POSTGRES_HOST.trim();
    const port = process.env.POSTGRES_PORT ? process.env.POSTGRES_PORT.trim() : 5432;
    const dbName = process.env.POSTGRES_DB ? process.env.POSTGRES_DB.trim() : "postgres";
    return `postgres://${user}${pass}@${host}:${port}/${dbName}`;
  }
  return "postgres://localhost:5432/jagalog";
}


const connectionString = getDatabaseUrl();

// Client for queries
export const queryClient = postgres(connectionString, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
});


export const db = drizzle(queryClient, { schema });
