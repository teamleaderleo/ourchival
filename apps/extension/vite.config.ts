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

  if (mode === "pixiv-owned-content" || mode === "pixiv-owned-content-watch") {
    return {
      resolve,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        lib: {
          entry: "src/pixivOwnedProfileContent.ts",
          formats: ["iife"],
          name: "OurchivalPixivOwnedProfile",
          fileName: () => "pixiv-owned-profile.js",
        },
      },
    };
  }

  if (mode === "hoyolab-owned-content" || mode === "hoyolab-owned-content-watch") {
    return {
      resolve,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        lib: {
          entry: "src/hoyolabOwnedContent.ts",
          formats: ["iife"],
          name: "OurchivalHoYoLabOwned",
          fileName: () => "hoyolab-owned.js",
        },
      },
    };
  }

  if (mode === "x-owned-content" || mode === "x-owned-content-watch") {
    return {
      resolve,
      build: {
        outDir: "dist",
        emptyOutDir: false,
        lib: {
          entry: "src/xOwnedProfileContent.ts",
          formats: ["iife"],
          name: "OurchivalXOwnedProfile",
          fileName: () => "x-owned-profile.js",
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
          failures: "src/failures.ts",
          "x-timeline-main": "src/xTimelineMain.ts",
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  };
});
