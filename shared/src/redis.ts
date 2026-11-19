import Redis from "ioredis";
import * as dotenv from "dotenv";

dotenv.config();

const rawRedisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redisUrl = rawRedisUrl.trim();

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  connectTimeout: 5000,
  commandTimeout: 5000,
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 150, 3000);
    return delay;
  },
});


export const getRedisConnectionOptions = () => {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname || "127.0.0.1",
    port: Number(parsed.port) || 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname && parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
};

