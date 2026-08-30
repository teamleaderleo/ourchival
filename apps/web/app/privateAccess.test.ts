import { describe, expect, it } from "vitest";
import {
  isOwnerCredentialRejection,
  isTrustedSiteRequest,
  ownerAuthRequestErrorMessage,
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

describe("ownerAuthRequestErrorMessage", () => {
  it("turns a bounded auth-check timeout into a recoverable saved-session state", () => {
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";

    expect(ownerAuthRequestErrorMessage(timeout, true)).toBe(
      "Ourchival took too long to respond. Your saved session is still available.",
    );
    expect(ownerAuthRequestErrorMessage(timeout, false)).toBe(
      "Ourchival took too long to respond. Try again.",
    );
  });
});
