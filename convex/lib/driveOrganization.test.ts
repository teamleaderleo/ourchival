import { it, expect, vi, afterEach } from "vitest";
import {
  drivePath,
  driveSource,
  configuredDriveParent,
} from "./driveOrganization";
afterEach(() => vi.unstubAllEnvs());
it("separates provider provenance, owned work and evidenced rendition", () => {
  expect(drivePath("https://x.com/a/status/123", "original")).toBe(
    "Twitter (X)/Originals",
  );
  expect(drivePath("https://x.com/a/status/123", "original", true)).toBe(
    "My Art/Twitter (X)/Posted originals",
  );
  expect(drivePath("https://ca.pinterest.com/pin/123", "degraded")).toBe(
    "Pinterest/Other renditions",
  );
  expect(drivePath("https://www.pixiv.net/artworks/123")).toBe(
    "Pixiv/Unverified images",
  );
  expect(driveSource("https://pixiv.net.evil.example/artworks/123")).toBe(
    "Other sources",
  );
});
it("configured uploads fail closed for an incorrect folder map", () => {
  vi.stubEnv(
    "GOOGLE_DRIVE_FOLDER_MAP",
    JSON.stringify({ root: "r", folders: { "Pixiv/Originals": "p" } }),
  );
  expect(configuredDriveParent("r", "Pixiv/Originals")).toBe("p");
  expect(() => configuredDriveParent("other", "Pixiv/Originals")).toThrow();
  expect(() => configuredDriveParent("r", "missing")).toThrow();
});
