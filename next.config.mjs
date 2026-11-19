import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const nextConfig = {
  staticPageGenerationTimeout: 300,
  typescript: {
    // Lewati type-check saat build Docker (menghemat waktu dan RAM hingga 60%)
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.alias["@shared"] = path.resolve(__dirname, "shared/src");
    config.resolve.alias["@jagalog/shared"] = path.resolve(__dirname, "shared/src");
    return config;
  },
  experimental: {
    cpus: 1,
    workerThreads: false,
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
