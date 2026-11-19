import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.resolve.alias["@shared"] = path.resolve(__dirname, "../shared/src");
    config.resolve.alias["@jagalog/shared"] = path.resolve(__dirname, "../shared/src");
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ["postgres", "@node-rs/argon2", "ioredis", "bullmq"],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
