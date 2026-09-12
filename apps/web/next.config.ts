import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.OURCHIVAL_NEXT_DIST_DIR || ".next",
  // The vault runs `next dev` as its daily driver against a single local
  // backend: StrictMode's double-invoked effects fire every gallery load
  // twice, and aborting the duplicate client-side does not cancel the
  // server work. Single-fire keeps batch pipelines from competing with
  // a ghost of the same request.
  reactStrictMode: false,
  typescript: {
    tsconfigPath: process.env.OURCHIVAL_NEXT_TSCONFIG || "tsconfig.json",
  },
};

export default nextConfig;
