import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ourchival/parsers": fileURLToPath(
        new URL("./packages/parsers/src/index.ts", import.meta.url),
      ),
      "@ourchival/shared": fileURLToPath(
        new URL("./packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
});
