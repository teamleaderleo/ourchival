import { describe, expect, it } from "vitest";
import { captureSessionMutationActive } from "./captureSessionNavigationState";

describe("captureSessionMutationActive", () => {
  it("locks navigation when every batch action is disabled by one active mutation", () => {
    expect(captureSessionMutationActive([true, true, true, true])).toBe(true);
  });

  it("does not lock the session list or an idle detail", () => {
    expect(captureSessionMutationActive([])).toBe(false);
    expect(captureSessionMutationActive([false, false, false, false])).toBe(false);
  });

  it("does not infer a mutation from one independently disabled control", () => {
    expect(captureSessionMutationActive([true, false, false, false])).toBe(false);
  });
});
