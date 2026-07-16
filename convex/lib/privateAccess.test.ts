import { describe, expect, it } from "vitest";
import {
  cleanDeviceName,
  createDeviceToken,
  createPairingCode,
  hashSecret,
  normalizePairingCode,
} from "./privateAccess";

describe("private access helpers", () => {
  it("hashes secrets deterministically without preserving the raw value", async () => {
    const first = await hashSecret("correct horse battery staple");
    const second = await hashSecret("correct horse battery staple");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("horse");
  });

  it("creates normalized human-readable pairing codes", () => {
    const code = createPairingCode();
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(normalizePairingCode(code.toLocaleLowerCase())).toBe(code);
    expect(normalizePairingCode(code.replace("-", " "))).toBe(code);
  });

  it("creates scoped device tokens", () => {
    expect(createDeviceToken()).toMatch(/^ourc_dev_[a-f0-9]{64}$/);
  });

  it("cleans device labels", () => {
    expect(cleanDeviceName("  Leo's   Edge  ")).toBe("Leo's Edge");
    expect(cleanDeviceName(42)).toBe("Ourchival Clipper");
  });
});
