import { expect, it } from "vitest";
import { hasImageAsset, type SavedReference } from "./referenceVaultModel";

it("uses actual assets instead of treating every social post as an image", () => {
  const post = { kind: "post", assets: [], sourceSnapshot: { previewImageUrl: "https://example.com/avatar.png" } } as unknown as SavedReference;
  expect(hasImageAsset(post)).toBe(false);
  expect(hasImageAsset({ ...post, assets: [{ _id: "asset", originalUrl: "https://example.com/art.png" }] })).toBe(true);
});
