import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  webpack: (config) => {
    config.resolve.alias["@shared"] = path.resolve(__dirname, "shared/src");
    config.resolve.alias["@jagalog/shared"] = path.resolve(__dirname, "shared/src");
    return config;
  },
  experimental: {
    serverComponentsExternalPackages: ["postgres", "@node-rs/argon2", "ioredis", "bullmq"],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        // Pastikan navigasi HTML tidak di-cache oleh browser/CDN agar selalu mendapatkan referensi chunk terbaru
        source: "/((?!_next/static|_next/image|favicon.ico|icons/).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
