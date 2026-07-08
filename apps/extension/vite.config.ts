import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: "src/background.ts",
        content: "src/content.ts",
        popup: "src/popup.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
