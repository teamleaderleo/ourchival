import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanDeviceName,
  createOwnerSessionCredential,
  createDeviceToken,
  createPairingCode,
  exchangeOwnerCredential,
  googleOwnerEmailMatches,
  hashSecret,
  isOwnerSessionCredential,
  normalizePairingCode,
} from "./privateAccess";

afterEach(() => {
  vi.unstubAllEnvs();
});

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

  it("accepts only the Google account that owns the configured Drive", () => {
    expect(
      googleOwnerEmailMatches("owner@example.com", " Owner@Example.com "),
    ).toBe(true);
    expect(
      googleOwnerEmailMatches("different@example.com", "owner@example.com"),
    ).toBe(false);
  });

  it("mints locally verifiable, expiring owner sessions", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "test-only-recovery-secret");
    const now = 1_800_000_000_000;
    const session = await createOwnerSessionCredential(now);

    expect(session.credential).toMatch(
      /^ourc_owner_session_\d{13}_[a-f0-9]{48}_[a-f0-9]{64}$/,
    );
    expect(session.expiresAt).toBe(now + 365 * 24 * 60 * 60 * 1000);
    expect(
      await isOwnerSessionCredential(
        session.credential,
        "test-only-recovery-secret",
        now,
      ),
    ).toBe(true);
    expect(
      await isOwnerSessionCredential(session.credential, "wrong-secret", now),
    ).toBe(false);
    expect(
      await isOwnerSessionCredential(
        session.credential,
        "test-only-recovery-secret",
        session.expiresAt,
      ),
    ).toBe(false);
  });

  it("rejects tampered owner sessions", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "test-only-recovery-secret");
    const session = await createOwnerSessionCredential(1_800_000_000_000);
    const tampered = `${session.credential.slice(0, -1)}${
      session.credential.endsWith("0") ? "1" : "0"
    }`;
    expect(
      await isOwnerSessionCredential(
        tampered,
        "test-only-recovery-secret",
        1_800_000_000_000,
      ),
    ).toBe(false);
  });

  it("exchanges recovery and existing session credentials for fresh sessions", async () => {
    vi.stubEnv("OURCHIVAL_OWNER_ACCESS_KEY", "test-only-recovery-secret");

    const fromRecovery = await exchangeOwnerCredential(
      "test-only-recovery-secret",
    );
    const renewed = await exchangeOwnerCredential(fromRecovery.credential);

    expect(fromRecovery.credential).not.toBe("test-only-recovery-secret");
    expect(renewed.credential).not.toBe(fromRecovery.credential);
    expect(await isOwnerSessionCredential(renewed.credential)).toBe(true);
  });
});
