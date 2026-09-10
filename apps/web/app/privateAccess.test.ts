import { describe, expect, it, vi } from "vitest";
import {
  isOwnerCredentialRejection,
  isTrustedSiteRequest,
  ownerAuthRequestErrorMessage,
  onOwnerAccessChange,
} from "./privateAccess";

it("does not reset authenticated views when another tab saves its browse position", () => {
  const events = new Map<string, (event: { key?: string | null }) => void>();
  vi.stubGlobal("window", { addEventListener: (name: string, callback: (event: { key?: string | null }) => void) => events.set(name, callback), removeEventListener: (name: string) => events.delete(name) });
  try {
    const listener = vi.fn();
    const stop = onOwnerAccessChange(listener);
    events.get("storage")?.({ key: "ourchival:browse:v1:position" });
    expect(listener).not.toHaveBeenCalled();
    events.get("storage")?.({ key: "ourchivalOwnerAccessKey" });
    events.get("storage")?.({ key: null });
    events.get("ourchival-access-changed")?.({});
    expect(listener).toHaveBeenCalledTimes(3);
    stop(); expect(events.size).toBe(0);
  } finally { vi.unstubAllGlobals(); }
});

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
