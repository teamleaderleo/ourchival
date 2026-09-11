import { afterEach, describe, expect, it, vi } from "vitest";
import { isProtectedDriveUrl, primePrivateImageUrl } from "./usePrivateImageUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("isProtectedDriveUrl", () => {
  it("only recognizes the exact Drive route on the configured Convex site", () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://safe.convex.site");

    expect(
      isProtectedDriveUrl("https://safe.convex.site/drive-file?id=asset-1"),
    ).toBe(true);
    expect(
      isProtectedDriveUrl(
        "https://safe.convex.site.attacker.example/drive-file?id=asset-1",
      ),
    ).toBe(false);
    expect(
      isProtectedDriveUrl("https://safe.convex.site/other/drive-file"),
    ).toBe(false);
    expect(isProtectedDriveUrl("https://safe.convex.cloud/drive-file")).toBe(
      false,
    );
  });
});

describe("primePrivateImageUrl", () => {
  it("warms the shared cache and swallows load failures", async () => {
    const blob = new Blob(["bytes"], { type: "image/avif" });
    const fetchMock = vi.fn(async () => new Response(blob));
    vi.stubGlobal("fetch", fetchMock);
    primePrivateImageUrl("https://safe.convex.site/drive-file?id=next");
    primePrivateImageUrl("https://safe.convex.site/drive-file?id=next");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expect(
      (async () => primePrivateImageUrl("https://safe.convex.site/drive-file?id=gone"))(),
    ).resolves.toBeUndefined();
  });
});
