import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.OURCHIVAL_NEXT_DIST_DIR || ".next",
  typescript: {
    tsconfigPath: process.env.OURCHIVAL_NEXT_TSCONFIG || "tsconfig.json",
  },
};

export default nextConfig;
