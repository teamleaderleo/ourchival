// @vitest-environment node
import sharp from "sharp";
import { expect, test, vi } from "vitest";
import { encodePreview } from "./previewEncoding";

test("previews preserve orientation and size while stripping original metadata", async () => {
  const input = await sharp({ create: { width: 1800, height: 900, channels: 3, background: "#b84883" } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const preview = await encodePreview(input, "preview");
  const m = await sharp(preview.data).metadata();
  expect([m.width, m.height]).toEqual([800, 1600]);
  expect(m.exif).toBeUndefined();
  expect(m.orientation).toBeUndefined();
  expect(preview.mimeType).toBe(m.format === "heif" ? "image/avif" : "image/webp");
});

test("small transparent images are not enlarged or flattened", async () => {
  const input = await sharp({ create: { width: 24, height: 12, channels: 4, background: { r: 30, g: 80, b: 160, alpha: 0 } } }).png().toBuffer();
  const thumb = await encodePreview(input, "thumb");
  const m = await sharp(thumb.data).metadata();
  expect([m.width, m.height, m.hasAlpha]).toEqual([24, 12, true]);
  const pixels = await sharp(thumb.data).ensureAlpha().raw().toBuffer();
  expect(pixels[3]).toBe(0);
});

test("encoder failure falls back to a decodable WebP", async () => {
  const input = await sharp({ create: { width: 40, height: 40, channels: 3, background: "red" } }).png().toBuffer();
  const codec = vi.spyOn(sharp.prototype, "avif").mockImplementation(() => { throw new Error("codec unavailable"); });
  try {
    const result = await encodePreview(input, "thumb");
    expect(result.mimeType).toBe("image/webp");
    expect((await sharp(result.data).metadata()).format).toBe("webp");
  } finally { codec.mockRestore(); }
});

test("selected output never exceeds the old WebP recipe and fits the gallery", async () => {
  const input = await sharp({ create: { width: 600, height: 1200, channels: 3, background: "#6b9074" } }).png().toBuffer();
  const baseline = await sharp(input).rotate().resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 4, smartSubsample: true }).toBuffer();
  const result = await encodePreview(input, "thumb");
  expect(result.data.length).toBeLessThanOrEqual(baseline.length);
  expect((await sharp(result.data).metadata()).height).toBe(384);
});

test("invalid inputs fail rather than becoming apparently successful previews", async () => {
  await expect(encodePreview(Buffer.from("not an image"), "preview")).rejects.toThrow();
});
