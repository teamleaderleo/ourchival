import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAndStoreRemoteAsset } from "./http";
import { fetchPublicResponse } from "./lib/linkMetadata";
import { uploadBlobToDrive } from "./lib/drive";

vi.mock("./lib/linkMetadata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/linkMetadata")>()),
  fetchPublicResponse: vi.fn(),
}));
vi.mock("./lib/drive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/drive")>()),
  uploadBlobToDrive: vi.fn(),
}));
const image = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);
const args = {
  sourceUrl: "https://www.pinterest.com/pin/42/",
  assetUrl: "https://i.pinimg.com/originals/a.jpg",
};
const ctx = { storage: { store: vi.fn() } };
beforeEach(() => {
  vi.mocked(fetchPublicResponse).mockReset();
  vi.mocked(uploadBlobToDrive)
    .mockReset()
    .mockResolvedValue({
      ok: true,
      status: "stored",
      file: { id: "drive-id" },
    });
});

describe("asset fetch evidence", () => {
  it("promotes the canonical PNG and records actual dimensions and bytes", async () => {
    vi.mocked(fetchPublicResponse).mockImplementation(async (url) => ({
      finalUrl: url,
      response: new Response(image, {
        headers: { "Content-Type": "image/png" },
      }),
    }));
    const stored = await fetchAndStoreRemoteAsset(ctx, {
      ...args,
      originalUrl: "https://i.pinimg.com/originals/a.png",
      promotionOnly: true,
    });
    expect(stored).toMatchObject({
      quality: "original",
      storageProvider: "google_drive",
      width: 1,
      height: 1,
      fileSize: image.length,
    });
    const receipt = JSON.parse(stored.fetchReceipt!);
    expect(receipt.attempts).toEqual([
      expect.objectContaining({
        url: "https://i.pinimg.com/originals/a.png",
        status: 200,
        bytes: image.length,
        width: 1,
        height: 1,
      }),
    ]);
    expect(fetchPublicResponse).toHaveBeenCalledTimes(1);
  });
  it("records failed originals and labels a complete fallback as degraded", async () => {
    vi.mocked(fetchPublicResponse).mockImplementation(async (url) => ({
      finalUrl: url,
      response: url.includes("/originals/")
        ? new Response("denied", { status: 403 })
        : new Response(image, {
            status: 206,
            headers: {
              "Content-Type": "image/png",
              "Content-Range": `bytes 0-${image.length - 1}/${image.length}`,
            },
          }),
    }));
    const stored = await fetchAndStoreRemoteAsset(ctx, args);
    expect(stored.quality).toBe("degraded");
    expect(stored.qualityReason).toContain("does not prove nonexistence");
    expect(
      JSON.parse(stored.fetchReceipt!).attempts.map(
        (a: { status: number }) => a.status,
      ),
    ).toEqual([403, 206]);
  });
  it("never secures a partial 206 or silently retries resized URLs during promotion", async () => {
    vi.mocked(fetchPublicResponse).mockImplementation(async (url) => ({
      finalUrl: url,
      response: new Response(image, {
        status: 206,
        headers: {
          "Content-Type": "image/png",
          "Content-Range": "bytes 0-9/100",
        },
      }),
    }));
    expect(
      (await fetchAndStoreRemoteAsset(ctx, { ...args, promotionOnly: true }))
        .storageProvider,
    ).toBe("linked");
    expect(uploadBlobToDrive).not.toHaveBeenCalled();
    expect(fetchPublicResponse).toHaveBeenCalledTimes(1);
  });
});
