import { describe, expect, it } from "vitest";

import { captureSessionCompletedAt } from "./lib/captureSessions";

describe("captureSessionCompletedAt", () => {
  it("keeps completion time only while the session is complete", () => {
    expect(captureSessionCompletedAt("completed", 123)).toBe(123);
    expect(captureSessionCompletedAt("running", 123)).toBeUndefined();
    expect(captureSessionCompletedAt("interrupted", 123)).toBeUndefined();
  });
});
