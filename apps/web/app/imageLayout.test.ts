import { expect, it } from "vitest";
import { hasImageAsset, thumbnailRatio, type SavedReference } from "./referenceVaultModel";

it("uses actual assets instead of treating every social post as an image", () => {
  const post = { kind: "post", assets: [], sourceSnapshot: { previewImageUrl: "https://example.com/avatar.png" } } as unknown as SavedReference;
  expect(hasImageAsset(post)).toBe(false);
  expect(hasImageAsset({ ...post, assets: [{ _id: "asset", originalUrl: "https://example.com/art.png" }] })).toBe(true);
});

it("reserves bounded space from catalog dimensions before decoding", () => {
  expect(thumbnailRatio({ _id: "a", width: 800, height: 1200 })).toBeCloseTo(2 / 3);
  expect(thumbnailRatio({ _id: "a", width: 0, height: 10 })).toBe(1);
  expect(thumbnailRatio()).toBe(1);
  expect(thumbnailRatio({ _id: "a", width: 10, height: 1000 })).toBe(.6);
});
