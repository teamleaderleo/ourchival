import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@ourchival/parsers": fileURLToPath(
        new URL("../../packages/parsers/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: "src/background.ts",
        content: "src/content.ts",
        popup: "src/popup.ts",
        import: "src/importPage.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
