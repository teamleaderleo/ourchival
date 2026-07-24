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
        conversationWorker: "src/conversationWorker.ts",
        content: "src/content.ts",
        conversationContent: "src/conversationContent.ts",
        popup: "src/popup.ts",
        conversationPopup: "src/conversationPopup.ts",
        artifactWarningPopup: "src/artifactWarningPopup.ts",
      },
      output: {
        entryFileNames: "[name].js",
      },
    },
  },
});
