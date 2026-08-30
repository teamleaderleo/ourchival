import { describe, expect, it } from "vitest";
import {
  isOwnerCredentialRejection,
  isTrustedSiteRequest,
} from "./privateAccess";

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

describe("isOwnerCredentialRejection", () => {
  it("invalidates saved access only for explicit authentication failures", () => {
    expect(isOwnerCredentialRejection(401)).toBe(true);
    expect(isOwnerCredentialRejection(403)).toBe(true);
    expect(isOwnerCredentialRejection(429)).toBe(false);
    expect(isOwnerCredentialRejection(500)).toBe(false);
    expect(isOwnerCredentialRejection(503)).toBe(false);
  });
});
