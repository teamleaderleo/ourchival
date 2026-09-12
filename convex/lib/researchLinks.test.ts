import { describe, it, expect } from "vitest";
import { researchLinks } from "./researchLinks";
describe("research destinations", () => {
  it("uses the exact ID and strips private query parameters", () => {
    const links = researchLinks("https://www.pixiv.net/en/artworks/123?token=private#secret", "Artist");
    expect(links).toHaveLength(4);
    expect(JSON.stringify(links)).not.toMatch(/private|secret/);
    expect(decodeURIComponent(links[2].url)).toContain('"123" "pixiv"');
  });
  it("rejects unsafe links and avoids placeholder artist searches", () => {
    expect(researchLinks("javascript:alert(1)")).toEqual([]);
    expect(researchLinks("https://user:password@example.com")).toEqual([]);
    expect(researchLinks("https://x.com/artist/status/123", "-----")).toHaveLength(2);
    expect(researchLinks("https://pixiv.net.evil.test/artworks/123")).toHaveLength(2);
  });
});
