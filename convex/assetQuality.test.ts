import { describe, expect, it } from "vitest";
import {
  assetQuality,
  completeImageResponse,
  imageDimensions,
} from "./lib/assetQuality";
import { duplicateAssetReceipt } from "./http";
import { existingAssetReceipt } from "./httpDb";

describe("original evidence", () => {
  it("never upgrades a legacy Drive receipt or resized image into a proven original", () => {
    expect(assetQuality({ quality: "original" })).toBe("unknown");
    expect(
      existingAssetReceipt({
        storageProvider: "google_drive",
        fetchedUrl: "https://i.pinimg.com/originals/a.png",
      }).storageProvider,
    ).toBe("linked");
    expect(
      existingAssetReceipt({
        driveFileId: "durable",
        originalUrl: "https://i.pinimg.com/originals/a.jpg",
      }).quality,
    ).toBe("unknown");
    expect(
      assetQuality({
        fetchedUrl: "https://i.pinimg.com/1200x/a.jpg",
        quality: "original",
      }),
    ).toBe("degraded");
    expect(
      existingAssetReceipt({
        driveFileId: "durable",
        fetchedUrl: "https://i.pinimg.com/originals/a.png",
      }).quality,
    ).toBe("original");
    expect(
      assetQuality({ fetchedUrl: "https://i.pximg.net/img-master/a.jpg" }),
    ).toBe("degraded");
  });
  it("requires a complete byte range, not merely a successful 206", () => {
    expect(completeImageResponse(new Response(null, { status: 206 }))).toBe(
      false,
    );
    expect(
      completeImageResponse(
        new Response(null, {
          status: 206,
          headers: { "Content-Range": "bytes 0-9/100" },
        }),
      ),
    ).toBe(false);
    expect(
      completeImageResponse(
        new Response(null, {
          status: 206,
          headers: { "Content-Range": "bytes 0-99/100" },
        }),
      ),
    ).toBe(true);
  });
  it("preserves a durable fallback when original promotion fails", () => {
    const existing = {
      storageProvider: "google_drive",
      quality: "degraded",
      driveFileId: "keep",
    };
    expect(duplicateAssetReceipt({ storageProvider: "linked" }, existing)).toBe(
      existing,
    );
  });
  it("decodes intrinsic PNG dimensions and rejects a short body", () => {
    const b = new Uint8Array(24);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x89504e47);
    b.set([73, 72, 68, 82], 12);
    v.setUint32(16, 832);
    v.setUint32(20, 1472);
    expect(imageDimensions(b)).toEqual({ width: 832, height: 1472 });
    expect(imageDimensions(b.slice(0, 10))).toBeUndefined();
  });
});
