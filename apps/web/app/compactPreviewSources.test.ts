import { expect, test } from "vitest";
import { compactPreviewSources } from "./compactPreviewSources";

test("gallery and viewer never download original files as preview fallbacks", () => {
  const original = { _id: "asset", storedUrl: "https://vault/drive-file?id=original", originalUrl: "https://source/full.png" };
  expect(compactPreviewSources(original)).toEqual([]);
  expect(compactPreviewSources({ ...original, previewUrl: "preview.avif", thumbUrl: "thumb.webp" }, true)).toEqual(["thumb.webp", "preview.avif"]);
  expect(compactPreviewSources({ ...original, previewUrl: "preview.avif", thumbUrl: "thumb.webp" })).toEqual(["preview.avif", "thumb.webp"]);
});

test("missing and duplicate preview URLs produce no redundant fallback", () => {
  expect(compactPreviewSources(undefined)).toEqual([]);
  expect(compactPreviewSources({ _id: "asset", thumbUrl: "same", previewUrl: "same" })).toEqual(["same"]);
});
