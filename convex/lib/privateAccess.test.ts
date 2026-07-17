import { afterEach, describe, expect, it } from "vitest";
import {
  cleanDeviceName,
  createDeviceToken,
  createOwnerSessionToken,
  createPairingCode,
  hashSecret,
  isOwnerAccessKey,
  normalizePairingCode,
  requireAllowedWorkosUser,
} from "./privateAccess";

const originalSessionSecret = process.env.OURCHIVAL_SESSION_SIGNING_SECRET;
const originalAllowedUsers = process.env.OURCHIVAL_ALLOWED_WORKOS_USER_IDS;

afterEach(() => {
  if (originalSessionSecret === undefined) delete process.env.OURCHIVAL_SESSION_SIGNING_SECRET;
  else process.env.OURCHIVAL_SESSION_SIGNING_SECRET = originalSessionSecret;
  if (originalAllowedUsers === undefined) delete process.env.OURCHIVAL_ALLOWED_WORKOS_USER_IDS;
  else process.env.OURCHIVAL_ALLOWED_WORKOS_USER_IDS = originalAllowedUsers;
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

  it("mints signed owner sessions without exposing the signing secret", async () => {
    process.env.OURCHIVAL_SESSION_SIGNING_SECRET = "test-session-secret-with-enough-entropy";
    const session = await createOwnerSessionToken("user_ourchival_owner");
    expect(session.token).toMatch(/^ourc_owner_[a-f0-9]+\.[a-f0-9]{64}$/);
    expect(session.token).not.toContain("test-session-secret");
    expect(await isOwnerAccessKey(session.token)).toBe(true);
    expect(await isOwnerAccessKey(`${session.token}tampered`)).toBe(false);
  });

  it("limits WorkOS sessions to the configured user IDs", () => {
    process.env.OURCHIVAL_ALLOWED_WORKOS_USER_IDS = "user_owner,user_second";
    expect(() => requireAllowedWorkosUser("user_owner")).not.toThrow();
    expect(() => requireAllowedWorkosUser("user_outsider")).toThrow(/not allowed/i);
  });
});
