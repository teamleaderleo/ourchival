import { afterEach, describe, expect, it, vi } from "vitest";
import { isProtectedDriveUrl } from "./usePrivateImageUrl";

afterEach(() => {
  vi.unstubAllEnvs();
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
