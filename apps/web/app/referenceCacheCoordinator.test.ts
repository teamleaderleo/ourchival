import { describe, expect, it } from "vitest";
import { ReferenceCacheCoordinator } from "./referenceCacheCoordinator";

describe("ReferenceCacheCoordinator", () => {
  it("allows cache paint before the matching network response settles", () => {
    const coordinator = new ReferenceCacheCoordinator();
    const token = coordinator.begin("all:");
    expect(coordinator.canApplyCache(token)).toBe(true);
  });

  it("blocks late cache paint after the network response settles", () => {
    const coordinator = new ReferenceCacheCoordinator();
    const token = coordinator.begin("all:");
    expect(coordinator.markNetworkSettled(token)).toBe(true);
    expect(coordinator.canApplyCache(token)).toBe(false);
  });

  it("blocks an older cache read after the user changes view or query", () => {
    const coordinator = new ReferenceCacheCoordinator();
    const oldToken = coordinator.begin("images:blue");
    const currentToken = coordinator.begin("images:red");

    expect(coordinator.canApplyCache(oldToken)).toBe(false);
    expect(coordinator.canApplyCache(currentToken)).toBe(true);
    expect(coordinator.markNetworkSettled(oldToken)).toBe(false);
    expect(coordinator.markNetworkSettled(currentToken)).toBe(true);
  });
});
