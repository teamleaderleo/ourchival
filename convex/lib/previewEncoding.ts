"use node";

import sharp from "sharp";

export const previewRecipeVersion = 2;
export const imageInputOptions = {
  failOn: "error" as const,
  limitInputPixels: 80_000_000,
  sequentialRead: true,
};

/** Precompute compact media once; retain only the smaller encoded object. */
export async function encodePreview(input: Buffer, kind: "preview" | "thumb") {
  const size = kind === "preview" ? 1600 : 384;
  const base = sharp(input, imageInputOptions).rotate().resize({
    width: size,
    height: size,
    fit: "inside",
    withoutEnlargement: true,
    kernel: sharp.kernel.lanczos3,
  });
  // The existing WebP recipe is also a fallback for unavailable AVIF encoders
  // and images whose AVIF container costs more than the image data saves.
  const webp = await base.clone().webp({
    quality: kind === "preview" ? 82 : 76,
    effort: 4,
    smartSubsample: true,
  }).toBuffer();
  try {
    const avif = await base.clone().avif({
      quality: kind === "preview" ? 55 : 50,
      effort: 4,
      chromaSubsampling: "4:4:4",
    }).toBuffer();
    if (avif.length < webp.length) return { data: avif, mimeType: "image/avif" as const };
  } catch {
    // A codec failure must not make an otherwise valid reference unviewable.
  }
  return { data: webp, mimeType: "image/webp" as const };
}
