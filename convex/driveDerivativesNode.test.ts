import { describe, expect, it } from "vitest";
import { verifyMirroredBytes } from "./driveDerivativesNode";

describe("verifyMirroredBytes", () => {
  it("accepts matching size and checksum", () => {
    const local = new Uint8Array([1, 2, 3]);
    // md5("010203")
    const md5 = "5289df737df57326fcdd22597afb1fac";
    expect(
      verifyMirroredBytes(local, {
        size: 3,
        md5Checksum: md5,
        label: "thumb",
      }),
    ).toBe(md5);
  });

  it("rejects size and checksum mismatches", () => {
    const local = new Uint8Array([1, 2, 3]);
    expect(() =>
      verifyMirroredBytes(local, {
        size: 4,
        md5Checksum: "5289df737df57326fcdd22597afb1fac",
        label: "thumb",
      }),
    ).toThrow("verification mismatch");
    expect(() =>
      verifyMirroredBytes(local, {
        size: 3,
        md5Checksum: "0".repeat(32),
        label: "preview",
      }),
    ).toThrow("verification mismatch");
  });
});
