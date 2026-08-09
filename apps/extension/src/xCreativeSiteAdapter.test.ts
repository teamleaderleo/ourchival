import { describe, expect, it } from "vitest";
import { isXLocation } from "./xCreativeSiteAdapter";

describe("isXLocation", () => {
  it("matches X and Twitter hosts", () => {
    expect(isXLocation({ hostname: "x.com" })).toBe(true);
    expect(isXLocation({ hostname: "mobile.x.com" })).toBe(true);
    expect(isXLocation({ hostname: "twitter.com" })).toBe(true);
    expect(isXLocation({ hostname: "mobile.twitter.com" })).toBe(true);
  });

  it("rejects lookalike and unrelated hosts", () => {
    expect(isXLocation({ hostname: "example.com" })).toBe(false);
    expect(isXLocation({ hostname: "notx.com" })).toBe(false);
    expect(isXLocation({ hostname: "twitter.com.example.org" })).toBe(false);
  });
});
