import { describe, expect, it } from "vitest";
import {
  normalizeCaptureEndpoint,
  normalizePairingEndpoint,
  normalizeSiteRoot,
} from "./storage";

describe("normalizeSiteRoot", () => {
  it("accepts HTTPS origins and strips known endpoint suffixes", () => {
    expect(normalizeSiteRoot("https://safe.convex.site/capture")).toBe(
      "https://safe.convex.site",
    );
    expect(normalizePairingEndpoint("https://safe.convex.site/capture")).toBe(
      "https://safe.convex.site/clipper-exchange",
    );
    expect(
      normalizeCaptureEndpoint("https://safe.convex.site/clipper-exchange"),
    ).toBe("https://safe.convex.site/capture");
  });

  it("allows local HTTP development endpoints", () => {
    expect(normalizeSiteRoot("http://localhost:3210/capture")).toBe(
      "http://localhost:3210",
    );
    expect(normalizeSiteRoot("http://127.0.0.1:3210")).toBe(
      "http://127.0.0.1:3210",
    );
  });

  it("rejects insecure public, credentialed, and decorated endpoints", () => {
    expect(normalizeSiteRoot("http://example.com/capture")).toBeUndefined();
    expect(normalizeSiteRoot("javascript:alert(1)")).toBeUndefined();
    expect(
      normalizeSiteRoot("https://user:secret@example.com/capture"),
    ).toBeUndefined();
    expect(
      normalizeSiteRoot("https://example.com/capture?token=secret"),
    ).toBeUndefined();
    expect(
      normalizeSiteRoot("https://example.com/capture#settings"),
    ).toBeUndefined();
  });
});
