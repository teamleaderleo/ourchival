import { describe, expect, it } from "vitest";
import { isTrustedSiteRequest } from "./privateAccess";

describe("isTrustedSiteRequest", () => {
  const siteUrl = "https://safe.convex.site";

  it("accepts requests on the exact configured site origin", () => {
    expect(
      isTrustedSiteRequest("https://safe.convex.site/references", siteUrl),
    ).toBe(true);
    expect(isTrustedSiteRequest("/drive-file?id=asset-1", siteUrl)).toBe(true);
  });

  it("rejects lookalike hosts and different origins", () => {
    expect(
      isTrustedSiteRequest(
        "https://safe.convex.site.attacker.example/drive-file",
        siteUrl,
      ),
    ).toBe(false);
    expect(
      isTrustedSiteRequest("https://safe.convex.cloud/references", siteUrl),
    ).toBe(false);
    expect(
      isTrustedSiteRequest("https://safe.convex.site:444/drive-file", siteUrl),
    ).toBe(false);
  });
});
