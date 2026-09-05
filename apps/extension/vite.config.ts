import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const resolve = {
  alias: {
    "@ourchival/parsers": fileURLToPath(
      new URL("../../packages/parsers/src/index.ts", import.meta.url),
    ),
  },
};

export default defineConfig(({ mode }) => {
  if (mode === "content" || mode === "content-watch") {
    return {
      resolve,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        lib: {
          entry: "src/content.ts",
          formats: ["iife"],
          name: "OurchivalContent",
          fileName: () => "content.js",
        },
      },
    };
  }

  return {
    resolve,
    build: {
      outDir: "dist",
      emptyOutDir: mode === "extension",
      rollupOptions: {
        input: {
          background: "src/background.ts",
          popup: "src/popup.ts",
          "x-timeline-main": "src/xTimelineMain.ts",
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  };
});
